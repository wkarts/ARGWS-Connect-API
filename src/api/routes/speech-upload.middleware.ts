import {
  speechUploadLimit,
  TranscriptionService,
  TranscriptionServiceError,
} from '@api/services/transcription.service';
import { Request, Response } from 'express';
import { mkdir, mkdtemp, opendir, rm, stat } from 'fs/promises';
import multer from 'multer';
import os from 'os';
import path from 'path';

import { speechInteger } from '../services/speech-policy';

export type SpeechRequest = Request & {
  speechInstanceId?: string;
  speechReservationId?: string;
  speechUploadInstanceId?: string;
};

export function speechUploadFailure(error: unknown, response: Response) {
  if (response.headersSent || response.destroyed) return;
  const known = error instanceof TranscriptionServiceError;
  const status = known ? error.status : 503;
  if (known && error.retryAfterSeconds) response.set('Retry-After', String(error.retryAfterSeconds));
  response
    .status(status)
    .json({ status, error: known ? error.message : 'Serviço de voz temporariamente indisponível.' });
}

/** Reserve a bounded durable slot before attaching a multipart parser or reading bytes. */
export async function receiveSpeechUpload(
  service: TranscriptionService,
  mode: 'dictation' | 'transcription',
  request: SpeechRequest,
  response: Response,
  completed: (filePath: string) => Promise<void>,
) {
  let reservationId: string | undefined;
  let directory: string | undefined;
  let timeout: NodeJS.Timeout | undefined;
  let aborted = false;
  const onAborted = () => {
    aborted = true;
  };
  const fail = speechUploadFailure;
  try {
    const type = String(request.get('content-type') || '');
    if (!type.toLowerCase().startsWith('multipart/form-data'))
      throw new TranscriptionServiceError('Envie o áudio como multipart/form-data.', 415);
    const length = Number(request.get('content-length'));
    // The per-part limit remains authoritative for chunked uploads and dishonest headers.
    if (Number.isFinite(length) && length > speechUploadLimit(mode) + 16_384)
      throw new TranscriptionServiceError('O áudio excede o limite configurado.', 413);
    request.speechUploadInstanceId = request.speechInstanceId || request.get('X-Speech-Instance-Id') || undefined;
    const reservation = await service.reserveUpload(mode, request.speechUploadInstanceId);
    reservationId = reservation.id;
    request.speechReservationId = reservation.id;
    const root = path.resolve(process.env.SPEECH_UPLOAD_DIR || path.join(os.tmpdir(), 'speech-uploads'));
    await mkdir(root, { recursive: true, mode: 0o700 });
    // Sweep at most 100 abandoned entries; live requests last < 120 seconds.
    await sweepSpeechUploads(root);
    directory = await mkdtemp(path.join(root, 'upload-'));
    const upload = multer({
      storage: multer.diskStorage({
        destination: directory,
        filename: (_req, _file, callback) => callback(null, 'audio'),
      }),
      limits: { fileSize: speechUploadLimit(mode), files: 1, fields: 8, fieldSize: 1024, parts: 9, headerPairs: 50 },
    });
    const parser = upload.single('audio');
    const remainingReservationMs = new Date(reservation.expiresAt).getTime() - Date.now();
    if (!Number.isFinite(remainingReservationMs) || remainingReservationMs <= 5000)
      throw new TranscriptionServiceError('A reserva de recepção do áudio expirou.', 408);
    // Leave time for hashing, storage and SQL commit. Even a shorter configured
    // reservation must never expire while its HTTP body is still being received.
    const receptionBudgetMs = Math.min(
      speechInteger('SPEECH_UPLOAD_TIMEOUT_SECONDS', 60, 10, 90) * 1000,
      Math.floor(remainingReservationMs / 3),
    );
    request.once('aborted', onAborted);
    await new Promise<void>((resolve, reject) => {
      timeout = setTimeout(() => {
        aborted = true;
        const error = new TranscriptionServiceError('O upload de áudio excedeu o prazo de recepção.', 408);
        fail(error, response);
        request.destroy();
        reject(error);
      }, receptionBudgetMs);
      timeout.unref?.();
      parser(request, response, (error: any) => {
        if (timeout) clearTimeout(timeout);
        if (error)
          reject(
            new TranscriptionServiceError(
              error.code === 'LIMIT_FILE_SIZE' ? 'O áudio excede o limite configurado.' : 'Upload de áudio inválido.',
              error.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
            ),
          );
        else resolve();
      });
    });
    if (aborted) throw new TranscriptionServiceError('Upload interrompido.', 408);
    if (!request.speechInstanceId && !request.get('X-Speech-Instance-Id') && request.body?.instanceId) {
      const instanceId = String(request.body.instanceId);
      await service.reassignAdministrativeUpload(reservationId!, instanceId);
      request.speechUploadInstanceId = instanceId;
    }
    // The disk destination and filename belong to this middleware. Keep that
    // capability out of req.file/body so client metadata never selects a path.
    await completed(path.join(directory, 'audio'));
  } catch (error) {
    fail(error, response);
  } finally {
    if (timeout) clearTimeout(timeout);
    request.off('aborted', onAborted);
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
    if (reservationId) await service.releaseUpload(reservationId).catch(() => {});
  }
}

let sweeping = false;
let lastSweep = 0;
async function sweepSpeechUploads(root: string) {
  if (sweeping || Date.now() - lastSweep < 60_000) return;
  sweeping = true;
  lastSweep = Date.now();
  try {
    const entries = await opendir(root);
    let checked = 0;
    for await (const entry of entries) {
      if (++checked > 100) break;
      if (!entry.isDirectory() || !entry.name.startsWith('upload-')) continue;
      const candidate = path.join(root, entry.name);
      const details = await stat(candidate).catch(() => null);
      if (details && details.mtimeMs < Date.now() - 900_000)
        await rm(candidate, { recursive: true, force: true }).catch(() => {});
    }
  } finally {
    sweeping = false;
  }
}
