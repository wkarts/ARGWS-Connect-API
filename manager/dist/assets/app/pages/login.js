import { api } from '../api/manager.js';
import { alertBox, button, card, el, field, input, spinner } from '../core/dom.js';
import { navigate } from '../core/router.js';
import { setAuth } from '../core/session.js';

export function renderLogin() {
  const page = el('div', { class: 'login-page' });
  const wrap = el('div', { class: 'login-wrap' });
  const logo = el('img', { class: 'login-logo', src: '/assets/images/argws-connect-logo-horizontal.svg', alt: 'Connect|API' });
  const feedback = el('div');
  const content = el('div');

  function finish(auth) {
    setAuth(auth);
    navigate(auth?.security?.enrollmentRequired ? '/manager/security' : '/manager/');
  }

  function renderPasswordStep() {
    const email = input('', { type: 'email', required: true, autocomplete: 'username', placeholder: 'administrador@empresa.com.br' });
    const password = input('', { type: 'password', required: true, autocomplete: 'current-password', placeholder: 'Sua senha' });
    const submit = button('Entrar', { class: 'primary full', type: 'submit' });
    const form = el('form', { class: 'form-stack' }, feedback, field('E-mail', email), field('Senha', password), submit);
    content.replaceChildren(form);
    form.onsubmit = async (event) => {
      event.preventDefault();
      feedback.replaceChildren();
      submit.disabled = true;
      submit.replaceChildren(spinner(), ' Entrando');
      try {
        const auth = await api.login(email.value.trim(), password.value);
        if (auth?.mfaRequired) renderMfaStep(auth);
        else finish(auth);
      } catch (error) {
        feedback.replaceChildren(alertBox(error.message || String(error)));
      } finally {
        submit.disabled = false;
        submit.textContent = 'Entrar';
      }
    };
  }

  function renderMfaStep(challenge) {
    const code = input('', { inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, placeholder: '000000' });
    const recovery = input('', { autocomplete: 'one-time-code', placeholder: 'ABCD-EF01-2345-6789' });
    const submit = button('Confirmar acesso', { class: 'primary full', type: 'submit' });
    const useRecovery = button('Usar código de recuperação', { class: 'ghost compact', type: 'button' });
    const back = button('Voltar', { class: 'ghost compact', type: 'button', onclick: renderPasswordStep });
    const recoveryField = field('Código de recuperação', recovery, 'Use somente se não tiver acesso ao autenticador.');
    recoveryField.hidden = true;
    useRecovery.onclick = () => {
      recoveryField.hidden = !recoveryField.hidden;
      code.closest('.field').hidden = !recoveryField.hidden;
      useRecovery.textContent = recoveryField.hidden ? 'Usar código de recuperação' : 'Usar código do autenticador';
    };
    const form = el('form', { class: 'form-stack' },
      feedback,
      el('div', { class: 'security-intro' },
        el('strong', { text: 'Autenticação em dois fatores' }),
        el('span', { text: `Digite o código do autenticador para ${challenge?.user?.email || 'sua conta'}.` }),
      ),
      field('Código de 6 dígitos', code),
      recoveryField,
      submit,
      el('div', { class: 'actions split' }, useRecovery, back),
    );
    content.replaceChildren(form);
    form.onsubmit = async (event) => {
      event.preventDefault();
      feedback.replaceChildren();
      submit.disabled = true;
      submit.replaceChildren(spinner(), ' Verificando');
      try {
        const auth = recoveryField.hidden
          ? await api.verifyTwoFactor(code.value.trim(), '')
          : await api.verifyTwoFactor('', recovery.value.trim());
        finish(auth);
      } catch (error) {
        feedback.replaceChildren(alertBox(error.message || String(error)));
      } finally {
        submit.disabled = false;
        submit.textContent = 'Confirmar acesso';
      }
    };
  }

  const box = card(
    el('div', { class: 'login-heading' },
      el('h1', { text: 'Connect|API' }),
      el('p', { text: 'Administração do seu ambiente de comunicação.' }),
    ),
    content,
  );
  wrap.append(
    logo,
    box,
    el('p', { class: 'login-foot', text: 'Acesso protegido • 2FA • sessão HttpOnly • credenciais da API preservadas no backend' }),
  );
  page.append(wrap);
  renderPasswordStep();

  void api.status().then((status) => {
    if (!status.setupRequired) return;
    feedback.replaceChildren(
      el('div', { class: 'alert warning' },
        el('strong', { text: 'Primeiro acesso' }),
        el('span', { text: ' A administração ainda não possui usuário. Configure MANAGER_BOOTSTRAP_EMAIL e MANAGER_BOOTSTRAP_PASSWORD ou utilize o instalador do Connect|API.' }),
      ),
    );
  }).catch(() => null);

  return page;
}
