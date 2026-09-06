function jse() {
    const { t: e } = Ve(),
      { instance: t } = ct(),
      [n, r] = y.useState(!1),
      { createWebhook: s } = Ese(),
      { data: o } = Sse({ instanceName: t?.name, token: t?.token }),
      l = on({ resolver: an(kse), defaultValues: { enabled: !1, url: '', events: [], base64: !1, byEvents: !1 } });
    y.useEffect(() => {
      o &&
        l.reset({
          enabled: o.enabled,
          url: o.url,
          events: o.events,
          base64: o.webhookBase64,
          byEvents: o.webhookByEvents,
        });
    }, [o]);
    const u = async (m) => {
        if (t) {
          r(!0);
          try {
            const g = { enabled: m.enabled, url: m.url, events: m.events, base64: m.base64, byEvents: m.byEvents };
            (await s({ instanceName: t.name, token: t.token, data: g }), me.success(e('webhook.toast.success')));
          } catch (g) {
            (console.error(e('webhook.toast.error'), g), me.error(`Error: ${g?.response?.data?.response?.message}`));
          } finally {
            r(!1);
          }
        }
      },
      d = [
        'APPLICATION_STARTUP',
        'QRCODE_UPDATED',
        'MESSAGES_SET',
        'MESSAGES_UPSERT',
        'MESSAGES_UPDATE',
        'MESSAGES_DELETE',
        'SEND_MESSAGE',
        'CONTACTS_SET',
        'CONTACTS_UPSERT',
        'CONTACTS_UPDATE',
        'PRESENCE_UPDATE',
        'CHATS_SET',
        'CHATS_UPSERT',
        'CHATS_UPDATE',
        'CHATS_DELETE',
        'GROUPS_UPSERT',
        'GROUP_UPDATE',
        'GROUP_PARTICIPANTS_UPDATE',
        'CONNECTION_UPDATE',
        'REMOVE_INSTANCE',
        'LOGOUT_INSTANCE',
        'LABELS_EDIT',
        'LABELS_ASSOCIATION',
        'CALL',
        'TYPEBOT_START',
        'TYPEBOT_CHANGE_STATUS',
      ],
      f = () => {
        l.setValue('events', d);
      },
      h = () => {
        l.setValue('events', []);
      };
    return i.jsx(i.Fragment, {
      children: i.jsx(Fo, {
        ...l,
        children: i.jsx('form', {
          onSubmit: l.handleSubmit(u),
          className: 'w-full space-y-6',
          children: i.jsxs('div', {
            children: [
              i.jsx('h3', { className: 'mb-1 text-lg font-medium', children: e('webhook.title') }),
              i.jsx(Oa, { className: 'my-4' }),
              i.jsxs('div', {
                className: 'mx-4 space-y-2 divide-y [&>*]:p-4',
                children: [
                  i.jsx(Pe, {
                    name: 'enabled',
                    label: e('webhook.form.enabled.label'),
                    className: 'w-full justify-between',
                    helper: e('webhook.form.enabled.description'),
                  }),
                  i.jsx(le, { name: 'url', label: 'URL', children: i.jsx(ne, {}) }),
                  i.jsx(Pe, {
                    name: 'byEvents',
                    label: e('webhook.form.byEvents.label'),
                    className: 'w-full justify-between',
                    helper: e('webhook.form.byEvents.description'),
                  }),
                  i.jsx(Pe, {
                    name: 'base64',
                    label: e('webhook.form.base64.label'),
                    className: 'w-full justify-between',
                    helper: e('webhook.form.base64.description'),
                  }),
                  i.jsxs('div', {
                    className: 'mb-4 flex justify-between',
                    children: [
                      i.jsx(se, { variant: 'outline', type: 'button', onClick: f, children: e('button.markAll') }),
                      i.jsx(se, { variant: 'outline', type: 'button', onClick: h, children: e('button.unMarkAll') }),
                    ],
                  }),
                  i.jsx(Lo, {
                    control: l.control,
                    name: 'events',
                    render: ({ field: m }) =>
                      i.jsxs(no, {
                        className: 'flex flex-col',
                        children: [
                          i.jsx(Nr, { className: 'my-2 text-lg', children: e('webhook.form.events.label') }),
                          i.jsx(_s, {
                            children: i.jsx('div', {
                              className: 'flex flex-col gap-2 space-y-1 divide-y',
                              children: d
                                .sort((g, x) => g.localeCompare(x))
                                .map((g) =>
                                  i.jsxs(
                                    'div',
                                    {
                                      className: 'flex items-center justify-between gap-3 pt-3',
                                      children: [
                                        i.jsx(Nr, {
                                          className: Ie(
                                            'break-all',
                                            m.value.includes(g) ? 'text-foreground' : 'text-muted-foreground',
                                          ),
                                          children: g,
                                        }),
                                        i.jsx(gc, {
                                          checked: m.value.includes(g),
                                          onCheckedChange: (x) => {
                                            x
                                              ? m.onChange([...m.value, g])
                                              : m.onChange(m.value.filter((b) => b !== g));
                                          },
                                        }),
                                      ],
                                    },
                                    g,
                                  ),
                                ),
                            }),
                          }),
                        ],
                      }),
                  }),
                ],
              }),
              i.jsx('div', {
                className: 'mx-4 flex justify-end pt-6',
                children: i.jsx(se, {
                  type: 'submit',
                  disabled: n,
                  children: e(n ? 'webhook.button.saving' : 'webhook.button.save'),
                }),
              }),
            ],
          }),
        }),
      }),
    });
  }
