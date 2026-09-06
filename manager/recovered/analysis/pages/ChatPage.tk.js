function tk() {
    const e = zo('(min-width: 768px)'),
      t = y.useRef(null),
      [n] = y.useState('auto'),
      r = y.useRef(null),
      { instance: s } = ct(),
      [o, l] = y.useState([]),
      { data: u, isSuccess: d } = sY({ instanceName: s?.name }),
      f = qe.useMemo(() => {
        if (!u) return o;
        const C = new Map();
        return (
          u.forEach((k) => C.set(k.remoteJid, k)),
          o.forEach((k) => {
            const j = C.get(k.remoteJid);
            j ? C.set(k.remoteJid, { ...j, ...k }) : C.set(k.remoteJid, k);
          }),
          Array.from(C.values())
        );
      }, [u, o]),
      { instanceId: h, remoteJid: m } = ls(),
      g = dn();
    y.useEffect(() => {
      if (!s?.name) return;
      const C = dr(jn.API_URL);
      if (!C) {
        console.error('API URL not found in localStorage');
        return;
      }
      const k = sw(C, dr(jn.TOKEN) || s?.token),
        j = (M, _) => {
          if (!s || _.instance !== s.name) return;
          const R = _?.data?.key?.remoteJid;
          R &&
            l((N) => {
              const O = N.findIndex((z) => z.remoteJid === R),
                D = {
                  id: R,
                  remoteJid: R,
                  pushName: _?.data?.pushName || dX(R),
                  profilePicUrl: _?.data?.key?.profilePictureUrl || '',
                  ..._?.data,
                };
              if (O !== -1) {
                const z = [...N];
                return ((z[O] = { ...z[O], ...D }), z);
              } else return [...N, D];
            });
        };
      return (
        k.on('messages.upsert', (M) => {
          j('messages.upsert', M);
        }),
        k.on('send.message', (M) => {
          j('send.message', M);
        }),
        k.connect(),
        () => {
          (k.off('messages.upsert'), k.off('send.message'), ow(k));
        }
      );
    }, [s?.name]);
    const x = y.useCallback(() => {
        t.current && t.current.scrollIntoView({});
      }, []),
      b = () => {
        if (r.current) {
          r.current.style.height = 'auto';
          const C = r.current.scrollHeight,
            j = parseInt(getComputedStyle(r.current).lineHeight) * 10;
          r.current.style.height = `${Math.min(C, j)}px`;
        }
      };
    y.useEffect(() => {
      d && x();
    }, [d, x]);
    const w = (C) => {
      g(`/manager/instance/${h}/chat/${C}`);
    };
    return i.jsx('div', {
      className: 'h-[calc(100vh-160px)] overflow-hidden',
      children: i.jsxs($o, {
        direction: e ? 'horizontal' : 'vertical',
        className: 'h-full',
        children: [
          i.jsx(Hn, {
            defaultSize: 20,
            children: i.jsxs('div', {
              className: 'hidden h-full flex-col bg-background text-foreground md:flex',
              children: [
                i.jsx('div', {
                  className: 'flex-shrink-0 p-2',
                  children: i.jsxs(se, {
                    variant: 'ghost',
                    className: 'w-full justify-start gap-2 px-2 text-left',
                    children: [
                      i.jsx('div', {
                        className: 'flex h-7 w-7 items-center justify-center rounded-full',
                        children: i.jsx(Bl, { className: 'h-4 w-4' }),
                      }),
                      i.jsx('div', {
                        className: 'grow overflow-hidden text-ellipsis whitespace-nowrap text-sm',
                        children: 'Chat',
                      }),
                      i.jsx(cs, { className: 'h-4 w-4' }),
                    ],
                  }),
                }),
                i.jsxs(Yx, {
                  defaultValue: 'contacts',
                  className: 'flex flex-col flex-1 min-h-0',
                  children: [
                    i.jsxs(hg, {
                      className: 'tabs-chat flex-shrink-0',
                      children: [
                        i.jsx(Jl, { value: 'contacts', children: 'Contatos' }),
                        i.jsx(Jl, { value: 'groups', children: 'Grupos' }),
                      ],
                    }),
                    i.jsx(Ql, {
                      value: 'contacts',
                      className: 'flex-1 overflow-hidden',
                      children: i.jsx('div', {
                        className: 'h-full overflow-auto',
                        children: i.jsxs('div', {
                          className: 'grid gap-1 p-2 text-foreground',
                          children: [
                            i.jsx('div', {
                              className: 'px-2 text-xs font-medium text-muted-foreground',
                              children: 'Contatos',
                            }),
                            u?.map(
                              (C) =>
                                C.remoteJid.includes('@s.whatsapp.net') &&
                                i.jsxs(
                                  Fu,
                                  {
                                    to: '#',
                                    onClick: () => w(C.remoteJid),
                                    className: `chat-item flex items-center overflow-hidden truncate whitespace-nowrap rounded-md border-b border-gray-600/50 p-2 text-sm transition-colors hover:bg-muted/50 ${m === C.remoteJid ? 'active' : ''}`,
                                    children: [
                                      i.jsx('span', {
                                        className: 'chat-avatar mr-2',
                                        children: i.jsxs(Ei, {
                                          className: 'h-8 w-8',
                                          children: [
                                            i.jsx(ki, {
                                              src: C.profilePicUrl,
                                              alt: C.pushName || C.remoteJid.split('@')[0],
                                            }),
                                            i.jsx(Up, {
                                              className: 'bg-slate-700 text-slate-300 border border-slate-600',
                                              children: i.jsx(Ap, { className: 'h-5 w-5' }),
                                            }),
                                          ],
                                        }),
                                      }),
                                      i.jsxs('div', {
                                        className: 'min-w-0 flex-1',
                                        children: [
                                          i.jsx('span', {
                                            className: 'chat-title block font-medium',
                                            children: C.pushName || C.remoteJid.split('@')[0],
                                          }),
                                          i.jsx('span', {
                                            className: 'chat-description block text-xs text-gray-500',
                                            children: C.remoteJid.split('@')[0],
                                          }),
                                        ],
                                      }),
                                    ],
                                  },
                                  C.id,
                                ),
                            ),
                          ],
                        }),
                      }),
                    }),
                    i.jsx(Ql, {
                      value: 'groups',
                      className: 'flex-1 overflow-hidden',
                      children: i.jsx('div', {
                        className: 'h-full overflow-auto',
                        children: i.jsx('div', {
                          className: 'grid gap-1 p-2 text-foreground',
                          children: f?.map(
                            (C) =>
                              C.remoteJid.includes('@g.us') &&
                              i.jsxs(
                                Fu,
                                {
                                  to: '#',
                                  onClick: () => w(C.remoteJid),
                                  className: `chat-item flex items-center overflow-hidden truncate whitespace-nowrap rounded-md border-b border-gray-600/50 p-2 text-sm transition-colors hover:bg-muted/50 ${m === C.remoteJid ? 'active' : ''}`,
                                  children: [
                                    i.jsx('span', {
                                      className: 'chat-avatar mr-2',
                                      children: i.jsxs(Ei, {
                                        className: 'h-8 w-8',
                                        children: [
                                          i.jsx(ki, {
                                            src: C.profilePicUrl,
                                            alt: C.pushName || C.remoteJid.split('@')[0],
                                          }),
                                          i.jsx(Up, {
                                            className: 'bg-slate-700 text-slate-300 border border-slate-600',
                                            children: i.jsx(Ap, { className: 'h-5 w-5' }),
                                          }),
                                        ],
                                      }),
                                    }),
                                    i.jsxs('div', {
                                      className: 'min-w-0 flex-1',
                                      children: [
                                        i.jsx('span', {
                                          className: 'chat-title block font-medium',
                                          children: C.pushName || C.remoteJid.split('@')[0],
                                        }),
                                        i.jsx('span', {
                                          className: 'chat-description block text-xs text-gray-500',
                                          children: C.remoteJid,
                                        }),
                                      ],
                                    }),
                                  ],
                                },
                                C.id,
                              ),
                          ),
                        }),
                      }),
                    }),
                  ],
                }),
              ],
            }),
          }),
          i.jsx(Bo, { withHandle: !0, className: 'border border-black' }),
          i.jsx(Hn, {
            children:
              m &&
              i.jsx(ZO, {
                textareaRef: r,
                handleTextareaChange: b,
                textareaHeight: n,
                lastMessageRef: t,
                scrollToBottom: x,
              }),
          }),
        ],
      }),
    });
  }
