import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateRepository} from '../../tools/verify-repository.mjs';
test('accepts exact target with clean and dirty worktrees', () => {
  assert.deepEqual(validateRepository('https://github.com/mahdiporkar/hive-platform.git\n','','platform-v1'), {branch:'platform-v1',dirty:false});
  assert.equal(validateRepository('git@github.com:mahdiporkar/hive-platform','?? new-file','platform-v1').dirty,true);
});
test('rejects other owners, suffix attacks, local origins and detached HEAD', () => {
  for (const url of ['https://github.com/other/hive-platform','https://github.com/mahdiporkar/hive-platform.evil','file:///hive-platform','https://github.com/mahdiporkar/reference']) {
    assert.throws(() => validateRepository(url,'','main'));
  }
  assert.throws(() => validateRepository('https://github.com/mahdiporkar/hive-platform','',''));
});