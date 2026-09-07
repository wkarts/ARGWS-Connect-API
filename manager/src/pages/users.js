import { api } from '../api/manager.js';
import { alertBox, button, card, confirmDialog, el, emptyState, field, input, modal, spinner } from '../core/dom.js';
import { getAuth, hasPermission } from '../core/session.js';
import { appShell, pageHeader } from '../components/shell.js';

export function renderUsers() {
  const page = el('div', { class: 'page' });
  const body = el('div', { class: 'center' }, spinner());
  const feedback = el('div');
  page.append(pageHeader('Usuários e Acessos', 'Contas administrativas locais, perfis e permissões.', [hasPermission('users.manage') ? button('Novo usuário', { class: 'primary', onclick: () => openEditor(null) }) : null]), feedback, body);
  let roles = [];
  async function load() {
    try {
      const [users, roleItems] = await Promise.all([api.users(), api.roles()]); roles = roleItems;
      body.replaceChildren(users.length ? el('div', { class: 'table-card' }, table(users)) : emptyState('Nenhum usuário', 'Crie a primeira conta administrativa.'));
    } catch (error) { body.replaceChildren(alertBox(error.message || String(error))); }
  }
  function table(users) {
    const node = el('table', { class: 'data-table' }, el('thead', {}, el('tr', {}, ...['Usuário', 'Perfis', 'Estado', '2FA', 'Último acesso', ''].map((label) => el('th', { text: label })))), el('tbody'));
    const tbody = node.querySelector('tbody');
    users.forEach((user) => tbody.append(el('tr', {},
      el('td', {}, el('div', { class: 'user-cell' }, el('div', { class: 'avatar small', text: (user.name || user.email)[0]?.toUpperCase() }), el('div', {}, el('strong', { text: user.name || 'Usuário' }), el('span', { text: user.email })))),
      el('td', {}, ...(user.roles || []).map((role) => el('span', { class: 'chip', text: roles.find((item) => item.id === role)?.label || role }))),
      el('td', {}, el('span', { class: `badge ${user.active ? 'badge-success' : 'badge-neutral'}`, text: user.active ? 'Ativo' : 'Inativo' })),
      el('td', {}, el('span', { class: `badge ${user.twoFactorEnabled ? 'badge-success' : 'badge-warning'}`, text: user.twoFactorEnabled ? 'Ativo' : 'Desativado' })),
      el('td', { text: user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('pt-BR') : 'Nunca' }),
      el('td', {}, hasPermission('users.manage') ? el('div', { class: 'actions end' },
        button('Editar', { class: 'ghost compact', onclick: () => openEditor(user) }),
        user.twoFactorEnabled && user.id !== getAuth()?.user?.id ? button('Resetar 2FA', { class: 'ghost compact', onclick: async () => {
          if (!await confirmDialog('Resetar 2FA', `Remover o 2FA de ${user.name || user.email}? A conta precisará configurá-lo novamente quando obrigatório.`, 'Resetar')) return;
          try { await api.resetUserTwoFactor(user.id); await load(); } catch (error) { feedback.replaceChildren(alertBox(error.message || String(error))); }
        } }) : null,
        button('Excluir', { class: 'danger ghost compact', disabled: user.id === getAuth()?.user?.id, onclick: async () => { if (!await confirmDialog('Excluir usuário', `Excluir ${user.name || user.email}?`, 'Excluir')) return; try { await api.deleteUser(user.id); await load(); } catch (error) { feedback.replaceChildren(alertBox(error.message || String(error))); } } }),
      ) : null),
    )));
    return node;
  }
  function openEditor(user) {
    const name = input(user?.name || '', { required: true }); const email = input(user?.email || '', { type: 'email', required: true }); const password = input('', { type: 'password', required: !user, placeholder: user ? 'Deixe vazio para manter' : 'Mínimo 12 caracteres' });
    const checks = el('div', { class: 'role-grid' }, ...roles.map((role) => el('label', { class: 'check-card' }, el('input', { type: 'checkbox', value: role.id, checked: user?.roles?.includes(role.id) }), el('div', {}, el('strong', { text: role.label }), el('span', { text: role.permissions.includes('*') ? 'Acesso completo' : `${role.permissions.length} permissões` })) )));
    const active = el('input', { type: 'checkbox', checked: user?.active !== false }); const local = el('div');
    const form = el('form', { class: 'form-stack' }, local, field('Nome', name), field('E-mail', email), field(user ? 'Nova senha' : 'Senha', password), field('Perfis de acesso', checks), el('label', { class: 'check-inline' }, active, 'Usuário ativo'), button(user ? 'Salvar alterações' : 'Criar usuário', { class: 'primary', type: 'submit' }));
    const dialog = modal(user ? 'Editar usuário' : 'Novo usuário', form, { wide: true });
    form.onsubmit = async (event) => { event.preventDefault(); try { const selected = [...checks.querySelectorAll('input:checked')].map((node) => node.value); if (!selected.length) throw new Error('Selecione ao menos um perfil de acesso.'); const payload = { name: name.value.trim(), email: email.value.trim(), roles: selected, active: active.checked }; if (password.value) payload.password = password.value; if (user) await api.updateUser(user.id, payload); else await api.createUser(payload); dialog.close(); await load(); } catch (error) { local.replaceChildren(alertBox(error.message || String(error))); } };
  }
  void Promise.all([api.roles().then((data) => { roles = data; }), load()]);
  return appShell(page, { title: 'Usuários e Acessos', subtitle: 'Administração' });
}
