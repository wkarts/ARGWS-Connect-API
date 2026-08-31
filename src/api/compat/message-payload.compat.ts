type JsonRecord = Record<string, any>;

const LEGACY_MESSAGE_WRAPPERS = [
  'textMessage',
  'mediaMessage',
  'audioMessage',
  'stickerMessage',
  'locationMessage',
  'contactMessage',
  'pollMessage',
  'listMessage',
  'buttonMessage',
  'buttonsMessage',
  'statusMessage',
  'templateMessage',
  'ptvMessage',
  'reactionMessage',
] as const;

const OPTION_FIELDS = [
  'delay',
  'presence',
  'quoted',
  'linkPreview',
  'encoding',
  'webhookUrl',
  'notConvertSticker',
] as const;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Em multipart/form-data, objetos legados costumam chegar serializados como
 * strings JSON. O parse é deliberadamente usado apenas em campos conhecidos
 * pela camada de compatibilidade, nunca de forma genérica sobre o payload.
 */
function parseKnownJson(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function copyMissing(target: JsonRecord, source: JsonRecord) {
  for (const [key, value] of Object.entries(source)) {
    if (target[key] === undefined) {
      target[key] = value;
    }
  }
}

function applyMentions(target: JsonRecord, mentions: unknown) {
  const parsedMentions = parseKnownJson(mentions);

  if (Array.isArray(parsedMentions) && target.mentioned === undefined) {
    target.mentioned = parsedMentions;
    return;
  }

  if (!isRecord(parsedMentions)) {
    return;
  }

  if (target.mentioned === undefined && Array.isArray(parsedMentions.mentioned)) {
    target.mentioned = parsedMentions.mentioned;
  }
  if (target.mentionsEveryOne === undefined && typeof parsedMentions.everyOne === 'boolean') {
    target.mentionsEveryOne = parsedMentions.everyOne;
  }
  if (target.mentionsEveryOne === undefined && typeof parsedMentions.mentionsEveryOne === 'boolean') {
    target.mentionsEveryOne = parsedMentions.mentionsEveryOne;
  }
}

function normalizeMentions(target: JsonRecord, input: JsonRecord, options: JsonRecord) {
  applyMentions(target, options.mentions);
  applyMentions(target, input.mentions);

  const optionMentioned = parseKnownJson(options.mentioned);
  if (target.mentioned === undefined && Array.isArray(optionMentioned)) {
    target.mentioned = optionMentioned;
  }

  if (target.mentionsEveryOne === undefined && typeof options.everyOne === 'boolean') {
    target.mentionsEveryOne = options.everyOne;
  }
  if (target.mentionsEveryOne === undefined && typeof options.mentionsEveryOne === 'boolean') {
    target.mentionsEveryOne = options.mentionsEveryOne;
  }

  // O schema atual historicamente usa `everyOne`, enquanto os serviços internos
  // usam `mentionsEveryOne`. Mantemos os dois aliases coerentes.
  if (target.mentionsEveryOne === undefined && typeof target.everyOne === 'boolean') {
    target.mentionsEveryOne = target.everyOne;
  }
  if (target.everyOne === undefined && typeof target.mentionsEveryOne === 'boolean') {
    target.everyOne = target.mentionsEveryOne;
  }
}

/**
 * Normaliza contratos de mensagem usados por clientes legados para o contrato
 * interno atual do ARGWS Connect API.
 *
 * Compatibilidade preservada:
 * - formato atual, com campos no nível raiz;
 * - formato legado, com `options` + `<tipo>Message`;
 * - envelopes legados serializados em multipart/form-data;
 * - formatos híbridos durante migrações graduais.
 *
 * Quando os dois formatos informam o mesmo campo, o valor do nível raiz tem
 * precedência. O wrapper legado somente preenche campos ausentes.
 */
export function normalizeMessagePayload(input: unknown): unknown {
  if (!isRecord(input)) {
    return input;
  }

  const normalized: JsonRecord = { ...input };
  const parsedOptions = parseKnownJson(input.options);
  const options = isRecord(parsedOptions) ? parsedOptions : {};

  for (const field of OPTION_FIELDS) {
    if (normalized[field] === undefined && options[field] !== undefined) {
      normalized[field] = options[field];
    }
  }

  normalizeMentions(normalized, input, options);

  for (const wrapperName of LEGACY_MESSAGE_WRAPPERS) {
    const wrapped = parseKnownJson(input[wrapperName]);

    if (isRecord(wrapped)) {
      copyMissing(normalized, wrapped);
    } else if (wrapperName === 'contactMessage' && Array.isArray(wrapped) && normalized.contact === undefined) {
      normalized.contact = wrapped;
    } else if (wrapperName === 'textMessage' && typeof wrapped === 'string' && normalized.text === undefined) {
      normalized.text = wrapped;
    }
  }

  // Alguns clientes 1.x enviavam contato como { contactMessage: { contacts: [...] } }.
  const parsedContactMessage = parseKnownJson(input.contactMessage);
  if (normalized.contact === undefined && isRecord(parsedContactMessage)) {
    const legacyContacts = parseKnownJson(parsedContactMessage.contacts);
    if (Array.isArray(legacyContacts)) {
      normalized.contact = legacyContacts;
    }
  }

  // Aliases encontrados em integrações antigas de mídia/documento.
  if (normalized.fileName === undefined && normalized.filename !== undefined) {
    normalized.fileName = normalized.filename;
  }
  if (normalized.mediatype === undefined && normalized.mediaType !== undefined) {
    normalized.mediatype = normalized.mediaType;
  }

  // O contrato interno não depende dos envelopes legados depois da normalização.
  delete normalized.options;
  delete normalized.mentions;
  for (const wrapperName of LEGACY_MESSAGE_WRAPPERS) {
    delete normalized[wrapperName];
  }

  return normalized;
}
