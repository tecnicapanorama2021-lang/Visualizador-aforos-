/**
 * Verificación: en la raíz del repo solo archivos canónicos.
 * - .md: solo README.md (resto → docs/referencia)
 * - .py: ninguno (→ scripts/python)
 * - install_dependencies.*, requirements.txt → scripts/setup y scripts/python
 * - MAPEO_CAMPOS_IDECA.json, socrata_metadata.json, .historial_progress.json → data/
 * - *.msi → deprecated/
 * Uso: node scripts/check-root-clean.js
 * Exit 0 si la raíz está "limpia"; exit 1 si hay archivos que deben estar en otras carpetas.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const FILES_MUST_NOT_BE_IN_ROOT = [
  'install_dependencies.bat',
  'install_dependencies.sh',
  'requirements.txt',
  'MAPEO_CAMPOS_IDECA.json',
  'socrata_metadata.json',
  '.historial_progress.json',
];

const files = fs.readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isFile());
const bad = [];
for (const f of files) {
  const name = f.name;
  if (name.endsWith('.md') && name !== 'README.md') bad.push(name);
  if (name.endsWith('.py')) bad.push(name);
  if (FILES_MUST_NOT_BE_IN_ROOT.includes(name)) bad.push(name);
  if (name.endsWith('.msi')) bad.push(name);
}
if (bad.length === 0) {
  console.log('OK: raíz limpia (solo archivos canónicos: README.md, package*.json, server.js, configs, index.html, .env.example, .gitignore, .nvmrc, nixpacks.toml, render.yaml)');
  process.exit(0);
}
console.error('Regresión: estos archivos no deben estar en la raíz:');
console.error('  .md (excepto README.md) → docs/referencia/');
console.error('  .py → scripts/python/');
console.error('  install_dependencies.*, requirements.txt → scripts/setup/, scripts/python/');
console.error('  MAPEO_CAMPOS_IDECA.json, socrata_metadata.json, .historial_progress.json → data/');
console.error('  *.msi → deprecated/');
bad.forEach((b) => console.error('  -', b));
process.exit(1);
