function Ore() {
    const { t: e } = Ve(),
      { instance: t } = ct(),
      [n, r] = y.useState(!1),
      { createProxy: s } = Rre(),
      { data: o } = Mre({ instanceName: t?.name }),
      l = on({
        resolver: an(Pre),
        defaultValues: { enabled: !1, host: '', port: '', protocol: 'http', username: '', password: '' },
      });
    y.useEffect(() => {
      o &&
        l.reset({
          enabled: o.enabled,
          host: o.host,
          port: o.port,
          protocol: o.protocol,
          username: o.username,
          password: o.password,
        });
    }, [o]);
    const u = async (d) => {
      if (t) {
        r(!0);
        try {
          const f = {
            enabled: d.enabled,
            host: d.host,
            port: d.port,
            protocol: d.protocol,
            username: d.username,
            password: d.password,
          };
          (await s({ instanceName: t.name, token: t.token, data: f }), me.success(e('proxy.toast.success')));
        } catch (f) {
          (console.error(e('proxy.toast.error'), f), me.error(`Error : ${f?.response?.data?.response?.message}`));
        } finally {
          r(!1);
        }
      }
    };
    return i.jsx(i.Fragment, {
      children: i.jsx(Fo, {
        ...l,
        children: i.jsx('form', {
          onSubmit: l.handleSubmit(u),
          className: 'w-full space-y-6',
          children: i.jsxs('div', {
            children: [
              i.jsx('h3', { className: 'mb-1 text-lg font-medium', children: e('proxy.title') }),
              i.jsx(Oa, { className: 'my-4' }),
              i.jsxs('div', {
                className: 'mx-4 space-y-2 divide-y [&>*]:p-4',
                children: [
                  i.jsx(Pe, {
                    name: 'enabled',
                    label: e('proxy.form.enabled.label'),
                    className: 'w-full justify-between',
                    helper: e('proxy.form.enabled.description'),
                  }),
                  i.jsxs('div', {
                    className: 'grid gap-4 sm:grid-cols-[10rem_1fr_10rem] md:gap-8',
                    children: [
                      i.jsx(le, { name: 'protocol', label: e('proxy.form.protocol.label'), children: i.jsx(ne, {}) }),
                      i.jsx(le, { name: 'host', label: e('proxy.form.host.label'), children: i.jsx(ne, {}) }),
                      i.jsx(le, {
                        name: 'port',
                        label: e('proxy.form.port.label'),
                        children: i.jsx(ne, { type: 'number' }),
                      }),
                    ],
                  }),
                  i.jsxs('div', {
                    className: 'grid gap-4 sm:grid-cols-2 md:gap-8',
                    children: [
                      i.jsx(le, { name: 'username', label: e('proxy.form.username.label'), children: i.jsx(ne, {}) }),
                      i.jsx(le, {
                        name: 'password',
                        label: e('proxy.form.password.label'),
                        children: i.jsx(ne, { type: 'password' }),
                      }),
                    ],
                  }),
                  i.jsx('div', {
                    className: 'flex justify-end px-4 pt-6',
                    children: i.jsx(se, {
                      type: 'submit',
                      disabled: n,
                      children: e(n ? 'proxy.button.saving' : 'proxy.button.save'),
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
