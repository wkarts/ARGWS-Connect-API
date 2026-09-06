function Fse() {
    const e = dn(),
      { theme: t } = tc(),
      n = () => {
        e('/manager');
      };
    return i.jsxs('div', {
      className: 'min-h-screen bg-background',
      children: [
        i.jsxs('header', {
          className: 'flex items-center justify-between px-4 py-2',
          children: [
            i.jsx('div', {
              className: 'flex items-center',
              children: i.jsx('img', {
                src:
                  t === 'dark'
                    ? '/assets/images/argws-connect-logo-dark.svg'
                    : '/assets/images/argws-connect-logo-horizontal.svg',
                alt: 'Connect|API',
                className: 'h-8',
              }),
            }),
            i.jsxs('div', { className: 'flex items-center gap-4', children: [i.jsx(iM, {}), i.jsx(lM, {})] }),
          ],
        }),
        i.jsx('div', {
          className: 'container mx-auto px-4 py-16',
          children: i.jsxs('div', {
            className: 'max-w-4xl mx-auto',
            children: [
              i.jsxs('div', {
                className: 'text-center mb-12',
                children: [
                  i.jsx('div', {
                    className: 'flex items-center justify-center mb-6',
                    children: i.jsx('img', {
                      src:
                        t === 'dark'
                          ? '/assets/images/argws-connect-logo-dark.svg'
                          : '/assets/images/argws-connect-logo-horizontal.svg',
                      alt: 'Connect|API Logo',
                      className: 'h-10',
                    }),
                  }),
                  i.jsx('h1', { className: 'text-4xl font-bold text-foreground mb-4', children: 'Connect|API' }),
                  i.jsx('p', {
                    className: 'text-xl text-muted-foreground mb-6',
                    children: 'Modern web interface for Connect|API management',
                  }),
                  i.jsx(vu, { variant: 'secondary', className: 'text-sm px-3 py-1', children: 'Version 2.0.0' }),
                ],
              }),
              i.jsxs(So, {
                className: 'mb-8',
                children: [
                  i.jsxs(Co, {
                    children: [
                      i.jsxs(gi, {
                        className: 'flex items-center gap-2',
                        children: [i.jsx(xB, { className: 'w-5 h-5 text-primary' }), 'Welcome to Connect|API'],
                      }),
                      i.jsx(Kp, {
                        children:
                          'A powerful, modern dashboard for managing your WhatsApp API instances with Connect|API',
                      }),
                    ],
                  }),
                  i.jsx(Eo, {
                    className: 'space-y-6',
                    children: i.jsx('div', {
                      className: 'pt-6 border-t border-border',
                      children: i.jsx('div', {
                        className: 'flex flex-col sm:flex-row gap-4 justify-center items-center',
                        children: i.jsxs(se, {
                          onClick: n,
                          size: 'lg',
                          className: 'px-8 py-3',
                          children: ['Access Manager Dashboard', i.jsx(Th, { className: 'w-4 h-4 ml-2' })],
                        }),
                      }),
                    }),
                  }),
                ],
              }),
              i.jsxs(So, {
                children: [
                  i.jsxs(Co, {
                    children: [
                      i.jsx(gi, { children: 'Resources & Support' }),
                      i.jsx(Kp, { children: 'Get help, contribute, or learn more about Connect|API' }),
                    ],
                  }),
                  i.jsx(Eo, {
                    children: i.jsxs('div', {
                      className: 'grid md:grid-cols-3 gap-4',
                      children: [
                        i.jsxs('a', {
                          href: 'https://github.com/wkarts/argws-connect-manager-v2',
                          target: '_blank',
                          rel: 'noopener noreferrer',
                          className:
                            'flex items-center gap-3 p-4 rounded-lg border border-border hover:bg-accent transition-colors',
                          children: [
                            i.jsx(aB, { className: 'w-5 h-5 text-muted-foreground' }),
                            i.jsxs('div', {
                              children: [
                                i.jsx('div', { className: 'font-medium text-foreground', children: 'GitHub' }),
                                i.jsx('div', { className: 'text-sm text-muted-foreground', children: 'Source code' }),
                              ],
                            }),
                          ],
                        }),
                        i.jsxs('a', {
                          href: 'https://github.com/wkarts/argws-connect-api',
                          target: '_blank',
                          rel: 'noopener noreferrer',
                          className:
                            'flex items-center gap-3 p-4 rounded-lg border border-border hover:bg-accent transition-colors',
                          children: [
                            i.jsx(iB, { className: 'w-5 h-5 text-muted-foreground' }),
                            i.jsxs('div', {
                              children: [
                                i.jsx('div', { className: 'font-medium text-foreground', children: 'Website' }),
                                i.jsx('div', { className: 'text-sm text-muted-foreground', children: 'Official site' }),
                              ],
                            }),
                          ],
                        }),
                        i.jsxs('a', {
                          href: 'mailto:contato@argws-connect-api.com',
                          className:
                            'flex items-center gap-3 p-4 rounded-lg border border-border hover:bg-accent transition-colors',
                          children: [
                            i.jsx(vB, { className: 'w-5 h-5 text-muted-foreground' }),
                            i.jsxs('div', {
                              children: [
                                i.jsx('div', { className: 'font-medium text-foreground', children: 'Contact' }),
                                i.jsx('div', { className: 'text-sm text-muted-foreground', children: 'Get support' }),
                              ],
                            }),
                          ],
                        }),
                      ],
                    }),
                  }),
                ],
              }),
              i.jsx('div', {
                className: 'text-center mt-12 text-sm text-muted-foreground',
                children: i.jsx('p', {
                  children: '© 2025 Connect|API. Licensed under Apache 2.0 with Connect|API custom conditions.',
                }),
              }),
            ],
          }),
        }),
      ],
    });
  }
