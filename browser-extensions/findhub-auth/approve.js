const approve = document.querySelector('#approve');
const status = document.querySelector('#status');
chrome.runtime.sendMessage({ type: 'INFO' }).then((info) => {
  if (info.error) throw new Error(info.error);
  for (const name of ['origin', 'apiOrigin', 'email']) document.getElementById(name).textContent = info[name];
}).catch(() => { status.textContent = 'Nenhuma vinculação ativa. Feche esta aba e inicie pelo Manager.'; });
document.querySelector('#consent').addEventListener('change', (event) => { approve.disabled = !event.target.checked; });
approve.addEventListener('click', async () => {
  approve.disabled = true;
  try {
    const granted = await chrome.permissions.request({ permissions: ['cookies'], origins: ['https://accounts.google.com/*'] });
    if (!granted) throw new Error('Permissão não concedida.');
    const result = await chrome.runtime.sendMessage({ type: 'APPROVE' });
    if (!result.ok) throw new Error('Não foi possível iniciar.');
    status.textContent = 'Faça login e desbloqueie o Find Hub na aba Google. Não feche o Manager.';
  } catch { status.textContent = 'Não autorizado. Cancele e inicie novamente no Manager.'; }
});
document.querySelector('#deny').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'DENY' }));
