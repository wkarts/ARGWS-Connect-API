import {
  alertBox,
  button,
  card,
  el,
  field,
  input,
  jsonEditor,
  modal,
  select,
  spinner,
  textarea,
  toggle,
} from '../core/dom.js';
import {
  changeIgnoredJid,
  changeIntegrationStatus,
  createIntegration,
  createOpenAiCredential,
  definitions,
  deleteIntegration,
  deleteOpenAiCredential,
  fetchSessions,
  fetchSettings,
  findOpenAiCredentials,
  findIntegrations,
  getId,
  saveSettings,
  updateIntegration,
} from '../api/integrations.js';
import { loadSession } from '../core/session.js';
import { instanceShell, pageHeader } from '../components/shell.js';

function cloneObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return typeof globalThis.structuredClone === 'function'
    ? globalThis.structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function normalizeList(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.records)) return data.records;
  return data ? [data] : [];
}

function normalizeNumber(value) {
  if (value === '' || value == null) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function cleanPayload(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  );
}

export function renderIntegration(instance, key) {
  const session = loadSession();
  const definition = definitions[key];
  const page = el('div', { class: 'page' });
  const body = el('div');
  const feedback = el('div');
  let items = [];

  if (!definition) {
    body.append(alertBox(`Integração não suportada pelo Manager: ${key}`));
    page.append(pageHeader('Integração', instance.name), body);
    return instanceShell(instance, key, page);
  }

  function setFeedback(message, kind = 'error') {
    feedback.replaceChildren(alertBox(message, kind));
  }

  async function load() {
    feedback.replaceChildren();
    body.replaceChildren(el('div', { class: 'center' }, spinner()));
    try {
      items = normalizeList(await findIntegrations(session, instance, key));
      draw();
    } catch (error) {
      body.replaceChildren();
      setFeedback(error.message || String(error));
    }
  }

  function draw() {
    body.replaceChildren();

    if (!items.length) {
      body.append(
        el(
          'div',
          { class: 'empty' },
          el('strong', { text: `Nenhuma configuração ${definition.title}` }),
          el('span', { text: 'Adicione uma configuração para começar.' }),
        ),
      );
      return;
    }

    const stack = el('div', { class: 'list-stack' });
    items.forEach((item, index) => {
      const id = getId(item);
      stack.append(
        card(
          el(
            'div',
            { class: 'list-row' },
            el(
              'div',
              {},
              el('strong', {
                text: item.description || item.name || `${definition.title} ${index + 1}`,
              }),
              el('span', {
                class: 'muted',
                text: `${item.enabled === false ? 'Desativado' : 'Ativo'} · ${id || 'sem id'}`,
              }),
            ),
            el(
              'div',
              { class: 'actions' },
              id
                ? button('Sessões', {
                    onclick: () => showSessions(item),
                  })
                : null,
              button('Editar', { onclick: () => void openEditor(item) }),
              id
                ? button('Excluir', {
                    class: 'danger',
                    onclick: () => remove(item),
                  })
                : null,
            ),
          ),
        ),
      );
    });
    body.append(stack);
  }

  async function openEditor(item = null) {
    let value = item
      ? cloneObject(item)
      : {
          enabled: true,
          triggerType: 'all',
          triggerOperator: 'contains',
          expire: 0,
          delayMessage: 0,
          listeningFromMe: false,
          stopBotFromMe: false,
          keepOpen: false,
          debounceTime: 0,
          ignoreJids: [],
        };

    const form = el('form', { class: 'form-stack' });
    const formFeedback = el('div');
    form.append(formFeedback);

    for (const descriptor of definition.fields) {
      const current = value[descriptor.key];

      if (descriptor.type === 'boolean') {
        form.append(
          toggle(descriptor.label, Boolean(current ?? descriptor.defaultValue), (next) => {
            value[descriptor.key] = next;
          }),
        );
        continue;
      }

      let dynamicOptions = descriptor.options || [];
      if (key === 'openai' && descriptor.key === 'openaiCredsId') {
        try {
          const creds = await findOpenAiCredentials(session, instance);
          dynamicOptions = (Array.isArray(creds) ? creds : creds ? [creds] : []).map((credential) => ({
            value: credential.id || credential.openaiCredsId || '',
            label: credential.name || credential.id || credential.openaiCredsId || 'Credencial',
          }));
        } catch {
          dynamicOptions = [];
        }
      }

      let control;
      if (descriptor.type === 'select' || (key === 'openai' && descriptor.key === 'openaiCredsId')) {
        control = select(
          current ?? descriptor.defaultValue ?? '',
          [
            { value: '', label: 'Selecione' },
            ...dynamicOptions.map((option) =>
              typeof option === 'string' ? { value: option, label: option } : option,
            ),
          ],
        );
      } else if (descriptor.type === 'textarea') {
        control = textarea(current ?? '', { rows: descriptor.rows || 4 });
      } else if (descriptor.type === 'list') {
        control = textarea(Array.isArray(current) ? current.join('\n') : '', {
          rows: descriptor.rows || 4,
          placeholder: 'Um item por linha',
        });
      } else {
        control = input(current ?? '', {
          type:
            descriptor.type === 'password'
              ? 'password'
              : descriptor.type === 'number'
                ? 'number'
                : descriptor.type === 'url'
                  ? 'url'
                  : 'text',
          required: descriptor.required === true,
          placeholder: descriptor.placeholder || '',
        });
      }

      const updateValue = () => {
        if (descriptor.type === 'number') {
          value[descriptor.key] = normalizeNumber(control.value);
        } else if (descriptor.type === 'list') {
          value[descriptor.key] = control.value
            .split(/\r?\n|,/)
            .map((entry) => entry.trim())
            .filter(Boolean);
        } else {
          value[descriptor.key] = control.value;
        }
      };

      control.addEventListener('input', updateValue);
      control.addEventListener('change', updateValue);
      form.append(field(descriptor.label, control, descriptor.hint));
    }

    const advanced = el(
      'details',
      {},
      el('summary', { text: 'JSON avançado' }),
      jsonEditor(value, (next) => {
        value = next;
      }),
    );

    form.append(advanced, button('Salvar', { class: 'primary', type: 'submit' }));
    const dialog = modal(
      item ? `Editar ${definition.title}` : `Novo ${definition.title}`,
      form,
    );

    form.onsubmit = async (event) => {
      event.preventDefault();
      formFeedback.replaceChildren();
      try {
        const payload = cleanPayload(value);
        const id = getId(item);
        if (id) {
          await updateIntegration(session, instance, key, id, payload);
        } else {
          await createIntegration(session, instance, key, payload);
        }
        dialog.close();
        setFeedback('Configuração salva.', 'success');
        await load();
      } catch (error) {
        formFeedback.replaceChildren(alertBox(error.message || String(error)));
      }
    };
  }

  async function remove(item) {
    const id = getId(item);
    if (!id || !window.confirm('Excluir esta integração?')) return;

    try {
      await deleteIntegration(session, instance, key, id);
      setFeedback('Integração excluída.', 'success');
      await load();
    } catch (error) {
      setFeedback(error.message || String(error));
    }
  }

  async function manageOpenAiCredentials() {
    feedback.replaceChildren();
    const content = el('div', { class: 'form-stack' });
    const credentialsList = el('div', { class: 'list-stack' });
    const credentialFeedback = el('div');
    const name = input('', { required: true, autocomplete: 'off' });
    const apiKey = input('', { type: 'password', required: true, autocomplete: 'new-password' });
    const createForm = el(
      'form',
      { class: 'form-stack' },
      el('h4', { text: 'Nova credencial' }),
      field('Nome', name),
      field('Chave da API', apiKey),
      button('Adicionar credencial', { class: 'primary', type: 'submit' }),
    );

    async function reloadCredentials() {
      credentialsList.replaceChildren(el('div', { class: 'center' }, spinner()));
      try {
        const data = await findOpenAiCredentials(session, instance);
        const rows = Array.isArray(data) ? data : data ? [data] : [];
        credentialsList.replaceChildren();
        if (!rows.length) {
          credentialsList.append(el('div', { class: 'empty small' }, el('span', { text: 'Nenhuma credencial cadastrada.' })));
          return;
        }
        rows.forEach((credential) => {
          const id = credential.id || credential.openaiCredsId;
          credentialsList.append(
            card(
              el(
                'div',
                { class: 'list-row' },
                el('div', {}, el('strong', { text: credential.name || id || 'Credencial' }), el('span', { class: 'muted', text: id || '' })),
                id
                  ? button('Excluir', {
                      class: 'danger',
                      onclick: async () => {
                        if (!window.confirm('Excluir esta credencial?')) return;
                        try {
                          await deleteOpenAiCredential(session, instance, id);
                          await reloadCredentials();
                        } catch (error) {
                          credentialFeedback.replaceChildren(alertBox(error.message || String(error)));
                        }
                      },
                    })
                  : null,
              ),
            ),
          );
        });
      } catch (error) {
        credentialsList.replaceChildren(alertBox(error.message || String(error)));
      }
    }

    createForm.onsubmit = async (event) => {
      event.preventDefault();
      credentialFeedback.replaceChildren();
      try {
        await createOpenAiCredential(session, instance, {
          name: name.value.trim(),
          apiKey: apiKey.value.trim(),
        });
        name.value = '';
        apiKey.value = '';
        await reloadCredentials();
      } catch (error) {
        credentialFeedback.replaceChildren(alertBox(error.message || String(error)));
      }
    };

    content.append(credentialFeedback, credentialsList, createForm);
    modal('Credenciais OpenAI', content);
    await reloadCredentials();
  }

  async function openSettings() {
    feedback.replaceChildren();
    try {
      let value = await fetchSettings(session, instance, key);
      if (Array.isArray(value)) value = value[0] || {};
      value = cloneObject(value);

      const content = el('div', { class: 'form-stack' });
      const settingsFeedback = el('div');
      const editor = jsonEditor(value, (next) => {
        value = next;
      });
      content.append(settingsFeedback, editor);

      const dialog = modal(`Configurações ${definition.title}`, content);
      content.append(
        button('Salvar configurações', {
          class: 'primary',
          onclick: async () => {
            settingsFeedback.replaceChildren();
            try {
              await saveSettings(session, instance, key, cleanPayload(value));
              dialog.close();
              setFeedback('Configurações salvas.', 'success');
            } catch (error) {
              settingsFeedback.replaceChildren(alertBox(error.message || String(error)));
            }
          },
        }),
      );
    } catch (error) {
      setFeedback(error.message || String(error));
    }
  }

  async function showSessions(item) {
    const id = getId(item);
    if (!id) return;

    feedback.replaceChildren();
    const content = el('div', { class: 'form-stack' });
    const sessionFeedback = el('div');
    const rowsHost = el('div', { class: 'list-stack' });
    content.append(sessionFeedback, rowsHost);
    modal(`Sessões ${definition.title}`, content);

    const loadSessions = async () => {
      rowsHost.replaceChildren(el('div', { class: 'center' }, spinner()));
      sessionFeedback.replaceChildren();
      try {
        const rows = normalizeList(await fetchSessions(session, instance, key, id));
        rowsHost.replaceChildren();
        if (!rows.length) {
          rowsHost.append(
            el('div', { class: 'empty small' }, el('span', { text: 'Nenhuma sessão encontrada.' })),
          );
          return;
        }

        for (const row of rows) {
          const remoteJid = row.remoteJid || row.jid || '';
          const status = row.status || 'desconhecido';
          const actions = el('div', { class: 'actions' });

          if (remoteJid) {
            for (const [label, nextStatus, className] of [
              ['Abrir', 'opened', ''],
              ['Pausar', 'paused', ''],
              ['Fechar', 'closed', ''],
              ['Excluir', 'delete', 'danger'],
            ]) {
              actions.append(
                button(label, {
                  class: className,
                  onclick: async () => {
                    sessionFeedback.replaceChildren();
                    try {
                      await changeIntegrationStatus(session, instance, key, remoteJid, nextStatus);
                      await loadSessions();
                    } catch (error) {
                      sessionFeedback.replaceChildren(alertBox(error.message || String(error)));
                    }
                  },
                }),
              );
            }

            actions.append(
              button('Ignorar JID', {
                onclick: async () => {
                  sessionFeedback.replaceChildren();
                  try {
                    await changeIgnoredJid(session, instance, key, remoteJid, 'add');
                    sessionFeedback.replaceChildren(alertBox('JID adicionado à lista de ignorados.', 'success'));
                  } catch (error) {
                    sessionFeedback.replaceChildren(alertBox(error.message || String(error)));
                  }
                },
              }),
            );
          }

          rowsHost.append(
            card(
              el(
                'div',
                { class: 'list-row' },
                el(
                  'div',
                  {},
                  el('strong', { text: remoteJid || 'Sessão' }),
                  el('span', { class: 'muted', text: `Status: ${status}` }),
                ),
                actions,
              ),
            ),
          );
        }
      } catch (error) {
        rowsHost.replaceChildren();
        sessionFeedback.replaceChildren(alertBox(error.message || String(error)));
      }
    };

    await loadSessions();
  }

  page.append(
    pageHeader(
      definition.title,
      `Gerencie automações vinculadas à instância ${instance.name}.`,
      [
        button('Atualizar', { onclick: load }),
        key === 'openai' ? button('Credenciais', { onclick: () => void manageOpenAiCredentials() }) : null,
        button('Configurações', { onclick: openSettings }),
        button('Adicionar', { class: 'primary', onclick: () => void openEditor() }),
      ],
    ),
    feedback,
    body,
  );

  void load();
  return instanceShell(instance, key, page);
}
