#!/usr/bin/env node
/**
 * Production Client Build Script
 * Enforces NODE_ENV=production before Vite transforms modules, ensuring
 * that React production runtimes are bundled and dev transforms are stripped.
 */
process.env.NODE_ENV = 'production';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

await build({
  configFile: './vite.config.js',
  mode: 'production'
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distDir = path.resolve(__dirname, '../dist');
const indexHtml = path.join(distDir, 'index.html');
const notFoundHtml = path.join(distDir, '404.html');
const noJekyll = path.join(distDir, '.nojekyll');

if (fs.existsSync(indexHtml)) {
  fs.copyFileSync(indexHtml, notFoundHtml);
  fs.writeFileSync(noJekyll, '');
  console.log('[Build] Generated dist/404.html and dist/.nojekyll for SPA hosting.');
}

