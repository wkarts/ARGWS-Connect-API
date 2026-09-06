function qre() {
    const { t: e } = Ve(),
      [t, n] = y.useState(!1),
      { instance: r } = ct(),
      { updateSettings: s } = Hh(),
      { data: o, isLoading: l } = Vre({ instanceName: r?.name, token: r?.token }),
      u = on({
        resolver: an(Hre),
        defaultValues: {
          rejectCall: !1,
          msgCall: '',
          groupsIgnore: !1,
          alwaysOnline: !1,
          readMessages: !1,
          syncFullHistory: !1,
          readStatus: !1,
        },
      });
    y.useEffect(() => {
      o &&
        u.reset({
          rejectCall: o.rejectCall,
          msgCall: o.msgCall || '',
          groupsIgnore: o.groupsIgnore,
          alwaysOnline: o.alwaysOnline,
          readMessages: o.readMessages,
          syncFullHistory: o.syncFullHistory,
          readStatus: o.readStatus,
        });
    }, [u, o]);
    const d = async (m) => {
        try {
          if (!r || !r.name) throw new Error('instance not found');
          n(!0);
          const g = {
            rejectCall: m.rejectCall,
            msgCall: m.msgCall,
            groupsIgnore: m.groupsIgnore,
            alwaysOnline: m.alwaysOnline,
            readMessages: m.readMessages,
            syncFullHistory: m.syncFullHistory,
            readStatus: m.readStatus,
          };
          (await s({ instanceName: r.name, token: r.token, data: g }), me.success(e('settings.toast.success')));
        } catch (g) {
          (console.error(e('settings.toast.success'), g), me.error(e('settings.toast.error')));
        } finally {
          n(!1);
        }
      },
      f = [
        {
          name: 'groupsIgnore',
          label: e('settings.form.groupsIgnore.label'),
          description: e('settings.form.groupsIgnore.description'),
        },
        {
          name: 'alwaysOnline',
          label: e('settings.form.alwaysOnline.label'),
          description: e('settings.form.alwaysOnline.description'),
        },
        {
          name: 'readMessages',
          label: e('settings.form.readMessages.label'),
          description: e('settings.form.readMessages.description'),
        },
        {
          name: 'syncFullHistory',
          label: e('settings.form.syncFullHistory.label'),
          description: e('settings.form.syncFullHistory.description'),
        },
        {
          name: 'readStatus',
          label: e('settings.form.readStatus.label'),
          description: e('settings.form.readStatus.description'),
        },
      ],
      h = u.watch('rejectCall');
    return l
      ? i.jsx(On, {})
      : i.jsx(i.Fragment, {
          children: i.jsx(Fo, {
            ...u,
            children: i.jsx('form', {
              onSubmit: u.handleSubmit(d),
              className: 'w-full space-y-6',
              children: i.jsxs('div', {
                children: [
                  i.jsx('h3', { className: 'mb-1 text-lg font-medium', children: e('settings.title') }),
                  i.jsx($t, { className: 'my-4' }),
                  i.jsxs('div', {
                    className: 'mx-4 space-y-2 divide-y',
                    children: [
                      i.jsxs('div', {
                        className: 'flex flex-col p-4',
                        children: [
                          i.jsx(Pe, {
                            name: 'rejectCall',
                            label: e('settings.form.rejectCall.label'),
                            className: 'w-full justify-between',
                            helper: e('settings.form.rejectCall.description'),
                          }),
                          h &&
                            i.jsx('div', {
                              className: 'mr-16 mt-2',
                              children: i.jsx(le, {
                                name: 'msgCall',
                                children: i.jsx(bi, { placeholder: e('settings.form.msgCall.description') }),
                              }),
                            }),
                        ],
                      }),
                      f.map((m) =>
                        i.jsx(
                          'div',
                          {
                            className: 'flex p-4',
                            children: i.jsx(Pe, {
                              name: m.name,
                              label: m.label,
                              className: 'w-full justify-between',
                              helper: m.description,
                            }),
                          },
                          m.name,
                        ),
                      ),
                      i.jsx('div', {
                        className: 'flex justify-end pt-6',
                        children: i.jsx(se, {
                          type: 'submit',
                          disabled: t,
                          children: e(t ? 'settings.button.saving' : 'settings.button.save'),
                        }),
                      }),
                    ],
                  }),
                ],
              }),
            }),
          }),
        });
  }
