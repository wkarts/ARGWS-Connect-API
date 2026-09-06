function xk() {
    const { t: e } = Ve(),
      t = zo('(min-width: 768px)'),
      { instance: n } = ct(),
      { difyId: r } = ls(),
      { data: s, refetch: o, isLoading: l } = iI({ instanceName: n?.name }),
      u = dn(),
      d = (h) => {
        n && u(`/manager/instance/${n.id}/dify/${h}`);
      },
      f = () => {
        o();
      };
    return i.jsxs('main', {
      className: 'pt-5',
      children: [
        i.jsxs('div', {
          className: 'mb-1 flex items-center justify-between',
          children: [
            i.jsx('h3', { className: 'text-lg font-medium', children: e('dify.title') }),
            i.jsxs('div', {
              className: 'flex items-center justify-end gap-2',
              children: [i.jsx(SI, {}), i.jsx(WX, {}), i.jsx(Jee, { resetTable: f })],
            }),
          ],
        }),
        i.jsx($t, { className: 'my-4' }),
        i.jsxs($o, {
          direction: t ? 'horizontal' : 'vertical',
          children: [
            i.jsx(Hn, {
              defaultSize: 35,
              className: 'pr-4',
              children: i.jsx('div', {
                className: 'flex flex-col gap-3',
                children: l
                  ? i.jsx(On, {})
                  : i.jsx(i.Fragment, {
                      children:
                        s && s.length > 0 && Array.isArray(s)
                          ? s.map((h) =>
                              i.jsxs(
                                se,
                                {
                                  className: 'flex h-auto flex-col items-start justify-start',
                                  onClick: () => d(`${h.id}`),
                                  variant: r === h.id ? 'secondary' : 'outline',
                                  children: [
                                    i.jsx('h4', { className: 'text-base', children: h.description || h.id }),
                                    i.jsx('p', {
                                      className: 'text-sm font-normal text-muted-foreground',
                                      children: h.botType,
                                    }),
                                  ],
                                },
                                h.id,
                              ),
                            )
                          : i.jsx(se, { variant: 'link', children: e('dify.table.none') }),
                    }),
              }),
            }),
            r &&
              i.jsxs(i.Fragment, {
                children: [
                  i.jsx(Bo, { withHandle: !0, className: 'border border-border' }),
                  i.jsx(Hn, { children: i.jsx(Xee, { difyId: r, resetTable: f }) }),
                ],
              }),
          ],
        }),
      ],
    });
  }
