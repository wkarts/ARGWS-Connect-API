import { api } from '../api/manager.js';
import { alertBox, button, card, el, field, input, modal, spinner } from '../core/dom.js';
import { appShell, pageHeader, sectionHeader } from '../components/shell.js';
import { clearAuth, getAuth, setAuth } from '../core/session.js';
import { navigate } from '../core/router.js';

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(String(value || ''));
    return true;
  } catch {
    return false;
  }
}

function stepper(active) {
  const labels = ['Confirmar identidade', 'Vincular autenticador', 'Salvar recuperação'];
  return el('div', { class: 'mfa-stepper' }, ...labels.map((label, index) => {
    const step = index + 1;
    return el('div', { class: `mfa-step ${step === active ? 'active' : ''} ${step < active ? 'done' : ''}` },
      el('span', { class: 'mfa-step-number', text: step < active ? '✓' : String(step) }),
      el('span', { class: 'mfa-step-label', text: label }),
    );
  }));
}

function recoveryPanel(codes = []) {
  const copy = button('Copiar todos', { class: 'ghost compact' });
  copy.onclick = async () => {
    const ok = await copyText(codes.join('\n'));
    copy.textContent = ok ? 'Copiado' : 'Copiar todos';
    if (ok) setTimeout(() => { copy.textContent = 'Copiar todos'; }, 1600);
  };
  return el('div', { class: 'recovery-box' },
    el('div', { class: 'recovery-head' },
      el('div', {},
        el('strong', { text: 'Códigos de recuperação' }),
        el('span', { text: 'Use um deles se perder o acesso ao autenticador.' }),
      ),
      copy,
    ),
    el('div', { class: 'recovery-grid' }, ...codes.map((code) => el('code', { text: code }))),
    el('div', { class: 'alert warning compact-alert' },
      el('strong', { text: 'Importante: ' }),
      el('span', { text: 'cada código funciona uma única vez e esta lista não será exibida novamente.' }),
    ),
  );
}

function statusTile(label, value, tone = '') {
  return el('div', { class: `security-tile ${tone}`.trim() },
    el('span', { text: label }),
    el('strong', { text: value }),
  );
}

export function renderSecurity() {
  const page = el('div', { class: 'page security-page' });
  const body = el('div', { class: 'center' }, spinner());
  const feedback = el('div');
  let enrollmentAutoOpened = false;

  page.append(
    pageHeader('Segurança da conta', 'Proteja o acesso administrativo sem alterar os tokens e integrações da API.'),
    feedback,
    body,
  );

  async function load() {
    try {
      const data = await api.security();
      const state = data.security || {};
      body.replaceChildren(renderState(state));
      if (state.enrollmentRequired && !state.twoFactorEnabled && !enrollmentAutoOpened) {
        enrollmentAutoOpened = true;
        setTimeout(() => openEnrollment(state), 80);
      }
    } catch (error) {
      body.replaceChildren(alertBox(error.message || String(error)));
    }
  }

  function openRecoveryModal(codes, options = {}) {
    const content = el('div', { class: 'mfa-dialog-content' },
      stepper(3),
      el('div', { class: 'mfa-success-hero' },
        el('div', { class: 'mfa-success-icon', text: '✓' }),
        el('div', {},
          el('h4', { text: options.title || '2FA ativado com sucesso' }),
          el('p', { text: 'Sua conta administrativa agora exige o autenticador no login.' }),
        ),
      ),
      recoveryPanel(codes),
      el('div', { class: 'modal-actions' }),
    );
    const dialog = modal('Códigos de recuperação', content, {
      wide: true,
      dismissible: false,
      class: 'mfa-modal',
      subtitle: 'Guarde estes códigos antes de concluir.',
    });
    const done = button('Concluí e salvei os códigos', { class: 'primary' });
    content.querySelector('.modal-actions').append(done);
    done.onclick = async () => {
      dialog.close();
      await load();
      if (options.onDone) options.onDone();
    };
  }

  function openEnrollment(state) {
    const content = el('div', { class: 'mfa-dialog-content' });
    const dialog = modal('Ativar autenticação em dois fatores', content, {
      wide: true,
      dismissible: !state.enrollmentRequired,
      class: 'mfa-modal',
      subtitle: state.enrollmentRequired
        ? 'Obrigatório para administradores desta instalação.'
        : 'Recomendado para proteger o acesso administrativo.',
    });

    function renderPasswordStep() {
      const password = input('', {
        type: 'password',
        autocomplete: 'current-password',
        placeholder: 'Digite sua senha atual',
      });
      const local = el('div');
      const next = button('Continuar', { class: 'primary' });
      const cancel = state.enrollmentRequired ? null : button('Cancelar', { class: 'ghost', onclick: dialog.close });

      content.replaceChildren(
        stepper(1),
        el('div', { class: 'mfa-intro' },
          el('div', { class: 'mfa-intro-icon', text: '◆' }),
          el('div', {},
            el('h4', { text: 'Confirme sua identidade' }),
            el('p', { text: 'Antes de vincular o autenticador, confirme a senha da sua conta administrativa.' }),
          ),
        ),
        local,
        field('Senha atual', password, 'Sua senha não será armazenada neste processo.'),
        el('div', { class: 'modal-actions' }, cancel, next),
      );

      setTimeout(() => password.focus(), 50);
      password.addEventListener('keydown', (event) => { if (event.key === 'Enter') next.click(); });
      next.onclick = async () => {
        local.replaceChildren();
        if (!password.value) {
          local.replaceChildren(alertBox('Informe sua senha atual.'));
          return;
        }
        next.disabled = true;
        next.replaceChildren(spinner(), ' Validando');
        try {
          const setup = await api.setupTwoFactor(password.value);
          await renderAuthenticatorStep(setup);
        } catch (error) {
          local.replaceChildren(alertBox(error.message || String(error)));
        } finally {
          next.disabled = false;
          next.textContent = 'Continuar';
        }
      };
    }

    async function renderAuthenticatorStep(setup) {
      const local = el('div');
      const qrImage = el('img', {
        class: 'mfa-qr-image',
        alt: 'QR Code para configurar o autenticador',
      });
      const qrLoading = el('div', { class: 'mfa-qr-loading' }, spinner(), el('span', { text: 'Gerando QR Code…' }));
      const qrBox = el('div', { class: 'mfa-qr-card' }, qrLoading, qrImage);
      qrImage.hidden = true;

      try {
        if (!globalThis.QRCode?.toDataURL) throw new Error('Renderizador local de QR Code indisponível.');
        qrImage.src = await globalThis.QRCode.toDataURL(setup.otpauthUri, {
          width: 280,
          margin: 2,
          errorCorrectionLevel: 'M',
          color: { dark: '#0f172a', light: '#ffffff' },
        });
        qrLoading.remove();
        qrImage.hidden = false;
      } catch (error) {
        qrLoading.replaceChildren(alertBox(error.message || 'Não foi possível gerar o QR Code.'));
      }

      const secret = el('code', { class: 'mfa-secret-value', text: setup.secret });
      const copySecret = button('Copiar chave', { class: 'ghost compact' });
      copySecret.onclick = async () => {
        if (await copyText(setup.secret)) {
          copySecret.textContent = 'Copiado';
          setTimeout(() => { copySecret.textContent = 'Copiar chave'; }, 1600);
        }
      };
      const manual = el('details', { class: 'mfa-manual' },
        el('summary', { text: 'Não consegue escanear? Use a chave manual' }),
        el('div', { class: 'mfa-secret-row' }, secret, copySecret),
        el('small', { text: `Conta: ${setup.account || getAuth()?.user?.email || ''} • Emissor: ${setup.issuer || 'Connect|API'} • 6 dígitos a cada 30 segundos.` }),
      );

      const code = input('', {
        inputmode: 'numeric',
        autocomplete: 'one-time-code',
        maxlength: 6,
        placeholder: '000000',
        class: 'input mfa-code-input',
      });
      code.addEventListener('input', () => { code.value = code.value.replace(/\D/g, '').slice(0, 6); });
      const confirm = button('Ativar 2FA', { class: 'primary' });
      const back = button('Voltar', { class: 'ghost', onclick: renderPasswordStep });

      content.replaceChildren(
        stepper(2),
        el('div', { class: 'mfa-enrollment-grid' },
          el('div', { class: 'mfa-qr-column' },
            el('div', { class: 'mfa-qr-title' },
              el('strong', { text: 'Escaneie o QR Code' }),
              el('span', { text: 'Google Authenticator, Microsoft Authenticator, 1Password ou outro app TOTP.' }),
            ),
            qrBox,
          ),
          el('div', { class: 'mfa-verify-column' },
            el('div', { class: 'mfa-instruction-list' },
              el('div', {}, el('span', { text: '1' }), el('p', { text: 'Abra o aplicativo autenticador no celular.' })),
              el('div', {}, el('span', { text: '2' }), el('p', { text: 'Adicione uma nova conta e escaneie o QR Code.' })),
              el('div', {}, el('span', { text: '3' }), el('p', { text: 'Digite abaixo o código de 6 dígitos exibido no aplicativo.' })),
            ),
            manual,
            local,
            field('Código de 6 dígitos', code, 'O código muda aproximadamente a cada 30 segundos.'),
          ),
        ),
        el('div', { class: 'modal-actions' }, back, confirm),
      );

      setTimeout(() => code.focus(), 50);
      code.addEventListener('keydown', (event) => { if (event.key === 'Enter') confirm.click(); });
      confirm.onclick = async () => {
        local.replaceChildren();
        if (!/^\d{6}$/.test(code.value)) {
          local.replaceChildren(alertBox('Digite o código de 6 dígitos do autenticador.'));
          return;
        }
        confirm.disabled = true;
        confirm.replaceChildren(spinner(), ' Ativando');
        try {
          const result = await api.confirmTwoFactor(code.value);
          setAuth({ ...getAuth(), ...result });
          dialog.close();
          feedback.replaceChildren(alertBox('2FA ativado com sucesso.', 'success'));
          openRecoveryModal(result.recoveryCodes || []);
        } catch (error) {
          local.replaceChildren(alertBox(error.message || String(error)));
          code.select();
        } finally {
          confirm.disabled = false;
          confirm.textContent = 'Ativar 2FA';
        }
      };
    }

    renderPasswordStep();
  }

  function renderState(state) {
    const requiredNotice = state.enrollmentRequired ? el('div', { class: 'security-required-banner' },
      el('div', { class: 'security-required-icon', text: '!' }),
      el('div', {},
        el('strong', { text: 'Proteção obrigatória pendente' }),
        el('span', { text: 'Finalize a configuração do 2FA para liberar os demais recursos administrativos.' }),
      ),
      button('Configurar agora', { class: 'primary compact', onclick: () => openEnrollment(state) }),
    ) : null;

    const overview = card(
      el('div', { class: 'security-card-head' },
        sectionHeader('Proteção da conta', 'O 2FA protege somente o acesso humano à Manager. Tokens da API continuam independentes.'),
        el('span', { class: `security-shield ${state.twoFactorEnabled ? 'active' : ''}`, text: state.twoFactorEnabled ? '✓' : '◆' }),
      ),
      el('div', { class: 'security-status' },
        statusTile('2FA', state.twoFactorEnabled ? 'Ativado' : 'Desativado', state.twoFactorEnabled ? 'success' : 'warning'),
        statusTile('Política da conta', state.twoFactorRequired ? 'Obrigatório' : 'Opcional'),
        statusTile('Recuperação', `${state.recoveryCodesRemaining ?? 0} códigos`),
      ),
      requiredNotice,
    );

    const mfaCard = state.twoFactorEnabled ? renderEnabled(state) : card(
      el('div', { class: 'security-feature' },
        el('div', { class: 'security-feature-icon', text: '◆' }),
        el('div', { class: 'security-feature-copy' },
          el('h2', { text: 'Autenticação em dois fatores' }),
          el('p', { text: 'Use um aplicativo autenticador para adicionar uma segunda etapa ao login administrativo.' }),
          el('div', { class: 'security-feature-points' },
            el('span', { text: '✓ QR Code local' }),
            el('span', { text: '✓ TOTP padrão' }),
            el('span', { text: '✓ Códigos de recuperação' }),
          ),
        ),
        button(state.enrollmentRequired ? 'Configurar 2FA agora' : 'Ativar 2FA', { class: 'primary', onclick: () => openEnrollment(state) }),
      ),
    );

    return el('div', { class: 'security-layout' }, overview, mfaCard, renderPasswordChange());
  }

  function renderEnabled(state) {
    const local = el('div');
    const regeneratePassword = input('', { type: 'password', autocomplete: 'current-password', placeholder: 'Senha atual' });
    const regenerate = button('Gerar novos códigos', { class: 'ghost' });
    regenerate.onclick = async () => {
      local.replaceChildren();
      if (!regeneratePassword.value) {
        local.replaceChildren(alertBox('Informe sua senha atual.'));
        return;
      }
      regenerate.disabled = true;
      try {
        const result = await api.regenerateRecoveryCodes(regeneratePassword.value);
        openRecoveryModal(result.recoveryCodes || [], { title: 'Novos códigos gerados' });
        regeneratePassword.value = '';
      } catch (error) {
        local.replaceChildren(alertBox(error.message || String(error)));
      } finally {
        regenerate.disabled = false;
      }
    };

    const disablePassword = input('', { type: 'password', autocomplete: 'current-password', placeholder: 'Senha atual' });
    const disable = button('Desativar 2FA', { class: 'danger ghost', disabled: state.twoFactorRequired });
    disable.onclick = async () => {
      local.replaceChildren();
      if (!disablePassword.value) {
        local.replaceChildren(alertBox('Informe sua senha atual.'));
        return;
      }
      if (!confirm('Desativar a autenticação em dois fatores desta conta?')) return;
      disable.disabled = true;
      try {
        await api.disableTwoFactor(disablePassword.value);
        clearAuth();
        navigate('/manager/login');
      } catch (error) {
        local.replaceChildren(alertBox(error.message || String(error)));
      } finally {
        disable.disabled = state.twoFactorRequired;
      }
    };

    return card(
      el('div', { class: 'security-card-head' },
        sectionHeader('Autenticação em dois fatores', 'Sua conta exige um código temporário no login.'),
        el('span', { class: 'security-shield active', text: '✓' }),
      ),
      local,
      el('div', { class: 'alert success' },
        el('strong', { text: 'Proteção ativa. ' }),
        el('span', { text: state.lastMfaAt ? `Última validação: ${new Date(state.lastMfaAt).toLocaleString('pt-BR')}.` : 'Seu autenticador está vinculado.' }),
      ),
      el('div', { class: 'security-actions-grid' },
        el('div', {},
          el('h3', { text: 'Códigos de recuperação' }),
          el('p', { class: 'muted', text: `${state.recoveryCodesRemaining ?? 0} códigos disponíveis.` }),
          field('Confirme sua senha', regeneratePassword),
          regenerate,
        ),
        el('div', {},
          el('h3', { text: 'Desativar proteção' }),
          el('p', { class: 'muted', text: state.twoFactorRequired ? 'Não disponível: o 2FA é obrigatório para administradores.' : 'Remove o segundo fator desta conta.' }),
          field('Confirme sua senha', disablePassword),
          disable,
        ),
      ),
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
      if (next.value !== confirmPassword.value) {
        local.replaceChildren(alertBox('A confirmação da nova senha não confere.'));
        return;
      }
      submit.disabled = true;
      try {
        await api.changePassword(current.value, next.value);
        clearAuth();
        navigate('/manager/login');
      } catch (error) {
        local.replaceChildren(alertBox(error.message || String(error)));
      } finally {
        submit.disabled = false;
      }
    };
    return card(
      el('div', { class: 'security-card-head' }, sectionHeader('Senha', 'A alteração da senha revoga todas as sessões existentes.'), el('span', { class: 'security-shield', text: '•••' })),
      local,
      el('div', { class: 'security-password-grid' },
        field('Senha atual', current),
        field('Nova senha', next, 'Use pelo menos 12 caracteres.'),
        field('Confirmar nova senha', confirmPassword),
      ),
      el('div', { class: 'actions end top-gap' }, submit),
    );
  }

  void load();
  return appShell(page, { title: 'Segurança da conta', subtitle: 'Administração' });
}
