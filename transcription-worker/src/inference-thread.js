'use strict';

// Kept as a path compatibility shim. Inference now requires child_process IPC;
// worker_threads cannot guarantee interruption of blocked native computation.
if (!process.send) throw new Error('Use InferenceClient para iniciar o processo supervisionado.');
require('./inference-process');
