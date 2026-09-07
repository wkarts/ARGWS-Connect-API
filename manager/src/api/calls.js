import { request } from './client.js';

const nameOf = (instance) => instance.name || instance.instanceName;
export const listCalls = (session, instance) =>
  request(session, `/call/list/${encodeURIComponent(nameOf(instance))}`, {}, instance.token);
export const offerCall = (session, instance, number) =>
  request(session, `/call/offer/${encodeURIComponent(nameOf(instance))}`, {
    method: 'POST',
    data: { number, isVideo: false },
  }, instance.token);
export const acceptCall = (session, instance, callId) =>
  request(session, `/call/accept/${encodeURIComponent(nameOf(instance))}`, { method: 'POST', data: { callId } }, instance.token);
export const rejectCall = (session, instance, callId) =>
  request(session, `/call/reject/${encodeURIComponent(nameOf(instance))}`, { method: 'POST', data: { callId } }, instance.token);
export const endCall = (session, instance, callId) =>
  request(session, `/call/end/${encodeURIComponent(nameOf(instance))}`, { method: 'POST', data: { callId } }, instance.token);
export const muteCall = (session, instance, callId, muted) =>
  request(session, `/call/mute/${encodeURIComponent(nameOf(instance))}`, { method: 'POST', data: { callId, muted } }, instance.token);
