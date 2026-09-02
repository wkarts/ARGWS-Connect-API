import assert from 'node:assert/strict';
import fs from 'node:fs';

const policy = fs.readFileSync('src/api/compat/meta-cloud/meta-cloud-policy.service.ts', 'utf8');
assert.match(policy, /PERMISSIVE/);
assert.match(policy, /OBSERVE/);
assert.match(policy, /STRICT/);
assert.match(policy, /131047/);
assert.match(policy, /DELEGATED_TO_META/);

const interaction = fs.readFileSync('src/api/services/interaction-engine.service.ts', 'utf8');
assert.match(interaction, /listStrongConfirmations/);
assert.match(interaction, /approveStrongConfirmation/);
assert.match(interaction, /PROCESSING_STRONG_CONFIRMATION/);
assert.match(interaction, /strongInput/);

const packageSource = fs.readFileSync('src/api/recipes/official/scheduler-pro.ts', 'utf8');
for (const key of [
  'scheduler.appointment.get',
  'scheduler.appointment.confirm',
  'scheduler.appointment.cancel',
  'scheduler.appointment.reschedule',
  'scheduler.availability.find',
  'scheduler_appointment_confirmation',
]) assert.match(packageSource, new RegExp(key.replaceAll('.', '\\.')));

const router = fs.readFileSync('src/api/routes/index.router.ts', 'utf8');
assert.match(router, /globalApiKey/);
assert.match(router, /interaction\/strong/);

console.log('conversational platform phase4: ok');
