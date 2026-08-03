import { cpSync, mkdirSync, rmSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
rmSync('dist/generated', { recursive: true, force: true });
cpSync('src/generated', 'dist/generated', { recursive: true });

console.log('Copied src/generated -> dist/generated');
