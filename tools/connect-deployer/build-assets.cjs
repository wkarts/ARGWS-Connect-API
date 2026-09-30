#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const files = [
  'deploy/develop/compose.yaml',
  'deploy/develop/env.example',
  'deploy/homologation/compose.yaml',
  'deploy/homologation/env.example',
  'deploy/production/compose.yaml',
  'deploy/production/env.example',
  'deploy/canonical/compose.yaml',
  'deploy/canonical/env.example',
  'deploy/dockge/compose.yaml',
  'deploy/dockge/env.example',
  'deploy/cloudpanel/docker-compose.yml',
  'deploy/cloudpanel/env.example',
];

const output = {};
for (const file of files) output[file] = fs.readFileSync(path.join(root, file), 'utf8');
fs.writeFileSync(path.join(__dirname, 'templates.cjs'), `module.exports = ${JSON.stringify(output)};\n`);
