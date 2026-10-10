'use strict';

const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function signalGroup(child, signal) {
  if (!child?.pid) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

async function groupHasLiveProcesses(pid) {
  // kill(0) uses the caller's PID namespace; /proc may be mounted from an outer
  // namespace in container/test executors. A plain /proc/stat pgrp comparison
  // would falsely report death while the native group still runs.
  try { process.kill(-pid, 0); } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
  if (process.platform !== 'linux') return true;
  const selfStatus = await fs.readFile('/proc/self/status', 'utf8');
  const depth = Math.max(0, (selfStatus.match(/^NSpid:\s*(.+)$/m)?.[1].trim().split(/\s+/).length || 1) - 1);
  const namespace = await fs.readlink('/proc/self/ns/pid');
  const entries = await fs.readdir('/proc');
  let observed = false;
  for (const name of entries) {
    if (!/^\d+$/.test(name)) continue;
    const status = await fs.readFile(`/proc/${name}/status`, 'utf8').catch(() => '');
    const groups = status.match(/^NSpgid:\s*(.+)$/m)?.[1].trim().split(/\s+/) || [];
    if (Number(groups[depth]) !== pid) continue;
    const processNamespace = await fs.readlink(`/proc/${name}/ns/pid`).catch(() => null);
    if (processNamespace !== namespace) continue;
    observed = true;
    const state = status.match(/^State:\s*(\S+)/m)?.[1];
    if (state !== 'Z' && state !== 'X') return true;
  }
  if (observed) return false;
  // Race with kernel reaping, or an inaccessible namespace: fail closed.
  try { process.kill(-pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

async function terminateProcessGroup(child, graceMs = 1000) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    await new Promise((resolve, reject) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      killer.once('error', reject);
      killer.once('close', resolve);
    });
    return;
  }
  signalGroup(child, 'SIGTERM');
  const gracefulDeadline = Date.now() + graceMs;
  while (Date.now() < gracefulDeadline && await groupHasLiveProcesses(child.pid)) await delay(25);
  // Always signal the entire group, even when its leader already exited.
  signalGroup(child, 'SIGKILL');
  const killDeadline = Date.now() + 2000;
  while (Date.now() < killDeadline) {
    if (!await groupHasLiveProcesses(child.pid)) return;
    await delay(25);
  }
  throw Object.assign(new Error('O grupo nativo não confirmou encerramento; nova inferência foi bloqueada.'), {
    code: 'PROCESS_TERMINATION_FAILED', retryable: false,
  });
}

module.exports = { terminateProcessGroup, groupHasLiveProcesses };
