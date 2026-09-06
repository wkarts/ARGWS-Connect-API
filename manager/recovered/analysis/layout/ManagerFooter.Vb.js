function Vb() {
    const { t: e } = Ve(),
      t = dr(jn.API_URL),
      { data: n } = n$({ url: t }),
      r = y.useMemo(() => n?.clientName, [n]),
      s = y.useMemo(() => n?.version, [n]),
      o = [
        { name: 'Discord', url: 'https://github.com/wkarts/argws-connect-api' },
        { name: 'Postman', url: 'https://github.com/wkarts/argws-connect-api' },
        { name: 'GitHub', url: 'https://github.com/wkarts/argws-connect-api' },
        { name: 'Docs', url: 'https://github.com/wkarts/argws-connect-api' },
      ];
    return i.jsxs('footer', {
      className: 'flex w-full flex-col items-center justify-between p-6 text-xs text-secondary-foreground sm:flex-row',
      children: [
        i.jsxs('div', {
          className: 'flex items-center space-x-3 divide-x',
          children: [
            r && r !== '' && i.jsx('span', { children: i.jsx('strong', { children: r }) }),
            s &&
              s !== '' &&
              i.jsxs('span', {
                className: 'pl-3',
                children: [e('footer.version'), ': ', i.jsx('strong', { children: s })],
              }),
          ],
        }),
        i.jsx('div', {
          className: 'flex gap-2',
          children: o.map((l) =>
            i.jsx(
              se,
              {
                variant: 'link',
                asChild: !0,
                size: 'sm',
                className: 'text-xs',
                children: i.jsx('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer', children: l.name }),
              },
              l.url,
            ),
          ),
        }),
      ],
    });
  }
