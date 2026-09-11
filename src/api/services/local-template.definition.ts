import { randomUUID } from 'crypto';

export const LOCAL_TEMPLATE_SOURCE = 'connectapi_local';
export const LOCAL_TEMPLATE_PROVIDERS = ['WHATSAPP-BAILEYS', 'WHATSAPP-ZAPO'];
export const DEFAULT_HELLO_TEXT = 'Olá! Como podemos ajudar?';
const NAME = /^[a-z][a-z0-9_]{0,63}$/;
const LANGUAGE = /^[a-z]{2,3}(?:_[A-Z]{2})?$/;
const PLACEHOLDER = /\{\{([1-9]\d*)\}\}/g;
const MAX_TEXT = 4096;

export class LocalTemplateError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = 'LocalTemplateError';
  }
}

export type LocalTemplateComponent = { type: 'HEADER' | 'BODY' | 'FOOTER'; text: string; format?: 'TEXT' };

export function isLocalTemplateProvider(provider: unknown): boolean {
  return typeof provider === 'string' && LOCAL_TEMPLATE_PROVIDERS.includes(provider);
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new LocalTemplateError('Campo não suportado neste modelo local.');
  }
}

export function templateIdentity(name: unknown, language: unknown) {
  if (typeof name !== 'string' || !NAME.test(name)) {
    throw new LocalTemplateError('Nome inválido: use até 64 caracteres, letras minúsculas, números e sublinhado.');
  }
  if (typeof language !== 'string' || !LANGUAGE.test(language)) {
    throw new LocalTemplateError('Idioma inválido. Exemplo: pt_BR.');
  }
  return { name, language };
}

export function placeholderCount(text: string): number {
  const positions = [...text.matchAll(PLACEHOLDER)].map((match) => Number(match[1]));
  if (text.replace(PLACEHOLDER, '').includes('{{') || text.replace(PLACEHOLDER, '').includes('}}')) {
    throw new LocalTemplateError('Use variáveis posicionais no formato {{1}}, {{2}} e assim por diante.');
  }
  const count = Math.max(0, ...positions);
  if (
    count > 20 ||
    Array.from({ length: count }, (_, index) => index + 1).some((index) => !positions.includes(index))
  ) {
    throw new LocalTemplateError('As variáveis de cada componente devem ser consecutivas, de {{1}} até {{20}}.');
  }
  return count;
}

export function validateTemplateComponents(value: unknown): LocalTemplateComponent[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
    throw new LocalTemplateError('Informe BODY e, opcionalmente, HEADER e FOOTER de texto.');
  }
  const seen = new Set<string>();
  const result = value.map((item) => {
    if (!object(item)) throw new LocalTemplateError('Componente inválido.');
    exactKeys(item, ['type', 'text', 'format']);
    const type = typeof item.type === 'string' ? item.type.toUpperCase() : '';
    if (!['HEADER', 'BODY', 'FOOTER'].includes(type) || seen.has(type)) {
      throw new LocalTemplateError('Componentes duplicados ou não suportados. Esta versão aceita somente texto.');
    }
    seen.add(type);
    if (item.format !== undefined && (type !== 'HEADER' || item.format !== 'TEXT')) {
      throw new LocalTemplateError('Somente HEADER com format TEXT é suportado.');
    }
    const text = item.text;
    const limit = type === 'BODY' ? MAX_TEXT : 60;
    if (typeof text !== 'string' || !text.trim() || text.length > limit || text.includes('\u0000')) {
      throw new LocalTemplateError(`Texto de ${type} inválido ou maior que ${limit} caracteres.`);
    }
    if (type !== 'BODY' && placeholderCount(text)) {
      throw new LocalTemplateError('Cabeçalho e rodapé não aceitam variáveis.');
    }
    placeholderCount(text);
    return { type, text, ...(type === 'HEADER' ? { format: 'TEXT' } : {}) } as LocalTemplateComponent;
  });
  if (!seen.has('BODY')) throw new LocalTemplateError('O componente BODY é obrigatório.');
  result.sort((a, b) => ['HEADER', 'BODY', 'FOOTER'].indexOf(a.type) - ['HEADER', 'BODY', 'FOOTER'].indexOf(b.type));
  if (result.map((item) => item.text).join('\n\n').length > MAX_TEXT) {
    throw new LocalTemplateError(`O modelo completo deve ter no máximo ${MAX_TEXT} caracteres.`);
  }
  return result;
}

export function validateTemplateCreate(value: unknown) {
  if (!object(value)) throw new LocalTemplateError('Dados do modelo inválidos.');
  exactKeys(value, ['name', 'language', 'components', 'enabled']);
  const identity = templateIdentity(value.name, value.language);
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
    throw new LocalTemplateError('enabled deve ser true ou false.');
  }
  return { ...identity, components: validateTemplateComponents(value.components), enabled: value.enabled ?? true };
}

export function validateTemplateEdit(value: unknown) {
  if (!object(value)) throw new LocalTemplateError('Dados de alteração inválidos.');
  exactKeys(value, ['name', 'language', 'version', 'components', 'enabled']);
  const identity = templateIdentity(value.name, value.language);
  if (!Number.isSafeInteger(value.version) || Number(value.version) < 1) {
    throw new LocalTemplateError('Informe a versão atual do modelo.');
  }
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') {
    throw new LocalTemplateError('enabled deve ser true ou false.');
  }
  if (value.components === undefined && value.enabled === undefined) {
    throw new LocalTemplateError('Informe componentes ou situação para alterar.');
  }
  return {
    ...identity,
    version: Number(value.version),
    ...(value.components !== undefined ? { components: validateTemplateComponents(value.components) } : {}),
    ...(value.enabled !== undefined ? { enabled: value.enabled as boolean } : {}),
  };
}

export function validateTemplateDelete(value: unknown) {
  if (!object(value)) throw new LocalTemplateError('Dados de exclusão inválidos.');
  exactKeys(value, ['name', 'language', 'version']);
  const identity = templateIdentity(value.name, value.language);
  if (!Number.isSafeInteger(value.version) || Number(value.version) < 1) {
    throw new LocalTemplateError('Informe a versão atual do modelo.');
  }
  return { ...identity, version: Number(value.version) };
}

// A real persisted record, not a response-time synthetic template.
export function defaultLocalTemplateRecord() {
  return {
    id: `lt_${randomUUID()}`,
    name: 'hello',
    language: 'pt_BR',
    components: [{ type: 'BODY', text: DEFAULT_HELLO_TEXT }],
    enabled: true,
    version: 1,
  };
}

export function renderLocalTemplate(definition: unknown, parameters: unknown): string {
  const components = validateTemplateComponents(definition);
  if (!Array.isArray(parameters) || parameters.length > 2) {
    throw new LocalTemplateError('Parâmetros inválidos. Somente HEADER/BODY de texto são aceitos.');
  }
  const supplied = new Map<string, string[]>();
  for (const item of parameters) {
    if (!object(item)) throw new LocalTemplateError('Parâmetro de componente inválido.');
    exactKeys(item, ['type', 'parameters']);
    const type = typeof item.type === 'string' ? item.type.toUpperCase() : '';
    if (!['HEADER', 'BODY'].includes(type) || supplied.has(type) || !components.some((c) => c.type === type)) {
      throw new LocalTemplateError('Componente de parâmetros duplicado ou inexistente no modelo.');
    }
    if (!Array.isArray(item.parameters) || item.parameters.length > 20) {
      throw new LocalTemplateError('Lista de parâmetros inválida.');
    }
    const values = item.parameters.map((parameter) => {
      if (!object(parameter)) throw new LocalTemplateError('Parâmetro inválido.');
      exactKeys(parameter, ['type', 'text']);
      if (
        parameter.type !== 'text' ||
        typeof parameter.text !== 'string' ||
        !parameter.text.trim() ||
        parameter.text.length > 1024 ||
        parameter.text.includes('\u0000')
      ) {
        throw new LocalTemplateError('Cada parâmetro deve ser texto não vazio, com até 1024 caracteres.');
      }
      return parameter.text;
    });
    supplied.set(type, values);
  }
  const rendered = components
    .map((component) => {
      const values = supplied.get(component.type) || [];
      if (values.length !== placeholderCount(component.text)) {
        throw new LocalTemplateError(`Quantidade de parâmetros incorreta para ${component.type}.`);
      }
      // Single substitution pass. Parameter values never become executable syntax.
      return component.text.replace(PLACEHOLDER, (_, position: string) => values[Number(position) - 1]);
    })
    .join('\n\n');
  if (rendered.length > MAX_TEXT) {
    throw new LocalTemplateError(`Mensagem renderizada maior que ${MAX_TEXT} caracteres.`);
  }
  return rendered;
}
