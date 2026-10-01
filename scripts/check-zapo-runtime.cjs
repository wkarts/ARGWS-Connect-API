'use strict';

// Keep the runtime on the official Zapo packages. This check is intentionally
// strict so a transitive reintroduction of the previously selected vendor line
// or either optional WAM telemetry package fails before an image is published.
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
const lockfile = fs.readFileSync(path.join(projectRoot, 'package-lock.json'), 'utf8');
const allDependencies = {
  ...(manifest.dependencies || {}),
  ...(manifest.devDependencies || {}),
  ...(manifest.optionalDependencies || {}),
};

const expected = {
  core: '1.9.0',
  voip: '1.1.0',
  store: '1.2.0',
  migrator: '0.1.1',
};

const forbidden = [
  '@innovatorssoft/zapo-js',
  '@innovatorssoft/voip',
  '@innovatorssoft/store-postgres',
  '@innovatorssoft/wam',
  '@zapo-js/wam',
];

for (const name of forbidden) {
  if (Object.prototype.hasOwnProperty.call(allDependencies, name) || lockfile.includes(`"${name}"`)) {
    throw new Error(`Forbidden Zapo dependency found: ${name}`);
  }
}

function readInstalledPackage(name) {
  let directory = path.dirname(require.resolve(name));
  for (let index = 0; index < 6; index += 1) {
    const filename = path.join(directory, 'package.json');
    if (fs.existsSync(filename)) {
      const metadata = JSON.parse(fs.readFileSync(filename, 'utf8'));
      if (metadata.name === name) return metadata;
    }
    directory = path.dirname(directory);
  }
  throw new Error(`Unable to locate installed metadata for ${name}`);
}

const corePackage = readInstalledPackage('zapo-js');
const voipPackage = readInstalledPackage('@zapo-js/voip');
const storePackage = readInstalledPackage('@zapo-js/store-postgres');
const migratorPackage = readInstalledPackage('wa-store-migrate');

if (corePackage.version !== expected.core) {
  throw new Error(`Official zapo-js version mismatch: ${corePackage.version}`);
}
if (voipPackage.version !== expected.voip) {
  throw new Error(`Official @zapo-js/voip version mismatch: ${voipPackage.version}`);
}
if (storePackage.version !== expected.store) {
  throw new Error(`Official @zapo-js/store-postgres version mismatch: ${storePackage.version}`);
}
if (migratorPackage.version !== expected.migrator) {
  throw new Error(`wa-store-migrate version mismatch: ${migratorPackage.version}`);
}

const resolved = [
  require.resolve('zapo-js/util'),
  require.resolve('@zapo-js/voip'),
  require.resolve('@zapo-js/store-postgres'),
  require.resolve('wa-store-migrate'),
];

console.log(
  `Official Zapo runtime dependencies OK (zapo-js ${corePackage.version}, ` +
    `@zapo-js/voip ${voipPackage.version}, ` +
    `@zapo-js/store-postgres ${storePackage.version}, ` +
    `migrator ${migratorPackage.version}); WAM disabled -> ${resolved.join(', ')}`,
);
