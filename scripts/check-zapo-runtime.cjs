'use strict';

const aliasUtil = require.resolve('zapo-js/util');
const aliasPackage = require('zapo-js/package.json');
const scopedPackage = require('@innovatorssoft/zapo-js/package.json');

if (aliasPackage.version !== scopedPackage.version) {
  throw new Error(
    `Zapo alias mismatch: alias=${aliasPackage.version} scoped=${scopedPackage.version}`,
  );
}

require('@innovatorssoft/store-postgres');

console.log(`Zapo runtime dependencies OK (${scopedPackage.version}) -> ${aliasUtil}`);
