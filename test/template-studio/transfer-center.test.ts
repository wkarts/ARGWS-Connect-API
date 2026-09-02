import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('manager/dist/template-editor.html', 'utf8');
const script = fs.readFileSync('manager/dist/assets/template-studio-transfer.js', 'utf8');
const css = fs.readFileSync('manager/dist/assets/template-studio-transfer.css', 'utf8');

assert.match(html, /template-studio-transfer\.css/);
assert.match(html, /template-studio-transfer\.js/);
assert.match(script, /argws\.connect\.studio\.bundle/);
assert.match(script, /META_JSON/);
assert.match(script, /NDJSON/);
assert.match(script, /CSV/);
assert.match(script, /MICRO_APP/);
assert.match(script, /credentialRef/);
assert.match(script, /SECRET_KEY/);
assert.match(script, /transferConflictStrategy/);
assert.match(script, /REPLACE/);
assert.match(script, /RENAME/);
assert.match(script, /SKIP/);
assert.match(script, /System\/default|SYSTEM\/default/i);
assert.match(css, /@media\(max-width:900px\)/);
assert.match(css, /@media\(max-width:600px\)/);

console.log('template studio transfer center: ok');
