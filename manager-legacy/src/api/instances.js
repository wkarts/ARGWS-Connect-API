import { request } from './client.js';
export async function fetchInstances(session, instanceId = '') { const data = await request(session, '/instance/fetchInstances', { params: instanceId ? { instanceId } : undefined }); return Array.isArray(data) ? data : data ? [data] : []; }
export const createInstance = (session, data) => request(session, '/instance/create', { method: 'POST', data });
export const deleteInstance = (session, instance) => request(session, `/instance/delete/${encodeURIComponent(instance.name)}`, { method: 'DELETE' }, instance.token || '');
export const logoutInstance = (session, instance) => request(session, `/instance/logout/${encodeURIComponent(instance.name)}`, { method: 'DELETE' }, instance.token);
export const restartInstance = (session, instance) => request(session, `/instance/restart/${encodeURIComponent(instance.name)}`, { method: 'POST' }, instance.token);
export const connectInstance = (session, instance, pairing = false) => request(session, `/instance/connect/${encodeURIComponent(instance.name)}`, { params: pairing && instance.number ? { number: instance.number } : undefined }, instance.token);
