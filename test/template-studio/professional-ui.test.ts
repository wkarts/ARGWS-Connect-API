import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('manager/dist/template-editor.html', 'utf8');
const css = fs.readFileSync('manager/dist/assets/template-studio-professional.css', 'utf8');
const js = fs.readFileSync('manager/dist/assets/template-studio-professional.js', 'utf8');

assert.match(html, /template-studio-professional\.css/);
assert.match(html, /template-studio-professional\.js/);
assert.match(css, /@media\(max-width:1499px\)/);
assert.match(css, /@media\(max-width:1180px\)/);
assert.match(css, /@media\(max-width:820px\)/);
assert.match(js, /Dados & APIs/);
assert.match(js, /Fluxo/);
assert.match(js, /\+ Adicionar interação/);
assert.match(js, /Resposta e JSON Explorer/);
assert.match(js, /REST → interação/);
assert.match(js, /Recipe Builder/);
assert.match(js, /connection-collapsed/);
assert.doesNotThrow(() => new Function(js), 'professional Studio JavaScript must parse');

console.log('template studio professional UI: ok');
