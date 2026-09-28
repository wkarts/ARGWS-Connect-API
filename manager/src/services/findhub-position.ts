/** Display actual observations only. A request deadline is never a GPS refresh rate. */
export function coordinate(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(7) : '—'
}
export function positionTime(value: unknown): string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('pt-BR') : 'Não disponível'
}
export function locateResultMessage(position: any, previous: any): string {
  if (!position) return 'Solicitação enviada ao Google. A interface continua aguardando a próxima observação pelo canal realtime, sem bloquear o rastreamento.'
  if (previous && Date.parse(position.timestamp) <= Date.parse(previous.timestamp)) return 'O Google retornou um relatório já conhecido, não uma nova posição. O horário original foi preservado.'
  return 'Relatório recebido do Google. Consulte o horário da posição; ele pode ser anterior à solicitação.'
}
export function locateErrorMessage(error: unknown, timeoutMs?: number): string {
  const message = error instanceof Error ? error.message : String(error || '')
  if (/timed out|timeout/i.test(message)) return `Não foi possível concluir o envio da solicitação ao Google dentro do prazo técnico. O rastreamento anterior foi preservado.`
  return message || 'Não foi possível consultar a localização.'
}
export function queryMessage(query: any): string {
  if (query?.status === 'known_position') return 'Sem novo relatório: o Google devolveu uma posição já conhecida. O horário original foi preservado.'
  if (query?.status === 'awaiting_realtime') return 'Solicitação enviada. A próxima posição válida será aplicada assim que chegar pelo canal realtime.'
  if (query?.status === 'requested') return 'Rastreamento ativo: solicitação enviada e aguardando observações pelo canal realtime.'
  if (query?.status === 'no_position') return 'Esta consulta não retornou uma posição utilizável. O último ponto conhecido foi preservado.'
  if (query?.status === 'command_timeout') return locateErrorMessage(new Error('Google Find Hub command timeout'), query.timeoutMs)
  if (query?.status === 'timeout') return locateErrorMessage(new Error('Google Find Hub location request timed out'), query.timeoutMs)
  if (query?.status === 'failed') return 'Não foi possível concluir a última consulta. A posição anterior continua identificada pelo seu horário original.'
  return ''
}
