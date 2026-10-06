import { RouterBroker } from '@api/abstract/abstract.router';
import { normalizeMessagePayload } from '@api/compat/message-payload.compat';
import {
  SendAudioDto,
  SendButtonsDto,
  SendContactDto,
  SendListDto,
  SendLocationDto,
  SendMediaDto,
  SendPollDto,
  SendPtvDto,
  SendReactionDto,
  SendStatusDto,
  SendStickerDto,
  SendTemplateDto,
  SendTextDto,
} from '@api/dto/sendMessage.dto';
import { sendMessageController } from '@api/server.module';
import {
  audioMessageSchema,
  buttonsMessageSchema,
  contactMessageSchema,
  listMessageSchema,
  locationMessageSchema,
  mediaMessageSchema,
  pollMessageSchema,
  ptvMessageSchema,
  reactionMessageSchema,
  statusMessageSchema,
  stickerMessageSchema,
  templateMessageSchema,
  textMessageSchema,
} from '@validate/validate.schema';
import { Request, RequestHandler, Router } from 'express';
import multer from 'multer';

import { HttpStatus } from './index.router';

const upload = multer({ storage: multer.memoryStorage() });
const audioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

const parseAudioUpload: RequestHandler = (req, res, next) => {
  audioUpload.single('file')(req, res, (error: any) => {
    if (!error) return next();
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    res.status(status).json({ status, error: status === 413 ? 'O áudio excede 25 MiB.' : 'Upload de áudio inválido.' });
  });
};

function normalizeRequestBody(req: Request) {
  req.body = normalizeMessagePayload(req.body);
}

function normalizeAudioRequestBody(req: Request) {
  normalizeRequestBody(req);
  // multer sends all multipart fields as strings. Never coerce arbitrary values.
  for (const field of ['ptt', 'recordedByMicrophone', 'encoding']) {
    if (req.body?.[field] === 'true') req.body[field] = true;
    if (req.body?.[field] === 'false') req.body[field] = false;
  }
}

function normalizeStatusRequestBody(req: Request) {
  normalizeRequestBody(req);
  const body = req.body || {};
  for (const field of ['statusJidList']) {
    if (typeof body[field] !== 'string') continue;
    try {
      body[field] = JSON.parse(body[field]);
    } catch {
      body[field] = body[field].split(/[\s,;\n]+/u).filter(Boolean);
    }
  }
  if (typeof body.allContacts === 'string') {
    body.allContacts = ['true', '1', 'yes', 'on'].includes(body.allContacts.trim().toLowerCase());
  }
  if (typeof body.font === 'string' && body.font.trim()) body.font = Number(body.font);
}

export class MessageRouter extends RouterBroker {
  constructor(...guards: RequestHandler[]) {
    super();
    this.router
      .post(this.routerPath('sendTemplate'), ...guards, async (req, res) => {
        const instanceName = req.params.instanceName;
        normalizeRequestBody(req);
        const response = await this.dataValidate<SendTemplateDto>({
          request: req,
          schema: templateMessageSchema,
          ClassRef: SendTemplateDto,
          execute: (_instance, data) => sendMessageController.sendTemplate({ instanceName }, data),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendText'), ...guards, async (req, res) => {
        normalizeRequestBody(req);
        const response = await this.dataValidate<SendTextDto>({
          request: req,
          schema: textMessageSchema,
          ClassRef: SendTextDto,
          execute: (instance, data) => sendMessageController.sendText(instance, data),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendMedia'), ...guards, upload.single('file'), async (req, res) => {
        normalizeRequestBody(req);
        const response = await this.dataValidate<SendMediaDto>({
          request: req,
          schema: mediaMessageSchema,
          ClassRef: SendMediaDto,
          execute: (instance, data) => sendMessageController.sendMedia(instance, data, req.file as any),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendPtv'), ...guards, upload.single('file'), async (req, res) => {
        normalizeRequestBody(req);
        const response = await this.dataValidate<SendPtvDto>({
          request: req,
          schema: ptvMessageSchema,
          ClassRef: SendPtvDto,
          execute: (instance, data) => sendMessageController.sendPtv(instance, data, req.file as any),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendWhatsAppAudio'), ...guards, parseAudioUpload, async (req, res) => {
        normalizeAudioRequestBody(req);
        const response = await this.dataValidate<SendAudioDto>({
          request: req,
          schema: audioMessageSchema,
          ClassRef: SendAudioDto,
          execute: (instance, data) => sendMessageController.sendWhatsAppAudio(instance, data, req.file as any),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendStatus'), ...guards, upload.single('file'), async (req, res) => {
        normalizeStatusRequestBody(req);
        const response = await this.dataValidate<SendStatusDto>({
          request: req,
          schema: statusMessageSchema,
          ClassRef: SendStatusDto,
          execute: (instance, data) => sendMessageController.sendStatus(instance, data, req.file as any),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendSticker'), ...guards, upload.single('file'), async (req, res) => {
        normalizeRequestBody(req);
        const response = await this.dataValidate<SendStickerDto>({
          request: req,
          schema: stickerMessageSchema,
          ClassRef: SendStickerDto,
          execute: (instance, data) => sendMessageController.sendSticker(instance, data, req.file as any),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendLocation'), ...guards, async (req, res) => {
        normalizeRequestBody(req);
        const response = await this.dataValidate<SendLocationDto>({
          request: req,
          schema: locationMessageSchema,
          ClassRef: SendLocationDto,
          execute: (instance, data) => sendMessageController.sendLocation(instance, data),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendContact'), ...guards, async (req, res) => {
        normalizeRequestBody(req);
        const response = await this.dataValidate<SendContactDto>({
          request: req,
          schema: contactMessageSchema,
          ClassRef: SendContactDto,
          execute: (instance, data) => sendMessageController.sendContact(instance, data),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendReaction'), ...guards, async (req, res) => {
        normalizeRequestBody(req);
        const response = await this.dataValidate<SendReactionDto>({
          request: req,
          schema: reactionMessageSchema,
          ClassRef: SendReactionDto,
          execute: (instance, data) => sendMessageController.sendReaction(instance, data),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendPoll'), ...guards, async (req, res) => {
        normalizeRequestBody(req);
        const response = await this.dataValidate<SendPollDto>({
          request: req,
          schema: pollMessageSchema,
          ClassRef: SendPollDto,
          execute: (instance, data) => sendMessageController.sendPoll(instance, data),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendList'), ...guards, async (req, res) => {
        normalizeRequestBody(req);
        const response = await this.dataValidate<SendListDto>({
          request: req,
          schema: listMessageSchema,
          ClassRef: SendListDto,
          execute: (instance, data) => sendMessageController.sendList(instance, data),
        });

        return res.status(HttpStatus.CREATED).json(response);
      })
      .post(this.routerPath('sendButtons'), ...guards, async (req, res) => {
        normalizeRequestBody(req);
        const response = await this.dataValidate<SendButtonsDto>({
          request: req,
          schema: buttonsMessageSchema,
          ClassRef: SendButtonsDto,
          execute: (instance, data) => sendMessageController.sendButtons(instance, data),
        });

        return res.status(HttpStatus.CREATED).json(response);
      });
  }

  public readonly router: Router = Router();
}
