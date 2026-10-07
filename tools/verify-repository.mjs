import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
export function validateRepository(remote, status, branch) {
  if (!/^(https:\/\/github\.com\/|git@github\.com:)mahdiporkar\/hive-platform(?:\.git)?$/.test(remote.trim())) {
    throw new Error('Writes require mahdiporkar/hive-platform as origin');
  }
  if (!branch.trim()) throw new Error('Detached HEAD is not an approved write branch');
  return {branch: branch.trim(), dirty: status.trim().length > 0};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const git = (...args) => execFileSync('git', args, {encoding:'utf8'});
  const result = validateRepository(git('remote','get-url','origin'),git('status','--porcelain'),git('branch','--show-current'));
  const push = git('remote','get-url','--push','origin');
  validateRepository(push, '', result.branch);
  console.log(JSON.stringify({status:'PASS', ...result}));
}