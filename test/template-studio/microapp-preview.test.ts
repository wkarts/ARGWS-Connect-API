import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const previewPath = path.join(root, 'manager/dist/assets/template-studio-microapp-preview.js');
const htmlPath = path.join(root, 'manager/dist/template-editor.html');
const helperPath = path.join(root, 'src/api/services/micro-app-auto-launch.ts');
const enginePath = path.join(root, 'src/api/services/template-engine.service.ts');

const preview = fs.readFileSync(previewPath, 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8');
const helper = fs.readFileSync(helperPath, 'utf8');
const engine = fs.readFileSync(enginePath, 'utf8');

assert.match(preview, /MICRO APP PREVIEW/);
assert.match(preview, /data-preview-clock/);
assert.match(preview, /microapp-launch-preview/);
assert.match(preview, /CONTACT/);
assert.match(preview, /LOCATION/);
assert.match(html, /template-studio-microapp-preview\.js/);
assert.match(helper, /buttonText\?: string/);
assert.match(helper, /launchMode\?: 'BUTTON' \| 'LINK'/);
assert.match(engine, /autoLaunch\.policy\.buttonText/);
assert.match(engine, /runtime\.buttonMessage/);
assert.match(engine, /MICRO_APP_CTA_FALLBACK/);

console.log('Template Studio Micro App preview + launch CTA contract: OK');
