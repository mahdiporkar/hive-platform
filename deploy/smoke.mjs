// Post-deployment health and smoke checks of the Hive demo installation, through the public gateway that fronts it
// (browser → gateway → BFF → authorization), as a browser reaches it. Exit code 0 = healthy, 1 = failed.
// The services do not publish their build commit, so — to avoid accepting the previous container just before it is
// replaced — the checks start after a settle period and must pass on two consecutive rounds.
//
//   node deploy/smoke.mjs --url https://demo.example [--console-commit <sha>] [--settle 30] [--timeout 600]
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({ options: {
  url: { type: 'string' }, 'console-commit': { type: 'string' }, settle: { type: 'string', default: '30' }, timeout: { type: 'string', default: '600' },
} });
if (!args.url) { console.error('--url is required'); process.exit(2); }
const base = args.url.replace(/\/$/, '');
const deadline = Date.now() + Number(args.timeout) * 1000;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

const get = async (path, { json = true } = {}) => {
  const response = await fetch(new URL(path, base + '/'), { headers: { Accept: json ? 'application/json' : '*/*' }, redirect: 'manual', signal: AbortSignal.timeout(15000) });
  return { status: response.status, body: json ? await response.json().catch(() => null) : await response.text() };
};
const expect = (condition, message) => { if (!condition) throw new Error(message); };

const checks = [
  ['BFF ready', async () => {
    const ready = await get('/actuator/health/readiness');
    expect(ready.status === 200 && ready.body?.status === 'UP', `BFF readiness -> ${ready.status} ${JSON.stringify(ready.body)}`);
  }],
  ['authorization through the BFF', async () => {
    const context = await get('/api/public/context');
    expect(context.status === 200 && typeof context.body?.contractVersion === 'string',
      `GET /api/public/context -> ${context.status} ${JSON.stringify(context.body)?.slice(0, 200)}`);
    return `contract ${context.body.contractVersion}, ${context.body.modules?.length ?? 0} public module(s)`;
  }],
  ['operator console', async () => {
    const page = await get('/console/', { json: false });
    expect(page.status === 200, `GET /console/ -> ${page.status}`);
    const version = await get('/console/version.json');
    if (args['console-commit']) expect(version.body?.commit === args['console-commit'], `console serves ${version.body?.commit}, expected ${args['console-commit']}`);
    return version.body?.commit ? `console ${version.body.commit.slice(0, 12)}` : undefined;
  }],
];

console.log(`waiting ${args.settle}s for the deployment to settle`);
await pause(Number(args.settle) * 1000);
let attempt = 0;
let consecutive = 0;
for (;;) {
  attempt++;
  const notes = [];
  const failures = [];
  for (const [name, check] of checks) {
    try { const note = await check(); notes.push(`✔ ${name}${note ? ` (${note})` : ''}`); }
    catch (error) { failures.push(`✖ ${name}: ${error.message}`); }
  }
  consecutive = failures.length ? 0 : consecutive + 1;
  if (consecutive === 2) {
    console.log(`Smoke checks passed against ${base} (attempt ${attempt})\n${notes.join('\n')}`);
    process.exit(0);
  }
  if (Date.now() > deadline) {
    console.error(`Smoke checks failed against ${base} after ${attempt} attempts\n${[...notes, ...failures].join('\n')}`);
    process.exit(1);
  }
  if (failures.length) console.log(`attempt ${attempt}: ${failures.map(f => f.split(':')[0]).join(', ')} not passing yet`);
  await pause(10000);
}
