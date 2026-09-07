import { api } from '../api/manager.js';
import { alertBox, button, card, el, field, input, spinner } from '../core/dom.js';
import { appShell, pageHeader, sectionHeader } from '../components/shell.js';
import { clearAuth, getAuth, setAuth } from '../core/session.js';
import { navigate } from '../core/router.js';

function codeList(codes = []) {
  const box = el('div', { class: 'recovery-box' },
    el('div', { class: 'recovery-head' },
      el('strong', { text: 'Códigos de recuperação' }),
      button('Copiar todos', { class: 'ghost compact', onclick: async () => {
        try { await navigator.clipboard.writeText(codes.join('\n')); } catch {}
      } }),
    ),
    el('p', { text: 'Guarde estes códigos em local seguro. Cada código funciona uma única vez e não será exibido novamente.' }),
    el('div', { class: 'recovery-grid' }, ...codes.map((code) => el('code', { text: code }))),
  );
  return box;
}

export function renderSecurity() {
  const page = el('div', { class: 'page' });
  const body = el('div', { class: 'center' }, spinner());
  const feedback = el('div');
  page.append(
    pageHeader('Segurança da conta', 'Senha, autenticação em dois fatores e recuperação da sua conta.'),
    feedback,
    body,
  );

  async function load() {
    try {
      const data = await api.security();
      const state = data.security || {};
      body.replaceChildren(renderState(state));
    } catch (error) {
      body.replaceChildren(alertBox(error.message || String(error)));
    }
  }

  function renderState(state) {
    const status = card(
      sectionHeader('Proteção da conta', 'O 2FA protege o acesso humano à Manager e não altera a autenticação por token da API.'),
      el('div', { class: 'security-status' },
        el('div', {}, el('span', { class: 'muted', text: '2FA' }), el('strong', { text: state.twoFactorEnabled ? 'Ativado' : 'Desativado' })),
        el('div', {}, el('span', { class: 'muted', text: 'Obrigatório' }), el('strong', { text: state.twoFactorRequired ? 'Sim' : 'Não' })),
        el('div', {}, el('span', { class: 'muted', text: 'Códigos de recuperação' }), el('strong', { text: String(state.recoveryCodesRemaining ?? 0) })),
      ),
      state.enrollmentRequired ? el('div', { class: 'alert warning' },
        el('strong', { text: 'Configuração obrigatória. ' }),
        el('span', { text: 'Ative o 2FA para continuar utilizando a administração.' }),
      ) : null,
    );

    const mfaCard = state.twoFactorEnabled ? renderEnabled(state) : renderEnrollment();
    const passwordCard = renderPasswordChange();
    return el('div', { class: 'grid security-grid' }, status, mfaCard, passwordCard);
  }

  function renderEnrollment() {
    const password = input('', { type: 'password', autocomplete: 'current-password', placeholder: 'Senha atual' });
    const local = el('div');
    const holder = el('div');
    const start = button('Configurar 2FA', { class: 'primary' });
    start.onclick = async () => {
      local.replaceChildren();
      if (!password.value) return local.replaceChildren(alertBox('Informe sua senha atual.'));
      start.disabled = true;
      try {
        const setup = await api.setupTwoFactor(password.value);
        const code = input('', { inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code', placeholder: '000000' });
        const confirm = button('Ativar 2FA', { class: 'primary' });
        const copySecret = button('Copiar chave', { class: 'ghost compact', onclick: async () => {
          try { await navigator.clipboard.writeText(setup.secret); } catch {}
        } });
        const copyUri = button('Copiar URI', { class: 'ghost compact', onclick: async () => {
          try { await navigator.clipboard.writeText(setup.otpauthUri); } catch {}
        } });
        confirm.onclick = async () => {
          local.replaceChildren();
          confirm.disabled = true;
          try {
            const result = await api.confirmTwoFactor(code.value.trim());
            setAuth({ ...getAuth(), ...result });
            holder.replaceChildren(codeList(result.recoveryCodes || []));
            feedback.replaceChildren(alertBox('2FA ativado com sucesso.', 'success'));
          } catch (error) {
            local.replaceChildren(alertBox(error.message || String(error)));
          } finally { confirm.disabled = false; }
        };
        holder.replaceChildren(
          el('div', { class: 'form-stack' },
            el('div', { class: 'alert info' },
              el('strong', { text: 'Google Authenticator, Microsoft Authenticator ou compatível. ' }),
              el('span', { text: 'Adicione uma conta usando a chave abaixo e confirme com o código de 6 dígitos.' }),
            ),
            field('Chave de configuração', el('div', { class: 'secret-row' }, el('code', { text: setup.secret }), copySecret)),
            field('URI otpauth', el('div', { class: 'secret-row' }, el('code', { class: 'uri-code', text: setup.otpauthUri }), copyUri)),
            field('Código do autenticador', code),
            confirm,
          ),
        );
      } catch (error) {
        local.replaceChildren(alertBox(error.message || String(error)));
      } finally { start.disabled = false; }
    };
    return card(
      sectionHeader('Autenticação em dois fatores', 'Proteja seu login com TOTP.'),
      local,
      el('div', { class: 'form-stack' }, field('Confirme sua senha', password), start),
      holder,
    );
  }

  function renderEnabled(state) {
    const local = el('div');
    const regeneratePassword = input('', { type: 'password', autocomplete: 'current-password', placeholder: 'Senha atual' });
    const regenerate = button('Gerar novos códigos', { class: 'ghost' });
    const holder = el('div');
    regenerate.onclick = async () => {
      local.replaceChildren();
      regenerate.disabled = true;
      try {
        const result = await api.regenerateRecoveryCodes(regeneratePassword.value);
        holder.replaceChildren(codeList(result.recoveryCodes || []));
      } catch (error) { local.replaceChildren(alertBox(error.message || String(error))); }
      finally { regenerate.disabled = false; }
    };

    const disablePassword = input('', { type: 'password', autocomplete: 'current-password', placeholder: 'Senha atual' });
    const disable = button('Desativar 2FA', { class: 'danger ghost', disabled: state.twoFactorRequired });
    disable.onclick = async () => {
      local.replaceChildren();
      if (!confirm('Desativar a autenticação em dois fatores desta conta?')) return;
      disable.disabled = true;
      try {
        await api.disableTwoFactor(disablePassword.value);
        clearAuth();
        navigate('/manager/login');
      } catch (error) { local.replaceChildren(alertBox(error.message || String(error))); }
      finally { disable.disabled = state.twoFactorRequired; }
    };

    return card(
      sectionHeader('Autenticação em dois fatores', 'O acesso por senha exige também o seu autenticador.'),
      local,
      el('div', { class: 'alert success' },
        el('strong', { text: '2FA ativo. ' }),
        el('span', { text: state.lastMfaAt ? `Última validação: ${new Date(state.lastMfaAt).toLocaleString('pt-BR')}.` : 'Sua conta está protegida.' }),
      ),
      field('Senha para regenerar os códigos', regeneratePassword),
      regenerate,
      holder,
      el('hr', { class: 'divider' }),
      field('Senha para desativar', disablePassword),
      disable,
      state.twoFactorRequired ? el('small', { class: 'muted', text: 'O 2FA é obrigatório para administradores desta instalação.' }) : null,
    );
  }

  function renderPasswordChange() {
    const current = input('', { type: 'password', autocomplete: 'current-password' });
    const next = input('', { type: 'password', autocomplete: 'new-password', placeholder: 'Mínimo 12 caracteres' });
    const confirmPassword = input('', { type: 'password', autocomplete: 'new-password' });
    const local = el('div');
    const submit = button('Alterar senha', { class: 'primary' });
    submit.onclick = async () => {
      local.replaceChildren();
      if (next.value !== confirmPassword.value) return local.replaceChildren(alertBox('A confirmação da nova senha não confere.'));
      submit.disabled = true;
      try {
        await api.changePassword(current.value, next.value);
        clearAuth();
        navigate('/manager/login');
      } catch (error) { local.replaceChildren(alertBox(error.message || String(error))); }
      finally { submit.disabled = false; }
    };
    return card(
      sectionHeader('Senha', 'Alterar a senha revoga todas as sessões existentes.'),
      local,
      el('div', { class: 'form-stack' },
        field('Senha atual', current),
        field('Nova senha', next, 'Use pelo menos 12 caracteres.'),
        field('Confirmar nova senha', confirmPassword),
        submit,
      ),
    );
  }

  void load();
  return appShell(page, { title: 'Segurança da conta', subtitle: 'Administração' });
}
