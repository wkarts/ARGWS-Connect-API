'use strict';

class FairScheduler {
  constructor(dictationWeight = 3) {
    this.pattern = [...Array(Math.min(10, Math.max(1, dictationWeight))).fill('dictation'), 'transcription'];
    this.turn = 0;
    this.buckets = { dictation: new Map(), transcription: new Map() };
    this.order = { dictation: [], transcription: [] };
    this.size = 0;
  }

  add(job, value) {
    const mode = job.mode === 'dictation' ? 'dictation' : 'transcription';
    const scope = job.scopeKey || job.instanceId || 'platform';
    let queue = this.buckets[mode].get(scope);
    if (!queue) { queue = []; this.buckets[mode].set(scope, queue); this.order[mode].push(scope); }
    queue.push(value); this.size += 1;
  }

  take() {
    if (!this.size) return null;
    const preferred = this.pattern[this.turn++ % this.pattern.length];
    const mode = this.order[preferred].length ? preferred : preferred === 'dictation' ? 'transcription' : 'dictation';
    const scope = this.order[mode].shift();
    const queue = this.buckets[mode].get(scope);
    const value = queue.shift();
    if (queue.length) this.order[mode].push(scope);
    else this.buckets[mode].delete(scope);
    this.size -= 1;
    return value;
  }
}

module.exports = { FairScheduler };
