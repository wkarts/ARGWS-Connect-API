function PX() {
    const { t: e, i18n: t } = Ve(),
      n = new Intl.NumberFormat(t.language),
      [r, s] = y.useState(null),
      [o, l] = y.useState(''),
      u = dr(jn.TOKEN),
      { theme: d } = tc(),
      { connect: f, logout: h, restart: m } = Hh(),
      { instance: g, reloadInstance: x } = ct();
    y.useEffect(() => {
      g &&
        (localStorage.setItem(jn.INSTANCE_ID, g.id),
        localStorage.setItem(jn.INSTANCE_NAME, g.name),
        localStorage.setItem(jn.INSTANCE_TOKEN, g.token));
    }, [g]);
    const b = async () => {
        await x();
      },
      w = async (R) => {
        try {
          (await m(R), await x());
        } catch (N) {
          console.error('Error:', N);
        }
      },
      C = async (R) => {
        try {
          (await h(R), await x());
        } catch (N) {
          console.error('Error:', N);
        }
      },
      k = async (R, N) => {
        try {
          if ((s(null), !u)) {
            console.error('Token not found.');
            return;
          }
          if (N) {
            const O = await f({ instanceName: R, token: u, number: g?.number });
            l(O.pairingCode);
          } else {
            const O = await f({ instanceName: R, token: u });
            s(O.code);
          }
        } catch (O) {
          console.error('Error:', O);
        }
      },
      j = async () => {
        (s(null), l(''), await x());
      },
      M = y.useMemo(
        () =>
          g
            ? { contacts: g._count?.Contact || 0, chats: g._count?.Chat || 0, messages: g._count?.Message || 0 }
            : { contacts: 0, chats: 0, messages: 0 },
        [g],
      ),
      _ = y.useMemo(() => (d === 'dark' ? '#fff' : d === 'light' ? '#000' : '#189d68'), [d]);
    return g
      ? i.jsxs('main', {
          className: 'flex flex-col gap-8',
          children: [
            i.jsx('section', {
              children: i.jsxs(So, {
                children: [
                  i.jsx(Co, {
                    children: i.jsxs('div', {
                      className: 'flex flex-wrap items-center justify-between gap-4',
                      children: [
                        i.jsx('h2', { className: 'break-all text-lg font-semibold', children: g.name }),
                        i.jsx(l_, { status: g.connectionStatus }),
                      ],
                    }),
                  }),
                  i.jsxs(Eo, {
                    className: 'flex flex-col items-start space-y-6',
                    children: [
                      i.jsx('div', { className: 'flex w-full flex-1', children: i.jsx(c_, { token: g.token }) }),
                      g.profileName &&
                        i.jsxs('div', {
                          className: 'flex flex-1 gap-2',
                          children: [
                            i.jsx(Ei, { children: i.jsx(ki, { src: g.profilePicUrl, alt: '' }) }),
                            i.jsxs('div', {
                              className: 'space-y-1',
                              children: [
                                i.jsx('strong', { children: g.profileName }),
                                i.jsx('p', {
                                  className: 'break-all text-sm text-muted-foreground',
                                  children: g.ownerJid,
                                }),
                              ],
                            }),
                          ],
                        }),
                      g.connectionStatus !== 'open' &&
                        i.jsxs(rI, {
                          variant: 'warning',
                          className: 'flex flex-wrap items-center justify-between gap-3',
                          children: [
                            i.jsx(sI, {
                              className: 'text-lg font-bold tracking-wide',
                              children: e('instance.dashboard.alert'),
                            }),
                            i.jsxs(Pt, {
                              children: [
                                i.jsx(Bt, {
                                  onClick: () => k(g.name, !1),
                                  asChild: !0,
                                  children: i.jsx(se, {
                                    variant: 'warning',
                                    children: e('instance.dashboard.button.qrcode.label'),
                                  }),
                                }),
                                i.jsxs(Nt, {
                                  onCloseAutoFocus: j,
                                  children: [
                                    i.jsx(Mt, { children: e('instance.dashboard.button.qrcode.title') }),
                                    i.jsx('div', {
                                      className: 'flex items-center justify-center',
                                      children:
                                        r &&
                                        i.jsx(MX, {
                                          value: r,
                                          size: 256,
                                          bgColor: 'transparent',
                                          fgColor: _,
                                          className: 'rounded-sm',
                                        }),
                                    }),
                                  ],
                                }),
                              ],
                            }),
                            g.number &&
                              i.jsxs(Pt, {
                                children: [
                                  i.jsx(Bt, {
                                    className: 'connect-code-button',
                                    onClick: () => k(g.name, !0),
                                    children: e('instance.dashboard.button.pairingCode.label'),
                                  }),
                                  i.jsx(Nt, {
                                    onCloseAutoFocus: j,
                                    children: i.jsx(Mt, {
                                      children: i.jsx(eo, {
                                        children: o
                                          ? i.jsxs('div', {
                                              className: 'py-3',
                                              children: [
                                                i.jsx('p', {
                                                  className: 'text-center',
                                                  children: i.jsx('strong', {
                                                    children: e('instance.dashboard.button.pairingCode.title'),
                                                  }),
                                                }),
                                                i.jsxs('p', {
                                                  className: 'pairing-code text-center',
                                                  children: [o.substring(0, 4), '-', o.substring(4, 8)],
                                                }),
                                              ],
                                            })
                                          : i.jsx(On, {}),
                                      }),
                                    }),
                                  }),
                                ],
                              }),
                          ],
                        }),
                    ],
                  }),
                  i.jsxs(Vh, {
                    className: 'flex flex-wrap items-center justify-end gap-3',
                    children: [
                      i.jsx(se, {
                        variant: 'outline',
                        className: 'refresh-button',
                        size: 'icon',
                        onClick: b,
                        children: i.jsx(Ip, { size: '20' }),
                      }),
                      i.jsx(se, {
                        className: 'action-button',
                        variant: 'secondary',
                        onClick: () => w(g.name),
                        children: e('instance.dashboard.button.restart').toUpperCase(),
                      }),
                      i.jsx(se, {
                        variant: 'destructive',
                        onClick: () => C(g.name),
                        disabled: g.connectionStatus === 'close',
                        children: e('instance.dashboard.button.disconnect').toUpperCase(),
                      }),
                    ],
                  }),
                ],
              }),
            }),
            i.jsxs('section', {
              className: 'grid grid-cols-[repeat(auto-fit,_minmax(15rem,_1fr))] gap-6',
              children: [
                i.jsxs(So, {
                  className: 'instance-card',
                  children: [
                    i.jsx(Co, {
                      children: i.jsxs(gi, {
                        className: 'flex items-center gap-2',
                        children: [i.jsx(pT, { size: '20' }), e('instance.dashboard.contacts')],
                      }),
                    }),
                    i.jsx(Eo, { children: n.format(M.contacts) }),
                  ],
                }),
                i.jsxs(So, {
                  className: 'instance-card',
                  children: [
                    i.jsx(Co, {
                      children: i.jsxs(gi, {
                        className: 'flex items-center gap-2',
                        children: [i.jsx(jB, { size: '20' }), e('instance.dashboard.chats')],
                      }),
                    }),
                    i.jsx(Eo, { children: n.format(M.chats) }),
                  ],
                }),
                i.jsxs(So, {
                  className: 'instance-card',
                  children: [
                    i.jsx(Co, {
                      children: i.jsxs(gi, {
                        className: 'flex items-center gap-2',
                        children: [i.jsx(Bl, { size: '20' }), e('instance.dashboard.messages')],
                      }),
                    }),
                    i.jsx(Eo, { children: n.format(M.messages) }),
                  ],
                }),
              ],
            }),
          ],
        })
      : i.jsx(On, {});
  }
