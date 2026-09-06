function CZ() {
    const { t: e } = Ve(),
      [t, n] = y.useState(null),
      { deleteInstance: r, logout: s } = Hh(),
      { data: o, refetch: l } = q5(),
      [u, d] = y.useState([]),
      [f, h] = y.useState('all'),
      [m, g] = y.useState(''),
      x = async () => {
        await l();
      },
      b = async (k) => {
        (n(null), d([...u, k]));
        try {
          try {
            await s(k);
          } catch (j) {
            console.error('Error logout:', j);
          }
          (await r(k), await new Promise((j) => setTimeout(j, 1e3)), x());
        } catch (j) {
          (console.error('Error instance delete:', j), me.error(`Error : ${j?.response?.data?.response?.message}`));
        } finally {
          d(u.filter((j) => j !== k));
        }
      },
      w = y.useMemo(() => {
        let k = o ? [...o] : [];
        return (
          f !== 'all' && (k = k.filter((j) => j.connectionStatus === f)),
          m !== '' && (k = k.filter((j) => j.name.toLowerCase().includes(m.toLowerCase()))),
          k
        );
      }, [o, m, f]),
      C = [
        { value: 'all', label: e('status.all') },
        { value: 'close', label: e('status.closed') },
        { value: 'connecting', label: e('status.connecting') },
        { value: 'open', label: e('status.open') },
      ];
    return i.jsxs('div', {
      className: 'my-4 px-4',
      children: [
        i.jsxs('div', {
          className: 'flex w-full items-center justify-between',
          children: [
            i.jsx('h2', { className: 'text-lg', children: e('dashboard.title') }),
            i.jsxs('div', {
              className: 'flex gap-2',
              children: [
                i.jsx(se, { variant: 'outline', size: 'icon', children: i.jsx(Ip, { onClick: x, size: '20' }) }),
                i.jsx(dQ, { resetTable: x }),
              ],
            }),
          ],
        }),
        i.jsxs('div', {
          className: 'my-4 flex items-center justify-between gap-3 px-4',
          children: [
            i.jsx('div', {
              className: 'flex-1',
              children: i.jsx(ne, { placeholder: e('dashboard.search'), value: m, onChange: (k) => g(k.target.value) }),
            }),
            i.jsxs(Kr, {
              children: [
                i.jsx(Wr, {
                  asChild: !0,
                  children: i.jsxs(se, {
                    variant: 'secondary',
                    children: [e('dashboard.status'), ' ', i.jsx(J$, { size: '15' })],
                  }),
                }),
                i.jsx(hr, {
                  children: C.map((k) =>
                    i.jsx(
                      aM,
                      {
                        checked: f === k.value,
                        onCheckedChange: (j) => {
                          j && h(k.value);
                        },
                        children: k.label,
                      },
                      k.value,
                    ),
                  ),
                }),
              ],
            }),
          ],
        }),
        i.jsx('main', {
          className: 'grid gap-6 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
          children:
            w.length > 0 && Array.isArray(w)
              ? w.map((k) =>
                  i.jsxs(
                    So,
                    {
                      children: [
                        i.jsx(Co, {
                          children: i.jsxs(Fu, {
                            to: `/manager/instance/${k.id}/dashboard`,
                            className: 'flex w-full flex-row items-center justify-between gap-4',
                            children: [
                              i.jsx(FE, {
                                content: k.name,
                                side: 'top',
                                children: i.jsx('h3', {
                                  className: 'text-wrap font-semibold truncate',
                                  children: k.name,
                                }),
                              }),
                              i.jsx(FE, {
                                content: e('dashboard.settings'),
                                side: 'top',
                                children: i.jsx(se, {
                                  variant: 'ghost',
                                  size: 'icon',
                                  children: i.jsx(Oo, { className: 'card-icon', size: '20' }),
                                }),
                              }),
                            ],
                          }),
                        }),
                        i.jsxs(Eo, {
                          className: 'flex-1 space-y-6',
                          children: [
                            i.jsx(c_, { token: k.token }),
                            i.jsxs('div', {
                              className: 'flex w-full flex-wrap',
                              children: [
                                i.jsx('div', {
                                  className: 'flex flex-1 gap-2',
                                  children:
                                    k.profileName &&
                                    i.jsxs(i.Fragment, {
                                      children: [
                                        i.jsx(Ei, { children: i.jsx(ki, { src: k.profilePicUrl, alt: '' }) }),
                                        i.jsxs('div', {
                                          className: 'space-y-1',
                                          children: [
                                            i.jsx('strong', { children: k.profileName }),
                                            i.jsx('p', {
                                              className: 'text-sm text-muted-foreground',
                                              children: k.ownerJid && k.ownerJid.split('@')[0],
                                            }),
                                          ],
                                        }),
                                      ],
                                    }),
                                }),
                                i.jsxs('div', {
                                  className: 'flex items-center justify-end gap-4 text-sm',
                                  children: [
                                    i.jsxs('div', {
                                      className: 'flex flex-col items-center justify-center gap-1',
                                      children: [
                                        i.jsx(pT, { className: 'text-muted-foreground', size: '20' }),
                                        i.jsx('span', {
                                          children: new Intl.NumberFormat('pt-BR').format(k?._count?.Contact || 0),
                                        }),
                                      ],
                                    }),
                                    i.jsxs('div', {
                                      className: 'flex flex-col items-center justify-center gap-1',
                                      children: [
                                        i.jsx(Bl, { className: 'text-muted-foreground', size: '20' }),
                                        i.jsx('span', {
                                          children: new Intl.NumberFormat('pt-BR').format(k?._count?.Message || 0),
                                        }),
                                      ],
                                    }),
                                  ],
                                }),
                              ],
                            }),
                          ],
                        }),
                        i.jsxs(Vh, {
                          className: 'justify-between',
                          children: [
                            i.jsx(l_, { status: k.connectionStatus }),
                            i.jsx(se, {
                              variant: 'destructive',
                              size: 'sm',
                              onClick: () => n(k.name),
                              disabled: u.includes(k.name),
                              children: u.includes(k.name)
                                ? i.jsx('span', { children: e('button.deleting') })
                                : i.jsx('span', { children: e('button.delete') }),
                            }),
                          ],
                        }),
                      ],
                    },
                    k.id,
                  ),
                )
              : i.jsx('p', { children: e('dashboard.instancesNotFound') }),
        }),
        !!t &&
          i.jsx(Pt, {
            onOpenChange: () => n(null),
            open: !0,
            children: i.jsxs(Nt, {
              children: [
                i.jsx($M, {}),
                i.jsx(Mt, { children: e('modal.delete.title') }),
                i.jsx('p', { children: e('modal.delete.message', { instanceName: t }) }),
                i.jsx(Yt, {
                  children: i.jsxs('div', {
                    className: 'flex items-center gap-4',
                    children: [
                      i.jsx(se, {
                        onClick: () => n(null),
                        size: 'sm',
                        variant: 'outline',
                        children: e('button.cancel'),
                      }),
                      i.jsx(se, { onClick: () => b(t), variant: 'destructive', children: e('button.delete') }),
                    ],
                  }),
                }),
              ],
            }),
          }),
      ],
    });
  }
