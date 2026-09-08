import { request, requestForm } from './client.js';
export async function findChats(session, instance) {
  const data = await request(
    session,
    `/chat/findChats/${encodeURIComponent(instance.name)}`,
    { method: 'POST', data: { where: {} } },
    instance.token,
  );
  return Array.isArray(data) ? data : data ? data.records || data : [];
}
export async function findMessages(session, instance, remoteJid) {
  const data = await request(
    session,
    `/chat/findMessages/${encodeURIComponent(instance.name)}`,
    { method: 'POST', data: { where: { key: { remoteJid } } } },
    instance.token,
  );
  return data?.messages?.records || (Array.isArray(data) ? data : []);
}
export const findStatusMessages = (session, instance) => findMessages(session, instance, 'status@broadcast');

export async function fetchProfilePicture(session, instance, remoteJid) {
  const number = String(remoteJid || '').replace(/@.+$/, '');
  if (!number) return null;
  return request(
    session,
    `/chat/fetchProfilePictureUrl/${encodeURIComponent(instance.name)}`,
    { method: 'POST', data: { number } },
    instance.token,
  );
}
export const sendText = (session, instance, remoteJid, text) =>
  request(
    session,
    `/message/sendText/${encodeURIComponent(instance.name)}`,
    { method: 'POST', data: { number: remoteJid.replace(/@.+$/, ''), text } },
    instance.token,
  );

export async function sendMedia(session, instance, remoteJid, file, caption = '') {
  const type = String(file.type || '').split('/')[0];
  const mediatype = ['image', 'video', 'audio'].includes(type) ? type : 'document';
  const form = new FormData();
  form.set('file', file, file.name || 'arquivo');
  form.set('number', remoteJid.replace(/@.+$/, ''));
  form.set('mediatype', mediatype);
  form.set('mimetype', file.type || 'application/octet-stream');
  form.set('fileName', file.name || 'arquivo');
  if (caption) form.set('caption', caption);
  return requestForm(
    session,
    `/message/sendMedia/${encodeURIComponent(instance.name || instance.instanceName)}`,
    form,
    {},
    instance.token,
  );
}
