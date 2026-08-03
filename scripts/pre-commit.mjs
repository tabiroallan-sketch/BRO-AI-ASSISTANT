import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { relative } from 'node:path';

const root = process.cwd();
const eslintBin = 'node_modules/eslint/bin/eslint.js';
const prettierBin = 'node_modules/prettier/bin/prettier.cjs';

if (!existsSync(eslintBin) || !existsSync(prettierBin)) {
  console.error('pre-commit: eslint or prettier not installed. Run npm install first.');
  process.exit(1);
}

function run(args, options) {
  try {
    return execFileSync(process.execPath, args, { stdio: 'inherit', ...options });
  } catch (error) {
    const { status } = error;
    process.exit(status ?? 1);
  }
}

const staged = execFileSync('git', [
  'diff',
  '--cached',
  '--name-only',
  '--diff-filter=ACMR',
  '--',
  '*.ts',
  '*.tsx',
  '*.js',
  '*.jsx',
])
  .toString()
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => !file.endsWith('.d.ts'));

if (staged.length === 0) {
  process.exit(0);
}

console.log(`pre-commit: checking ${staged.length} file(s)...`);

run([eslintBin, '--fix', '--no-warn-ignored', ...staged], { cwd: root });
run([prettierBin, '--write', ...staged], { cwd: root });

const reAdd = staged.map((file) => relative(root, file));
execFileSync('git', ['add', '--', ...reAdd], { stdio: 'inherit' });

console.log('pre-commit: done.');
