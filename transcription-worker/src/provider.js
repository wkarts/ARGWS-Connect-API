'use strict';

const fs = require('node:fs');
const OpenAI = require('openai');

function createProvider(config) {
  if (config.provider !== 'openai') {
    throw new Error('TRANSCRIPTION_PROVIDER não suportado: ' + config.provider);
  }
  const client = new OpenAI({
    apiKey: config.openai.apiKey,
    timeout: config.openai.timeoutMs,
    maxRetries: 0,
  });

  return {
    async transcribe(filePath, input) {
      const result = await client.audio.transcriptions.create({
        file: fs.createReadStream(filePath),
        model: input.model || config.openai.model,
        ...(input.language ? { language: input.language } : {}),
        response_format: 'verbose_json',
      });
      return {
        text: String(result?.text || ''),
        language: result?.language ? String(result.language) : null,
        durationMs: Number.isFinite(Number(result?.duration)) ? Math.round(Number(result.duration) * 1000) : null,
        segments: Array.isArray(result?.segments) ? result.segments : null,
      };
    },
  };
}

module.exports = { createProvider };
