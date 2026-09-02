import assert from 'node:assert/strict';
import fs from 'node:fs';

import { containsProtectedTemplate, isProtectedTemplate } from '../../src/api/services/template-deletion-policy';

const html = fs.readFileSync('manager/dist/template-editor.html', 'utf8');
const css = fs.readFileSync('manager/dist/assets/template-studio-wizard.css', 'utf8');
const js = fs.readFileSync('manager/dist/assets/template-studio-wizard.js', 'utf8');

assert.match(css, /studio-wizard/);
assert.match(css, /@media\(max-width:920px\)/);
assert.match(css, /@media\(max-width:560px\)/);
assert.match(js, /Wizard de solução/);
assert.match(js, /Actions REST/);
assert.match(js, /WHATSAPP_LOCATION/);
assert.match(js, /REQUIRED_AUTO/);
assert.match(js, /Criar solução/);
assert.match(js, /template\/delete/);
assert.match(js, /action\/create/);
assert.match(js, /recipe\/create/);
assert.match(js, /template\/create/);
assert.doesNotThrow(() => new Function(js), 'wizard JavaScript must parse');

assert.equal(isProtectedTemplate({ origin: 'SYSTEM', isDefault: false }), true);
assert.equal(isProtectedTemplate({ origin: 'LOCAL', isDefault: true }), true);
assert.equal(isProtectedTemplate({ origin: 'LOCAL', isDefault: false }), false);
assert.equal(containsProtectedTemplate([{ origin: 'LOCAL' }, { origin: 'SYSTEM' }]), true);
assert.equal(containsProtectedTemplate([{ origin: 'LOCAL' }, { origin: 'META' }]), false);

// Wired by the branch validation workflow before merge.
assert.ok(html.includes('template-editor.css'));

console.log('template studio wizard UI: ok');
