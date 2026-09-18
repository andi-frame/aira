import { dirname } from 'node:path';

const root = dirname(import.meta.dir);

const build = Bun.spawnSync(['bun', 'run', 'scripts/site_build.ts'], { cwd: root, stdout: 'inherit', stderr: 'inherit' });
if (!build.success) process.exit(build.exitCode || 1);

const deploy = Bun.spawnSync(['bun', 'run', 'wrangler', '--', 'deploy', '--config', 'wrangler.jsonc'], { cwd: root, stdout: 'inherit', stderr: 'inherit' });
process.exit(deploy.exitCode || 0);
