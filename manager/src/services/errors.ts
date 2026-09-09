const replacements: Array<[RegExp, string]> = [
  [/manager/gi, 'aplicação'],
  [/engine/gi, 'serviço'],
  [/telemetr(?:y|ia)/gi, 'monitoramento'],
  [/licen[cs](?:e|ing|iamento|a)/gi, 'autorização'],
  [/tenant/gi, 'ambiente'],
  [/partner/gi, 'conta'],
  [/platform/gi, 'aplicação'],
  [/fastapi|python|node(?:\.js)?|vue(?:\.js)?/gi, 'serviço'],
]

export function friendlyError(input: unknown, fallback = 'Não foi possível concluir a operação.') {
  let text = input instanceof Error ? input.message : String(input || fallback)
  for (const [pattern, replacement] of replacements) text = text.replace(pattern, replacement)
  if (/failed to fetch|networkerror|load failed/i.test(text)) return 'Não foi possível se comunicar com o serviço. Tente novamente em instantes.'
  if (/401|unauthor/i.test(text)) return 'Sua sessão expirou. Entre novamente.'
  if (/403|forbidden/i.test(text)) return 'Você não possui acesso a esta ação.'
  return text || fallback
}
