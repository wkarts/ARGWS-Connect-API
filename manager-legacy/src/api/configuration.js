import { request } from './client.js';
export const configTitles = { settings: 'Comportamento', proxy: 'Proxy', webhook: 'Webhook', websocket: 'WebSocket', rabbitmq: 'RabbitMQ', sqs: 'SQS', chatwoot: 'Chatwoot' };
export async function loadConfiguration(session, instance, kind) { return request(session, `/${kind}/find/${encodeURIComponent(instance.name)}`, {}, instance.token); }
export async function saveConfiguration(session, instance, kind, payload) {
  let data = payload; if (kind === 'webhook') data = { webhook: payload }; if (kind === 'websocket') data = { websocket: payload }; if (kind === 'rabbitmq') data = { rabbitmq: payload }; if (kind === 'sqs') data = { sqs: payload };
  return request(session, `/${kind}/set/${encodeURIComponent(instance.name)}`, { method: 'POST', data }, instance.token);
}
