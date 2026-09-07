import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const pub = path.join(root, 'public');
const template = path.join(root, 'index.html');
const buildMode = process.env.MANAGER_BUILD_MODE === 'development' ? 'development' : 'production';
const esbuildVersion = process.env.MANAGER_ESBUILD_VERSION || '0.25.9';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function runEsbuild(entry, outfile, extra = []) {
  const args = [
    '--yes',
    `esbuild@${esbuildVersion}`,
    entry,
    '--bundle',
    '--platform=browser',
    '--target=es2020',
    `--outfile=${outfile}`,
    ...extra,
  ];

  if (buildMode === 'production') {
    args.push('--minify', '--legal-comments=none');
  } else {
    args.push('--sourcemap=linked');
  }

  const result = spawnSync(npx, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    throw new Error(`esbuild falhou para ${entry} (exit ${result.status ?? 'unknown'})`);
  }
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'assets', 'app', 'styles'), { recursive: true });
fs.cpSync(pub, dist, { recursive: true });
fs.copyFileSync(template, path.join(dist, 'index.html'));

runEsbuild('src/main.js', 'dist/assets/app/main.js', ['--format=esm']);
runEsbuild('src/styles/app.css', 'dist/assets/app/styles/app.css');

for (const required of [
  'index.html',
  'assets/app/main.js',
  'assets/app/styles/app.css',
  'assets/runtime-config.js',
]) {
  if (!fs.existsSync(path.join(dist, required))) throw new Error(`Build incompleto: ${required}`);
}

for (const forbiddenDirectory of ['api', 'components', 'core', 'pages']) {
  const candidate = path.join(dist, 'assets', 'app', forbiddenDirectory);
  if (fs.existsSync(candidate)) throw new Error(`Build de produção não deve copiar src: ${candidate}`);
}

console.log(`Manager ${buildMode} bundle generated at ${dist} using esbuild ${esbuildVersion}`);
