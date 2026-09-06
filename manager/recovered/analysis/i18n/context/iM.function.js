function iM() {
    const { t: e, i18n: t } = Ve(),
      n = (r) => {
        (t.changeLanguage(r), localStorage.setItem('i18nextLng', r), window.location.reload());
      };
    return i.jsxs(Kr, {
      children: [
        i.jsx(Wr, {
          asChild: !0,
          children: i.jsxs(se, {
            variant: 'outline',
            size: 'icon',
            children: [
              i.jsx(fB, { className: 'h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all' }),
              i.jsx('span', { className: 'sr-only', children: e('header.theme.label') }),
            ],
          }),
        }),
        i.jsxs(hr, {
          align: 'end',
          children: [
            i.jsx(wt, {
              className: t.language === 'pt-BR' ? 'font-bold' : '',
              onClick: () => n('pt-BR'),
              children: e('header.language.portuguese'),
            }),
            i.jsx(wt, {
              className: t.language === 'en-US' ? 'font-bold' : '',
              onClick: () => n('en-US'),
              children: e('header.language.english'),
            }),
            i.jsx(wt, {
              className: t.language === 'es-ES' ? 'font-bold' : '',
              onClick: () => n('es-ES'),
              children: e('header.language.spanish'),
            }),
            i.jsx(wt, {
              className: t.language === 'fr-FR' ? 'font-bold' : '',
              onClick: () => n('fr-FR'),
              children: e('header.language.french'),
            }),
          ],
        }),
      ],
    });
  }
