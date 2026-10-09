// Deploys built images of the given components to the demo environment, verifies them, and rolls back on failure.
// The components (order, images, CapRover apps, smoke options) are listed in deploy/components.json.
//
//   1. For each component, look up the last verified image (registry tag `demo-good`, its revision label).
//   2. Deploy the new image of each component, in the configured order.
//   3. Run the smoke checks (deploy/smoke.mjs) for the new versions.
//   4a. Passed: move `demo-good` to the new images.  4b. Failed: redeploy the previous verified images of the
//       components that were changed, re-run the smoke checks for them, and exit non-zero either way.
//
// Environment:
//   DEPLOY_COMPONENTS   comma-separated component names
//   DEPLOY_SHA          commit whose images (tag = full SHA) are deployed
//   IMAGE_PREFIX        registry path, e.g. ghcr.io/<owner>/<repository>
//   DEMO_URL            public origin of the demo, for the smoke checks
//   DEPLOYER            caprover (default) | compose (local rehearsal, see deploy/rehearsal)
//   caprover:  CAPROVER_URL, CAPROVER_TOKEN_<NAME> (per-app deployment token), optional CAPROVER_APP_<NAME>
//   compose:   COMPOSE_FILE, COMPOSE_PROJECT_NAME (the service named like the app takes its image from <NAME>_IMAGE)
//   SMOKE_TIMEOUT       seconds (default 600)
//   GITHUB_STEP_SUMMARY written when present (GitHub Actions job summary)
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { components, labels, retag } from './registry.mjs';

const env = process.env;
const HERE = dirname(fileURLToPath(import.meta.url));
const required = name => { if (!env[name]) { console.error(`${name} is required`); process.exit(2); } return env[name]; };
const sha = required('DEPLOY_SHA');
const prefix = required('IMAGE_PREFIX').replace(/\/$/, '');
const demoUrl = required('DEMO_URL');
const deployer = env.DEPLOYER || 'caprover';
const all = components();
const requested = required('DEPLOY_COMPONENTS').split(',').map(c => c.trim()).filter(Boolean);
for (const name of requested) if (!all.some(c => c.name === name)) { console.error(`unknown component ${name}`); process.exit(2); }
const selected = all.filter(c => requested.includes(c.name));

const summary = [];
const note = line => { console.log(line); summary.push(line); };
const writeSummary = title => {
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `### ${title}\n\n${summary.map(l => `- ${l}`).join('\n')}\n\n`);
};
const repository = c => `${prefix}/${c.image}`;
const short = commit => commit.slice(0, 12);

function deploy(c, tag) {
  const image = `${repository(c)}:${tag}`;
  console.log(`::group::deploy ${c.name} ← ${image}`);
  let ok;
  if (deployer === 'caprover') {
    if (!c.token) console.error(`CAPROVER_TOKEN_${c.envKey} is not set`);
    // Only npx needs a shell (npx.cmd) on Windows.
    ok = Boolean(c.token) && spawnSync('npx', ['-y', 'caprover@2.4.4', 'deploy', '--caproverUrl', required('CAPROVER_URL'), '--appToken', c.token,
      '--appName', c.app, '--imageName', image], { stdio: 'inherit', shell: process.platform === 'win32' }).status === 0;
  } else {
    ok = spawnSync('docker', ['compose', 'up', '-d', '--no-deps', '--force-recreate', c.app], { stdio: 'inherit',
      env: { ...env, [`${c.envKey}_IMAGE`]: image } }).status === 0;
  }
  console.log('::endgroup::');
  return ok;
}

function smoke(expected) {
  const argv = [join(HERE, 'smoke.mjs'), '--url', demoUrl, '--timeout', env.SMOKE_TIMEOUT || '600'];
  for (const [c, version] of expected) {
    if (c.smoke?.commit && version.commit) argv.push(c.smoke.commit, version.commit);
    if (c.smoke?.version && version.version) argv.push(c.smoke.version, version.version);
  }
  return spawnSync(process.execPath, argv, { stdio: 'inherit' }).status === 0;
}

// 1. What is known to work now, and what is about to be deployed.
const previous = new Map();
const next = new Map();
for (const c of selected) {
  previous.set(c, labels(`${repository(c)}:demo-good`));
  next.set(c, labels(`${repository(c)}:${sha}`));
  if (!next.get(c)?.commit) { note(`✖ ${c.name}: image ${repository(c)}:${sha} not found in the registry`); writeSummary('Deployment failed'); process.exit(1); }
  note(`${c.name}: ${previous.get(c)?.commit ? short(previous.get(c).commit) : 'no verified version yet'} → ${short(sha)}`);
}

// 2–3. Deploy and verify.
const deployed = [];
let healthy = true;
for (const c of selected) {
  if (!deploy(c, sha)) { note(`✖ ${c.name}: deployment command failed`); healthy = false; break; }
  deployed.push(c);
}
if (healthy) {
  healthy = smoke(selected.map(c => [c, next.get(c)]));
  if (!healthy) note('✖ smoke checks failed for the new version');
}

if (healthy) {
  for (const c of selected) {
    note(retag(repository(c), sha, 'demo-good') ? `✔ ${c.name} ${short(sha)} verified and marked demo-good` : `⚠ ${c.name}: verified, but demo-good could not be moved`);
  }
  writeSummary(`Deployed ${short(sha)} to demo`);
  process.exit(0);
}

// 4b. Roll back what was changed to the last verified images.
const restorable = deployed.filter(c => previous.get(c)?.commit);
for (const c of deployed.filter(c => !previous.get(c)?.commit)) note(`⚠ ${c.name}: no previous verified image to roll back to`);
let restored = restorable.length > 0;
for (const c of restorable) {
  note(`↩ rolling back ${c.name} to ${short(previous.get(c).commit)}`);
  if (!deploy(c, previous.get(c).commit)) { note(`✖ ${c.name}: rollback deployment failed`); restored = false; }
}
if (restored) {
  restored = smoke(restorable.map(c => [c, previous.get(c)]));
  note(restored ? '✔ rolled back; the previous version passes the smoke checks' : '✖ rolled back, but the previous version does not pass the smoke checks either');
}
writeSummary(`Deployment of ${short(sha)} failed${restored ? ' — rolled back' : ''}`);
process.exit(1);
