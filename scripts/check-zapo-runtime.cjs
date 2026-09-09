'use strict';

const aliasUtil = require.resolve('zapo-js/util');
const aliasPackage = require('zapo-js/package.json');
const scopedPackage = require('@innovatorssoft/zapo-js/package.json');
const migratorPackage = require('wa-store-migrate/package.json');

if (aliasPackage.version !== scopedPackage.version) {
  throw new Error(
    `Zapo alias mismatch: alias=${aliasPackage.version} scoped=${scopedPackage.version}`,
  );
}

require('@innovatorssoft/store-postgres');
require.resolve('wa-store-migrate');

if (migratorPackage.version !== '0.1.1') {
  throw new Error(`wa-store-migrate version mismatch: ${migratorPackage.version}`);
}

console.log(`Zapo runtime dependencies OK (${scopedPackage.version}, migrator ${migratorPackage.version}) -> ${aliasUtil}`);
