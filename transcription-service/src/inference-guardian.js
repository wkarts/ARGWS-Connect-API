'use strict';

// This process never loads a model or performs inference. It remains responsive
// when native code blocks the engine process and fences its entire process group
// if the coordinator disappears or stops renewing the parent watchdog.
const { fork, spawn } = require('node:child_process');
const path = require('node:path');
let engine;
let stopping = false;
let parentTimer;
let parentTimeoutMs = 10000;

function killGroup() {
  if (stopping) return;
  stopping = true;
  clearTimeout(parentTimer);
  if (process.platform === 'win32') {
    const task = spawn('taskkill', ['/pid', String(process.pid), '/T', '/F'], { stdio: 'ignore' });
    task.once('error', () => process.exit(1));
    return;
  }
  try { process.kill(-process.pid, 'SIGKILL'); } catch { process.exit(1); }
}

function watchParent() {
  clearTimeout(parentTimer);
  parentTimer = setTimeout(killGroup, parentTimeoutMs);
  parentTimer.unref?.();
}

process.once('disconnect', killGroup);
process.on('message', (message) => {
  if (stopping) return;
  if (message?.type === 'parent-heartbeat') { watchParent(); return; }
  if (message?.type === 'init' && !engine) {
    parentTimeoutMs = Math.min(10000, Math.max(2000, Number(message.parentTimeoutMs) || 10000));
    watchParent();
    engine = fork(message.enginePath || path.join(__dirname, 'inference-process.js'), [], {
      detached: false, serialization: 'advanced', execArgv: [],
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      env: { ...process.env, SPEECH_PROCESS_GROUP_ID: String(process.pid) },
    });
    engine.on('message', (reply) => {
      if (!process.connected) { killGroup(); return; }
      process.send(reply, (error) => { if (error) killGroup(); });
    });
    engine.once('error', () => killGroup());
    engine.once('exit', () => killGroup());
    engine.once('disconnect', () => killGroup());
  }
  if (engine?.connected) engine.send(message, (error) => { if (error) killGroup(); });
});
