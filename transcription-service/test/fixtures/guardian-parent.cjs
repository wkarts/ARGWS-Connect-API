'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const { InferenceClient } = require('../../src/inference-client');
(async () => {
  const client = new InferenceClient({ processKillGraceMs: 50, executionLeaseSeconds: 10 }, {
    workerPath: path.join(__dirname, 'stalling-inference.cjs'), stallTimeoutMs: 60000, chunkDeadlineMs: 60000,
  });
  await client.warmup();
  const pidFile = process.argv[2];
  void client.transcribe('blocked.ogg', { stall: true, grandchildPidFile: pidFile }).catch(() => {});
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await fs.access(pidFile).then(() => true, () => false)) {
      process.send({ ready: true, groupId: client.child.pid, directory: client.tempDirectory });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Engine fixture did not start.');
})().catch((error) => { console.error(error); process.exit(1); });
