function zM({ instanceId: e }) {
    const [t, n] = y.useState(!1),
      r = dn(),
      { theme: s } = tc(),
      o = () => {
        (Pj(), r('/manager/login'));
      },
      l = () => {
        r('/manager/');
      },
      { data: u } = vT({ instanceId: e });
    return i.jsxs('header', {
      className: 'flex items-center justify-between px-4 py-2',
      children: [
        i.jsx(Fu, {
          to: '/manager',
          onClick: l,
          className: 'flex h-8 items-center gap-4',
          children: i.jsx('img', {
            src:
              s === 'dark'
                ? '/assets/images/argws-connect-logo-dark.svg'
                : '/assets/images/argws-connect-logo-horizontal.svg',
            alt: 'Logo',
            className: 'h-full',
          }),
        }),
        i.jsxs('div', {
          className: 'flex items-center gap-4',
          children: [
            e &&
              i.jsx(Ei, {
                className: 'h-8 w-8',
                children: i.jsx(ki, {
                  src: u?.profilePicUrl || '/assets/images/argws-connect-compact-symbol.png',
                  alt: u?.name,
                }),
              }),
            i.jsx(iM, {}),
            i.jsx(lM, {}),
            i.jsx(se, {
              onClick: () => n(!0),
              variant: 'destructive',
              size: 'icon',
              children: i.jsx(eB, { size: '18' }),
            }),
          ],
        }),
        t &&
          i.jsx(Pt, {
            onOpenChange: n,
            open: t,
            children: i.jsxs(Nt, {
              children: [
                i.jsx($M, {}),
                i.jsx(Mt, { children: 'Deseja realmente sair?' }),
                i.jsx(Yt, {
                  children: i.jsxs('div', {
                    className: 'flex items-center gap-4',
                    children: [
                      i.jsx(se, { onClick: () => n(!1), size: 'sm', variant: 'outline', children: 'Cancelar' }),
                      i.jsx(se, { onClick: o, variant: 'destructive', children: 'Sair' }),
                    ],
                  }),
                }),
              ],
            }),
          }),
      ],
    });
  }
