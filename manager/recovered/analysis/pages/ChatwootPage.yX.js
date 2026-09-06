function yX() {
    const { t: e } = Ve(),
      { instance: t } = ct(),
      [, n] = y.useState(!1),
      { createChatwoot: r } = mX(),
      { data: s } = hX({ instanceName: t?.name, token: t?.token }),
      o = on({
        resolver: an(vX),
        defaultValues: {
          enabled: !0,
          accountId: '',
          token: '',
          url: '',
          signMsg: !0,
          signDelimiter: '\\n',
          nameInbox: '',
          organization: '',
          logo: '',
          reopenConversation: !0,
          conversationPending: !1,
          mergeBrazilContacts: !0,
          importContacts: !1,
          importMessages: !1,
          daysLimitImportMessages: 7,
          autoCreate: !0,
          ignoreJids: [],
        },
      });
    y.useEffect(() => {
      if (s) {
        o.setValue('ignoreJids', s.ignoreJids || []);
        const u = {
          enabled: s.enabled,
          accountId: s.accountId,
          token: s.token,
          url: s.url,
          signMsg: s.signMsg || !1,
          signDelimiter: s.signDelimiter || '\\n',
          nameInbox: s.nameInbox || '',
          organization: s.organization || '',
          logo: s.logo || '',
          reopenConversation: s.reopenConversation || !1,
          conversationPending: s.conversationPending || !1,
          mergeBrazilContacts: s.mergeBrazilContacts || !1,
          importContacts: s.importContacts || !1,
          importMessages: s.importMessages || !1,
          daysLimitImportMessages: s.daysLimitImportMessages || 7,
          autoCreate: s.autoCreate || !1,
          ignoreJids: s.ignoreJids,
        };
        o.reset(u);
      }
    }, [s, o]);
    const l = async (u) => {
      if (!t) return;
      n(!0);
      const d = {
        enabled: u.enabled,
        accountId: u.accountId,
        token: u.token,
        url: u.url,
        signMsg: u.signMsg || !1,
        signDelimiter: u.signDelimiter || '\\n',
        nameInbox: u.nameInbox || '',
        organization: u.organization || '',
        logo: u.logo || '',
        reopenConversation: u.reopenConversation || !1,
        conversationPending: u.conversationPending || !1,
        mergeBrazilContacts: u.mergeBrazilContacts || !1,
        importContacts: u.importContacts || !1,
        importMessages: u.importMessages || !1,
        daysLimitImportMessages: u.daysLimitImportMessages || 7,
        autoCreate: u.autoCreate,
        ignoreJids: u.ignoreJids,
      };
      await r(
        { instanceName: t.name, token: t.token, data: d },
        {
          onSuccess: () => {
            me.success(e('chatwoot.toast.success'));
          },
          onError: (f) => {
            (console.error(e('chatwoot.toast.error'), f),
              rT(f) ? me.error(`Error: ${f?.response?.data?.response?.message}`) : me.error(e('chatwoot.toast.error')));
          },
          onSettled: () => {
            n(!1);
          },
        },
      );
    };
    return i.jsx(i.Fragment, {
      children: i.jsx(Fo, {
        ...o,
        children: i.jsxs('form', {
          onSubmit: o.handleSubmit(l),
          className: 'w-full space-y-6',
          children: [
            i.jsxs('div', {
              children: [
                i.jsx('h3', { className: 'mb-1 text-lg font-medium', children: e('chatwoot.title') }),
                i.jsx(Oa, { className: 'my-4' }),
                i.jsxs('div', {
                  className: 'mx-4 space-y-2 divide-y [&>*]:px-4 [&>*]:py-2',
                  children: [
                    i.jsx(Pe, {
                      name: 'enabled',
                      label: e('chatwoot.form.enabled.label'),
                      className: 'w-full justify-between',
                      helper: e('chatwoot.form.enabled.description'),
                    }),
                    i.jsx(le, { name: 'url', label: e('chatwoot.form.url.label'), children: i.jsx(ne, {}) }),
                    i.jsx(le, {
                      name: 'accountId',
                      label: e('chatwoot.form.accountId.label'),
                      children: i.jsx(ne, {}),
                    }),
                    i.jsx(le, {
                      name: 'token',
                      label: e('chatwoot.form.token.label'),
                      children: i.jsx(ne, { type: 'password' }),
                    }),
                    i.jsx(Pe, {
                      name: 'signMsg',
                      label: e('chatwoot.form.signMsg.label'),
                      className: 'w-full justify-between',
                      helper: e('chatwoot.form.signMsg.description'),
                    }),
                    i.jsx(le, {
                      name: 'signDelimiter',
                      label: e('chatwoot.form.signDelimiter.label'),
                      children: i.jsx(ne, {}),
                    }),
                    i.jsx(le, {
                      name: 'nameInbox',
                      label: e('chatwoot.form.nameInbox.label'),
                      children: i.jsx(ne, {}),
                    }),
                    i.jsx(le, {
                      name: 'organization',
                      label: e('chatwoot.form.organization.label'),
                      children: i.jsx(ne, {}),
                    }),
                    i.jsx(le, { name: 'logo', label: e('chatwoot.form.logo.label'), children: i.jsx(ne, {}) }),
                    i.jsx(Pe, {
                      name: 'conversationPending',
                      label: e('chatwoot.form.conversationPending.label'),
                      className: 'w-full justify-between',
                      helper: e('chatwoot.form.conversationPending.description'),
                    }),
                    i.jsx(Pe, {
                      name: 'reopenConversation',
                      label: e('chatwoot.form.reopenConversation.label'),
                      className: 'w-full justify-between',
                      helper: e('chatwoot.form.reopenConversation.description'),
                    }),
                    i.jsx(Pe, {
                      name: 'importContacts',
                      label: e('chatwoot.form.importContacts.label'),
                      className: 'w-full justify-between',
                      helper: e('chatwoot.form.importContacts.description'),
                    }),
                    i.jsx(Pe, {
                      name: 'importMessages',
                      label: e('chatwoot.form.importMessages.label'),
                      className: 'w-full justify-between',
                      helper: e('chatwoot.form.importMessages.description'),
                    }),
                    i.jsx(le, {
                      name: 'daysLimitImportMessages',
                      label: e('chatwoot.form.daysLimitImportMessages.label'),
                      children: i.jsx(ne, { type: 'number' }),
                    }),
                    i.jsx(Da, {
                      name: 'ignoreJids',
                      label: e('chatwoot.form.ignoreJids.label'),
                      placeholder: e('chatwoot.form.ignoreJids.placeholder'),
                    }),
                    i.jsx(Pe, {
                      name: 'autoCreate',
                      label: e('chatwoot.form.autoCreate.label'),
                      className: 'w-full justify-between',
                      helper: e('chatwoot.form.autoCreate.description'),
                    }),
                  ],
                }),
              ],
            }),
            i.jsx('div', {
              className: 'mx-4 flex justify-end',
              children: i.jsx(se, { type: 'submit', children: e('chatwoot.button.save') }),
            }),
          ],
        }),
      }),
    });
  }
