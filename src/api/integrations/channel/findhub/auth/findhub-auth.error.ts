/** Fixed, non-sensitive errors. Never retain upstream bodies, URLs, cookies or credentials. */
const MESSAGES = {
  9101: 'O artefato de login recebido é inválido. Inicie uma nova vinculação.',
  9102: 'O Google recusou o artefato de login. Conclua o consentimento na aba Google e inicie uma nova vinculação. Não reutilize a tentativa anterior.',
  9103: 'O Google exige confirmação adicional. Conclua os desafios diretamente no Google e inicie uma nova vinculação.',
  9104: 'A conta autenticada no Google é diferente da conta solicitada. Selecione a conta correta na aba Google.',
  9105: 'O Google não retornou a credencial exigida. Inicie uma nova vinculação.',
  9106: 'O Google retornou uma resposta de autenticação inesperada. Nenhuma conta foi conectada.',
  9107: 'O servidor não recebeu a resposta Google dentro do prazo. Verifique a conexão de saída e inicie novamente.',
  9108: 'Não foi possível validar a conexão TLS com o Google. Verifique certificados, relógio e rede do servidor.',
  9109: 'O serviço de autenticação Google está indisponível ou limitou as solicitações. Aguarde antes de tentar novamente.',
  9110: 'A vinculação expirou ou foi cancelada. Inicie uma nova tentativa.',
  9111: 'Não foi possível validar o login Google. Inicie uma nova vinculação e consulte o código técnico no diagnóstico.',
  9112: 'Não foi possível validar a chave de localização da conta. Conclua o desbloqueio diretamente no Google.',
  9113: 'Não foi possível validar a conexão Google Find Hub. Nenhuma conexão foi confirmada.',
  9114: 'Não foi possível registrar a identidade Google do receptor Find Hub. O login não foi iniciado. Verifique a saída de rede para os serviços Google.',
} as const;

export type FindHubAuthErrorCode = keyof typeof MESSAGES;

export type FindHubAuthPhase = 'exchange' | 'adm' | 'spot';
export type FindHubAuthResponseContext = {
  phase: FindHubAuthPhase;
  http: number;
  reason: string;
  token: boolean;
  auth: boolean;
  error: boolean;
  detail: boolean;
};
const SAFE_REASONS = new Set([
  'BadAuthentication',
  'NeedsBrowser',
  'CaptchaRequired',
  'InvalidSecondFactor',
  'WebLoginRequired',
  'InvalidRequest',
  'INVALID_REQUEST',
  'BadRequest',
  'InvalidToken',
  'ExpiredToken',
  'AccountDisabled',
  'ServiceDisabled',
  'ServiceUnavailable',
  'DeviceManagementRequiredOrSyncDisabled',
  'DeviceNotFound',
  'InvalidDevice',
  'UNKNOWN_ERR',
  'Unknown',
  'UnknownError',
  'MALFORMED_RESPONSE',
  'HTTP_ERROR',
  'ERROR_FIELDS',
  'MISSING_CREDENTIAL',
  'UNCLASSIFIED',
]);

/** Only bounded fixed categories survive the public error boundary. Never echo a Google value verbatim. */
function contextLabel(context: FindHubAuthResponseContext): string {
  const phase = ['exchange', 'adm', 'spot'].includes(context.phase) ? context.phase : 'exchange';
  const http = Number.isInteger(context.http) && context.http >= 100 && context.http <= 599 ? context.http : 0;
  const reason = SAFE_REASONS.has(context.reason) ? context.reason : 'UNCLASSIFIED';
  const flags = [context.token, context.auth, context.error, context.detail]
    .map((value) => (value === true ? '1' : '0'))
    .join('');
  return ` [etapa=${phase}; http=${http}; motivo=${reason}; campos=${flags}]`;
}

export class FindHubAuthError extends Error {
  constructor(
    public readonly code: FindHubAuthErrorCode,
    context?: FindHubAuthResponseContext,
  ) {
    super(`[FH-AUTH-${code}] ${MESSAGES[code]}${context ? contextLabel(context) : ''}`);
    this.name = 'FindHubAuthError';
  }
}

export function safeFindHubAuthError(error: unknown, fallback: FindHubAuthErrorCode): FindHubAuthError {
  return error instanceof FindHubAuthError ? error : new FindHubAuthError(fallback);
}
