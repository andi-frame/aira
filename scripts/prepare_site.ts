import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = dirname(import.meta.dir);
const sourceDemo = join(root, 'public', 'demo');
const targetDemo = join(root, 'landing', 'public', 'demo');
const sourceIcons = join(root, 'icons');
const targetAssets = join(root, 'landing', 'public', 'assets');

if (!existsSync(sourceDemo)) throw new Error('Folder public/demo tidak ditemukan.');
if (existsSync(targetDemo)) rmSync(targetDemo, { recursive: true, force: true });
mkdirSync(join(root, 'landing', 'public'), { recursive: true });
cpSync(sourceDemo, targetDemo, { recursive: true });

if (existsSync(sourceIcons)) {
  if (existsSync(targetAssets)) rmSync(targetAssets, { recursive: true, force: true });
  mkdirSync(targetAssets, { recursive: true });
  cpSync(sourceIcons, targetAssets, { recursive: true });
}

console.log('[AIRA site] ✓ Portal demo dan aset ikon disiapkan.');
