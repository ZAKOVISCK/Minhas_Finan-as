import { readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const ignored = new Set(['.git', 'node_modules', '.cache', '__pycache__', 'test-results', 'playwright-report']);
const sources = [];

async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (entry.isFile() && /\.(?:mjs|js)$/.test(entry.name)) sources.push(path);
  }
}

await collect(root);
for (const source of sources.sort()) {
  const result = spawnSync(process.execPath, ['--check', source], { stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    console.error(`Sintaxe inválida: ${relative(root, source)}`);
    if (result.error) console.error(result.error.message);
    process.exit(result.status || 1);
  }
}
console.log(`Sintaxe verificada em ${sources.length} arquivos JavaScript.`);
