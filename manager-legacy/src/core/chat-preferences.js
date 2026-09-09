const statusKey = (instance) => `connect-api:chat:show-status:${instance.id || instance.instanceId || instance.name}`;

export function getShowStatusInChat(instance) {
  return localStorage.getItem(statusKey(instance)) === '1';
}

export function setShowStatusInChat(instance, value) {
  localStorage.setItem(statusKey(instance), value ? '1' : '0');
}
