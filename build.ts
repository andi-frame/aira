/**
 * AIRA - Build Script (Bun + TypeScript)
 * Correctly compiles TypeScript entrypoints into their respective dist subdirectories
 */

import { existsSync, rmSync, mkdirSync, cpSync } from 'fs';
import { join } from 'path';

const ROOT_DIR = __dirname;
const DIST_DIR = join(ROOT_DIR, 'dist');
const PUBLIC_DIR = join(ROOT_DIR, 'public');
const ICONS_DIR = join(ROOT_DIR, 'icons');

async function build() {
  const startTime = performance.now();
  console.log('[AIRA Build] Starting Bun + TypeScript build...');

  // 1. Clean dist directory
  if (existsSync(DIST_DIR)) {
    rmSync(DIST_DIR, { recursive: true, force: true });
  }
  mkdirSync(DIST_DIR, { recursive: true });

  // 2. Build background service worker -> dist/background/service_worker.js
  const bgBuild = await Bun.build({
    entrypoints: [join(ROOT_DIR, 'src', 'background', 'service_worker.ts')],
    outdir: join(DIST_DIR, 'background'),
    target: 'browser',
    format: 'esm',
    sourcemap: 'none',
    minify: false
  });
  if (!bgBuild.success) {
    console.error('[AIRA Build] Background build failed:', bgBuild.logs);
    process.exit(1);
  }

  // 3. Build content script -> dist/content/content_script.js
  const contentBuild = await Bun.build({
    entrypoints: [join(ROOT_DIR, 'src', 'content', 'content_script.ts')],
    outdir: join(DIST_DIR, 'content'),
    target: 'browser',
    format: 'esm',
    sourcemap: 'none',
    minify: false
  });
  if (!contentBuild.success) {
    console.error('[AIRA Build] Content build failed:', contentBuild.logs);
    process.exit(1);
  }

  // 4. Build popup script -> dist/popup/popup.js
  const popupBuild = await Bun.build({
    entrypoints: [join(ROOT_DIR, 'src', 'popup', 'popup.ts')],
    outdir: join(DIST_DIR, 'popup'),
    target: 'browser',
    format: 'esm',
    sourcemap: 'none',
    minify: false
  });
  if (!popupBuild.success) {
    console.error('[AIRA Build] Popup build failed:', popupBuild.logs);
    process.exit(1);
  }

  // 5. Copy Static Assets
  // manifest.json
  cpSync(join(PUBLIC_DIR, 'manifest.json'), join(DIST_DIR, 'manifest.json'));

  // popup HTML and CSS
  mkdirSync(join(DIST_DIR, 'popup'), { recursive: true });
  cpSync(join(PUBLIC_DIR, 'popup', 'popup.html'), join(DIST_DIR, 'popup', 'popup.html'));
  cpSync(join(PUBLIC_DIR, 'popup', 'popup.css'), join(DIST_DIR, 'popup', 'popup.css'));

  // content stylesheet
  mkdirSync(join(DIST_DIR, 'content'), { recursive: true });
  cpSync(join(ROOT_DIR, 'src', 'content', 'content_style.css'), join(DIST_DIR, 'content', 'content_style.css'));

  // icons
  mkdirSync(join(DIST_DIR, 'icons'), { recursive: true });
  if (existsSync(ICONS_DIR)) {
    cpSync(ICONS_DIR, join(DIST_DIR, 'icons'), { recursive: true });
  }

  // demo portal
  mkdirSync(join(DIST_DIR, 'demo'), { recursive: true });
  cpSync(join(PUBLIC_DIR, 'demo'), join(DIST_DIR, 'demo'), { recursive: true });

  const duration = (performance.now() - startTime).toFixed(1);
  console.log(`[AIRA Build] ✓ All bundles built successfully in ${duration}ms! Output: ${DIST_DIR}`);
}

build().catch((err) => {
  console.error('[AIRA Build] Error:', err);
  process.exit(1);
});
