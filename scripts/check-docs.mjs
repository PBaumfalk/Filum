// Prüft alle relativen Links in README, CHANGELOG und docs/: Gibt es die Datei, gibt es den Anker?
// Aufruf: node scripts/check-docs.mjs   (Exit-Code 1 bei Fehlern; läuft auch in der CI)
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const files = ['README.md', 'CHANGELOG.md'];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.md')) files.push(p);
  }
};
walk('docs');

/** Anker wie GitHub: Kleinbuchstaben, Satzzeichen weg, Leerzeichen zu Bindestrich, Dubletten mit -1, -2 … */
const anchorsCache = new Map();
function anchors(file) {
  if (anchorsCache.has(file)) return anchorsCache.get(file);
  const seen = new Map();
  const set = new Set();
  let inCode = false;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.startsWith('```')) inCode = !inCode;
    const m = !inCode && /^#{1,6}\s+(.*)$/.exec(line);
    if (!m) continue;
    const base = m[1]
      .replace(/`/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s/g, '-');
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    set.add(n ? `${base}-${n}` : base);
  }
  anchorsCache.set(file, set);
  return set;
}

let errors = 0;
let checked = 0;
for (const file of files) {
  const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
  for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(https?:|mailto:)/.test(target)) continue;
    checked++;
    const [path, hash] = target.split('#');
    const abs = path ? resolve(dirname(file), decodeURIComponent(path)) : resolve(file);
    if (!existsSync(abs)) {
      console.error(`${file}: Datei fehlt: ${target}`);
      errors++;
    } else if (hash && abs.endsWith('.md') && !anchors(abs).has(decodeURIComponent(hash))) {
      console.error(`${file}: Anker fehlt: ${target}`);
      errors++;
    }
  }
}
console.log(`${checked} Links in ${files.length} Dateien geprüft, ${errors} Fehler.`);
process.exit(errors ? 1 : 0);
