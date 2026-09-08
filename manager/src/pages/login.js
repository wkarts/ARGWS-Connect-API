import { el, card, button, field, input, alertBox, spinner } from '../core/dom.js';
import { fetchRoot, verifyCredentials } from '../api/client.js';
import { saveSession, normalizeUrl } from '../core/session.js';
import { runtimeConfig } from '../core/runtime-config.js';
import { navigate } from '../core/router.js';

export function renderLogin() {
  const server = input(runtimeConfig.apiUrl || window.location.origin, {
    type: 'url',
    required: true,
    placeholder: 'https://api.exemplo.com.br',
  });
  const key = input('', { type: 'password', required: true });
  const error = el('div');
  const submit = button('Entrar', { class: 'primary full', type: 'submit' });
  const form = el(
    'form',
    { class: 'form-stack' },
    field('Servidor', server),
    field('Chave da API', key),
    error,
    submit,
  );

  form.onsubmit = async (event) => {
    event.preventDefault();
    submit.disabled = true;
    submit.replaceChildren(spinner(), 'Validando...');
    error.replaceChildren();

    try {
      const apiUrl = normalizeUrl(server.value);
      const apiKey = String(key.value || '').trim();

      if (!apiUrl) throw new Error('Informe o endereço da API.');
      if (!apiKey) throw new Error('Informe a chave da API.');

      // Authentication must not depend on the public root endpoint. The root
      // endpoint may perform optional metadata/network lookups that are not
      // required to validate a Manager session.
      await verifyCredentials(apiUrl, apiKey);

      const session = {
        apiUrl,
        apiKey,
        version: '',
        clientName: 'Connect|API',
        documentationUrl: runtimeConfig.documentationUrl || '',
      };

      saveSession(session);
      navigate('/manager/');

      // Enrich the saved session in the background. Metadata failure must
      // never invalidate credentials that were already accepted by the API.
      void fetchRoot(apiUrl)
        .then((root) => {
          saveSession({
            ...session,
            version: root?.version || '',
            clientName: root?.clientName || 'Connect|API',
            documentationUrl: runtimeConfig.documentationUrl || root?.documentation || '',
          });
        })
        .catch(() => undefined);
    } catch (err) {
      error.replaceChildren(alertBox(err?.message || String(err)));
    } finally {
      submit.disabled = false;
      submit.textContent = 'Entrar';
    }
  };

  return el(
    'div',
    { class: 'login-page' },
    el(
      'div',
      { class: 'login-wrap' },
      el('img', {
        class: 'login-logo',
        src: '/assets/images/argws-connect-logo-horizontal.svg',
        alt: 'Connect|API',
      }),
      card(
        el('h1', { text: 'Acessar Manager' }),
        el('p', { class: 'muted', text: 'Informe o endereço da API e a chave de acesso.' }),
        form,
      ),
    ),
  );
}
