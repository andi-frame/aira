import { dirname, join } from 'node:path';

const root = dirname(import.meta.dir);

function run(command: string[], cwd = root) {
  const result = Bun.spawnSync(command, { cwd, stdout: 'inherit', stderr: 'inherit' });
  if (!result.success) process.exit(result.exitCode || 1);
}

console.log('[AIRA site] Building extension...');
run(['bun', 'run', 'build.ts']);
console.log('[AIRA site] Packaging extension download...');
run(['bun', 'run', 'scripts/package_extension.ts']);
console.log('[AIRA site] Preparing public demo assets...');
run(['bun', 'run', 'scripts/prepare_site.ts']);
console.log('[AIRA site] Building Astro site...');
run(['bun', 'run', 'build'], join(root, 'landing'));
console.log('[AIRA site] ✓ Site build completed.');
