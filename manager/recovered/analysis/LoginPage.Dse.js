function Dse() {
    const { t: e } = Ve(),
      t = dn(),
      { theme: n } = tc(),
      r = on({
        resolver: an(Ase),
        defaultValues: { serverUrl: window.location.protocol + '//' + window.location.host, apiKey: '' },
      }),
      s = async (o) => {
        const l = await sT({ url: o.serverUrl });
        if (!l || !l.version) {
          (Pj(), r.setError('serverUrl', { type: 'manual', message: e('login.message.invalidServer') }));
          return;
        }
        if (!(await Ise({ token: o.apiKey, url: o.serverUrl }))) {
          r.setError('apiKey', { type: 'manual', message: e('login.message.invalidCredentials') });
          return;
        }
        (Rj({ version: l.version, clientName: l.clientName, url: o.serverUrl, token: o.apiKey }), t('/manager/'));
      };
    return i.jsxs('div', {
      className: 'flex min-h-screen flex-col',
      children: [
        i.jsx('div', {
          className: 'flex items-center justify-center pt-2',
          children: i.jsx('img', {
            className: 'h-10',
            src:
              n === 'dark'
                ? '/assets/images/argws-connect-logo-dark.svg'
                : '/assets/images/argws-connect-logo-horizontal.svg',
            alt: 'logo',
          }),
        }),
        i.jsx('div', {
          className: 'flex flex-1 items-center justify-center p-8',
          children: i.jsxs(So, {
            className: 'b-none w-[350px] shadow-none',
            children: [
              i.jsxs(Co, {
                children: [
                  i.jsx(gi, { className: 'text-center', children: e('login.title') }),
                  i.jsx(Kp, { className: 'text-center', children: e('login.description') }),
                ],
              }),
              i.jsx(Fo, {
                ...r,
                children: i.jsxs('form', {
                  onSubmit: r.handleSubmit(s),
                  children: [
                    i.jsx(Eo, {
                      children: i.jsxs('div', {
                        className: 'grid w-full items-center gap-4',
                        children: [
                          i.jsx(le, {
                            required: !0,
                            name: 'serverUrl',
                            label: e('login.form.serverUrl'),
                            children: i.jsx(ne, {}),
                          }),
                          i.jsx(le, {
                            required: !0,
                            name: 'apiKey',
                            label: e('login.form.apiKey'),
                            children: i.jsx(ne, { type: 'password' }),
                          }),
                        ],
                      }),
                    }),
                    i.jsx(Vh, {
                      className: 'flex justify-center',
                      children: i.jsx(se, { className: 'w-full', type: 'submit', children: e('login.button.login') }),
                    }),
                  ],
                }),
              }),
            ],
          }),
        }),
        i.jsx(Vb, {}),
      ],
    });
  }
