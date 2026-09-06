function lM() {
    const { t: e } = Ve(),
      { setTheme: t } = tc();
    return i.jsxs(Kr, {
      children: [
        i.jsx(Wr, {
          asChild: !0,
          children: i.jsxs(se, {
            variant: 'outline',
            size: 'icon',
            children: [
              i.jsx(EB, {
                className: 'h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0',
              }),
              i.jsx(bB, {
                className:
                  'absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100',
              }),
              i.jsx('span', { className: 'sr-only', children: e('header.theme.label') }),
            ],
          }),
        }),
        i.jsxs(hr, {
          align: 'end',
          children: [
            i.jsx(wt, { onClick: () => t('light'), children: e('header.theme.light') }),
            i.jsx(wt, { onClick: () => t('dark'), children: e('header.theme.dark') }),
            i.jsx(wt, { onClick: () => t('system'), children: e('header.theme.system') }),
          ],
        }),
      ],
    });
  }
