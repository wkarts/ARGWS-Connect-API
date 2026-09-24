/** Display actual observations only. A request deadline is never a GPS refresh rate. */
export function coordinate(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(7) : '—'
}
export function positionTime(value: unknown): string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('pt-BR') : 'Não disponível'
}
export function locateResultMessage(position: any, previous: any): string {
  if (!position) return 'O Google não retornou uma posição utilizável nesta consulta. O último ponto conhecido foi preservado.'
  if (previous && Date.parse(position.timestamp) <= Date.parse(previous.timestamp)) return 'O Google retornou um relatório já conhecido, não uma nova posição. O horário original foi preservado.'
  return 'Relatório recebido do Google. Consulte o horário da posição; ele pode ser anterior à solicitação.'
}
export function locateErrorMessage(error: unknown, timeoutMs?: number): string {
  const message = error instanceof Error ? error.message : String(error || '')
  if (/location request timed out/i.test(message)) return `O Google não respondeu dentro do timeout${timeoutMs ? ` de ${timeoutMs} ms` : ' configurado'}. A última posição foi preservada. Diminuir esse prazo não acelera a localização.`
  return message || 'Não foi possível consultar a localização.'
}
export function queryMessage(query: any, receivedAt?: string): string {
  if (query?.status === 'timeout' && receivedAt && Date.parse(receivedAt) > Date.parse(query.completedAt)) {
    return 'Uma posição foi recebida pelo canal de atualizações após o prazo da última consulta. A consulta expirou, mas o recebimento continuou ativo.'
  }
  if (query?.status === 'known_position') return 'Sem novo relatório: o Google devolveu uma posição já conhecida. O horário original foi preservado.'
  if (query?.status === 'no_position') return 'Esta consulta não retornou uma posição utilizável. O último ponto conhecido foi preservado.'
  if (query?.status === 'timeout') return locateErrorMessage(new Error('Google Find Hub location request timed out'), query.timeoutMs)
  if (query?.status === 'failed') return 'Não foi possível concluir a última consulta. A posição anterior continua identificada pelo seu horário original.'
  return ''
}
