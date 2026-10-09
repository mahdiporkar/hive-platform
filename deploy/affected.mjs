// Decides which components a deployment of <sha> must change: those whose files (deploy/components.json `paths`)
// differ between the version verified on the demo (registry tag `demo-good`, its revision label) and <sha>.
// Comparing with what is actually running — not with the previous push — means a skipped or superseded run never
// leaves a change undeployed.
//
//   node deploy/affected.mjs <sha> [affected|all|<component>[,<component>…]]   → prints e.g. "backend,web" (or "")
// Environment: IMAGE_PREFIX (e.g. ghcr.io/<owner>/<repository>)
import { spawnSync } from 'node:child_process';
import { components, labels } from './registry.mjs';

const [sha, mode = 'affected'] = process.argv.slice(2);
const prefix = process.env.IMAGE_PREFIX?.replace(/\/$/, '');
if (!sha || !prefix) { console.error('usage: IMAGE_PREFIX=… node deploy/affected.mjs <sha> [affected|all|<component>,…]'); process.exit(2); }
const all = components();

let selected;
if (mode === 'all') selected = all.map(c => c.name);
else if (mode !== 'affected') {
  selected = mode.split(',').map(s => s.trim()).filter(Boolean);
  const unknown = selected.filter(name => !all.some(c => c.name === name));
  if (unknown.length) { console.error(`unknown component(s): ${unknown.join(', ')}`); process.exit(2); }
} else {
  selected = [];
  for (const c of all) {
    const deployed = labels(`${prefix}/${c.image}:demo-good`)?.commit;
    if (!deployed) { console.error(`${c.name}: nothing verified on the demo yet → deploy`); selected.push(c.name); continue; }
    if (deployed === sha) { console.error(`${c.name}: ${sha.slice(0, 12)} is already the verified version → skip`); continue; }
    const known = spawnSync('git', ['cat-file', '-e', `${deployed}^{commit}`]).status === 0;
    if (!known) { console.error(`${c.name}: verified ${deployed.slice(0, 12)} is not in this history → deploy`); selected.push(c.name); continue; }
    const changed = spawnSync('git', ['diff', '--quiet', deployed, sha, '--', ...c.paths]).status !== 0;
    console.error(`${c.name}: ${changed ? 'changed' : 'unchanged'} since verified ${deployed.slice(0, 12)} → ${changed ? 'deploy' : 'skip'}`);
    if (changed) selected.push(c.name);
  }
}
console.log(selected.join(','));
