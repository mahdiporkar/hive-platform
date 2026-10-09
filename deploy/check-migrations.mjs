// Guards database migrations before anything is built or deployed. Migrations run automatically when the new service
// starts, and a failed deployment is rolled back by starting the previous image against the already-migrated
// database, so every migration must be:
//   • append-only: an applied migration file is never edited, renamed or deleted (Flyway would refuse to start);
//   • backward compatible (expand only): no statement that breaks the previous version, such as dropping or renaming a
//     table or column, unless the file carries the line `-- migration: contract (approved)` after a release in which
//     nothing uses the dropped object any more.
//
//   node deploy/check-migrations.mjs <base-commit> [<migration-dir>…]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [base, ...dirs] = process.argv.slice(2);
const directories = dirs.length ? dirs : ['services/authorization/src/main/resources/db/migration'];
if (!base || /^0+$/.test(base)) { console.log('No base commit (new branch): only destructive statements are checked.'); }
const git = argv => execFileSync('git', argv, { encoding: 'utf8' }).trim();
// Statement verbs that remove or rename something the previous version may still use (not, e.g., a trigger that
// merely mentions truncation).
const DESTRUCTIVE = /^\s*(drop\s+(table|column|schema|type|view)\b|truncate\b)|\balter\s+table\s+\S+\s+(drop\s+column|drop\s+constraint|rename\b)/i;
const APPROVED = /^--\s*migration:\s*contract\s*\(approved\)\s*$/im;
const problems = [];

for (const dir of directories) {
  let changes = [];
  if (base && !/^0+$/.test(base)) {
    changes = git(['diff', '--name-status', '--no-renames', `${base}...HEAD`, '--', dir]).split('\n').filter(Boolean).map(l => l.split('\t'));
  } else {
    changes = git(['ls-files', dir]).split('\n').filter(Boolean).map(file => ['A', file]);
  }
  for (const [status, file] of changes) {
    if (!/\.sql$/i.test(file)) continue;
    if (status !== 'A') { problems.push(`${file}: applied migrations are append-only (status ${status}); add a new migration instead`); continue; }
    const sql = readFileSync(file, 'utf8');
    const statements = sql.replace(/--.*$/gm, '').split(';');
    const destructive = statements.find(s => DESTRUCTIVE.test(s));
    if (destructive && !APPROVED.test(sql)) {
      problems.push(`${file}: "${destructive.trim().replace(/\s+/g, ' ').slice(0, 100)}" breaks the previous version; ` +
        'deploy an expand-only change first, and mark the later contract migration with "-- migration: contract (approved)"');
    }
  }
}
if (problems.length) {
  console.error(`Migration guard failed:\n${problems.map(p => `  ✖ ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`Migration guard passed (${directories.join(', ')}).`);
