// Bündelt den Server nach dist/server. Abhängigkeiten bleiben extern (node_modules im Image).
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

await build({
  entryPoints: ['src/server/main.ts', 'src/server/cli.ts'],
  outdir: 'dist/server',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  packages: 'external',
  sourcemap: 'linked',
  define: { 'process.env.FILUM_BUILD_VERSION': JSON.stringify(pkg.version) },
  banner: { js: '// Filum – selbst gehostetes Link-Management-Studio' },
  logLevel: 'info',
});
