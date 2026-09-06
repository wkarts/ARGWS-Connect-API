function c_({ token: e, className: t }) {
    const [n, r] = y.useState(!1);
    return i.jsxs('div', {
      className: Ie('flex items-center gap-3 truncate rounded-sm bg-primary/20 px-2 py-1', t),
      children: [
        i.jsx('pre', { className: 'block truncate text-xs', children: n ? e : e?.replace(/\w/g, '*') }),
        i.jsx(se, {
          variant: 'ghost',
          size: 'icon',
          onClick: () => {
            U5(e);
          },
          children: i.jsx(X$, { size: '15' }),
        }),
        i.jsx(se, {
          variant: 'ghost',
          size: 'icon',
          onClick: () => {
            r((s) => !s);
          },
          children: n ? i.jsx(tB, { size: '15' }) : i.jsx(nB, { size: '15' }),
        }),
      ],
    });
  }
