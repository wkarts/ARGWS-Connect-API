'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('novas instâncias ignoram grupos e status por padrão', () => {
  const controller = read('src/api/controllers/instance.controller.ts');
  const manager = read('manager/src/views/InstanceConfigView.vue');
  assert.match(controller, /groupsIgnore: true/);
  assert.match(controller, /readStatus: false/);
  assert.match(manager, /groupsIgnore:true/);
  assert.match(manager, /readStatus:false/);
});

test('visão de armazenamento não abre exclusão arbitrária', () => {
  const service = read('src/api/services/manager-storage.service.ts');
  const router = read('src/api/routes/manager-storage.router.ts');
  const minio = read('src/api/integrations/storage/s3/libs/minio.server.ts');
  const view = read('manager/src/views/StorageView.vue');

  assert.match(router, /\/storage\/overview/);
  assert.match(router, /\/storage\/cleanup\/preview/);
  assert.match(router, /\/storage\/cleanup/);
  assert.match(service, /STORAGE_STATUS_RESOURCE = 'status-broadcast'/);
  assert.match(service, /input\.confirm !== true/);
  assert.match(service, /Objetos externos, sessões e integrações não são tocados/);
  assert.match(minio, /MANAGED_OBJECT_PREFIX = 'argws-connect-api\/'/);
  assert.match(view, /Digite LIMPAR STATUS para confirmar/);
  assert.match(view, /resource: 'status-broadcast'/);
  assert.doesNotMatch(view, /deleteStoredFile|removeObject|bucket\.remove/);
});
