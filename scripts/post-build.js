/**
 * Post-build script
 * - Copy CRDT v2 JS files to dist
 * - Add shebang to CLI
 */

import { copyFileSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

console.log('[post-build] Running post-build tasks...');

// 1. Copy CRDT v2 files
const crdtSrc = join(root, 'src/crdt/v2/index.js');
const crdtDest = join(root, 'dist/crdt/v2/index.js');

if (existsSync(crdtSrc)) {
  mkdirSync(dirname(crdtDest), { recursive: true });
  copyFileSync(crdtSrc, crdtDest);
  console.log('[post-build] Copied CRDT v2 files');
}

// 2. Add shebang to CLI
const cliPath = join(root, 'dist/cli/index.js');
if (existsSync(cliPath)) {
  const content = readFileSync(cliPath, 'utf-8');
  if (!content.startsWith('#!/usr/bin/env node')) {
    writeFileSync(cliPath, '#!/usr/bin/env node\n' + content);
    console.log('[post-build] Added shebang to CLI');
  }
}

console.log('[post-build] Done!');
