function j5() {
    const { t: e } = Ve(),
      t = y.useMemo(
        () => [
          { id: 'dashboard', title: e('sidebar.dashboard'), icon: pB, path: 'dashboard' },
          { id: 'chat', title: e('sidebar.chat'), icon: Bl, path: 'chat' },
          {
            navLabel: !0,
            title: e('sidebar.configurations'),
            icon: Oo,
            children: [
              { id: 'settings', title: e('sidebar.settings'), path: 'settings' },
              { id: 'proxy', title: e('sidebar.proxy'), path: 'proxy' },
            ],
          },
          {
            title: e('sidebar.events'),
            icon: dB,
            children: [
              { id: 'webhook', title: e('sidebar.webhook'), path: 'webhook' },
              { id: 'websocket', title: e('sidebar.websocket'), path: 'websocket' },
              { id: 'rabbitmq', title: e('sidebar.rabbitmq'), path: 'rabbitmq' },
              { id: 'sqs', title: e('sidebar.sqs'), path: 'sqs' },
            ],
          },
          {
            title: e('sidebar.integrations'),
            icon: mT,
            children: [
              { id: 'connectAI', title: e('sidebar.connectAI'), path: 'connectAI' },
              { id: 'n8n', title: e('sidebar.n8n'), path: 'n8n' },
              { id: 'connectBot', title: e('sidebar.connectBot'), path: 'connectBot' },
              { id: 'chatwoot', title: e('sidebar.chatwoot'), path: 'chatwoot' },
              { id: 'typebot', title: e('sidebar.typebot'), path: 'typebot' },
              { id: 'openai', title: e('sidebar.openai'), path: 'openai' },
              { id: 'dify', title: e('sidebar.dify'), path: 'dify' },
              { id: 'flowise', title: e('sidebar.flowise'), path: 'flowise' },
            ],
          },
          {
            id: 'documentation',
            title: e('sidebar.documentation'),
            icon: sB,
            link: 'https://github.com/wkarts/argws-connect-api',
            divider: !0,
          },
          { id: 'postman', title: e('sidebar.postman'), icon: Q$, link: 'https://github.com/wkarts/argws-connect-api' },
          { id: 'discord', title: e('sidebar.discord'), icon: Bl, link: 'https://github.com/wkarts/argws-connect-api' },
          {
            id: 'support-premium',
            title: e('sidebar.supportPremium'),
            icon: hB,
            link: 'https://github.com/wkarts/argws-connect-api/issues',
          },
        ],
        [e],
      ),
      n = dn(),
      { pathname: r } = Pi(),
      { instance: s } = ct(),
      o = (u) => {
        !u || !s || (u.path && n(`/manager/instance/${s.id}/${u.path}`), u.link && window.open(u.link, '_blank'));
      },
      l = y.useMemo(
        () =>
          t
            .map((u) => ({
              ...u,
              children:
                'children' in u
                  ? u.children?.map((d) => ({ ...d, isActive: 'path' in d ? r.includes(d.path) : !1 }))
                  : void 0,
              isActive: 'path' in u && u.path ? r.includes(u.path) : !1,
            }))
            .map((u) => ({ ...u, isActive: u.isActive || ('children' in u && u.children?.some((d) => d.isActive)) })),
        [t, r],
      );
    return i.jsx('ul', {
      className: 'flex h-full w-full flex-col gap-2 border-r border-border px-2',
      children: l.map((u) =>
        i.jsx(
          'li',
          {
            className: 'divider' in u ? 'mt-auto' : void 0,
            children: u.children
              ? i.jsxs(C5, {
                  defaultOpen: u.isActive,
                  children: [
                    i.jsx(E5, {
                      asChild: !0,
                      children: i.jsxs(se, {
                        className: Ie('flex w-full items-center justify-start gap-2'),
                        variant: u.isActive ? 'secondary' : 'link',
                        children: [
                          u.icon && i.jsx(u.icon, { size: '15' }),
                          i.jsx('span', { children: u.title }),
                          i.jsx(Nh, { size: '15', className: 'ml-auto' }),
                        ],
                      }),
                    }),
                    i.jsx(k5, {
                      children: i.jsx('ul', {
                        className: 'my-4 ml-6 flex flex-col gap-2 text-sm',
                        children: u.children.map((d) =>
                          i.jsx(
                            'li',
                            {
                              children: i.jsx('button', {
                                onClick: () => o(d),
                                className: Ie(d.isActive ? 'text-foreground' : 'text-muted-foreground'),
                                children: i.jsx('span', { className: 'nav-label', children: d.title }),
                              }),
                            },
                            d.id,
                          ),
                        ),
                      }),
                    }),
                  ],
                })
              : i.jsxs(se, {
                  className: Ie(
                    'relative flex w-full items-center justify-start gap-2',
                    u.isActive && 'pointer-events-none',
                  ),
                  variant: u.isActive ? 'secondary' : 'link',
                  children: [
                    'link' in u &&
                      i.jsx('a', {
                        href: u.link,
                        target: '_blank',
                        rel: 'noreferrer',
                        className: 'absolute inset-0 h-full w-full',
                      }),
                    'path' in u &&
                      i.jsx(Fu, {
                        to: `/manager/instance/${s?.id}/${u.path}`,
                        className: 'absolute inset-0 h-full w-full',
                      }),
                    u.icon && i.jsx(u.icon, { size: '15' }),
                    i.jsx('span', { children: u.title }),
                  ],
                }),
          },
          u.title,
        ),
      ),
    });
  }
