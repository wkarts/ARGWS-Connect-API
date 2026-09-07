import fs from 'node:fs';
import path from 'node:path';

const dataFile = process.env.MANAGER_DATA_FILE || '/data/manager-data.json';
const dataDir = path.dirname(dataFile);
const runtimeUid = Number(process.env.MANAGER_RUNTIME_UID || 1000);
const runtimeGid = Number(process.env.MANAGER_RUNTIME_GID || 1000);

function prepareWritableDataPath() {
  fs.mkdirSync(dataDir, { recursive: true });

  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    try {
      fs.chownSync(dataDir, runtimeUid, runtimeGid);
      fs.chmodSync(dataDir, 0o700);
    } catch (error) {
      console.error(`Falha ao preparar diretório persistente ${dataDir}: ${error.message}`);
      process.exit(1);
    }

    if (fs.existsSync(dataFile)) {
      try {
        fs.chownSync(dataFile, runtimeUid, runtimeGid);
        fs.chmodSync(dataFile, 0o600);
      } catch (error) {
        console.error(`Falha ao preparar arquivo persistente ${dataFile}: ${error.message}`);
        process.exit(1);
      }
    }

    try {
      process.setgid(runtimeGid);
      process.setuid(runtimeUid);
    } catch (error) {
      console.error(`Falha ao reduzir privilégios da Manager API: ${error.message}`);
      process.exit(1);
    }
  }
}

prepareWritableDataPath();
await import('./server.mjs');
