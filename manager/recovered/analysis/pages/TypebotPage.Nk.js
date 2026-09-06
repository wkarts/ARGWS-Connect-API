function Nk() {
    const { t: e } = Ve(),
      t = zo('(min-width: 768px)'),
      { instance: n } = ct(),
      { typebotId: r } = ls(),
      { data: s, isLoading: o, refetch: l } = zI({ instanceName: n?.name, token: n?.token }),
      u = dn(),
      d = (h) => {
        n && u(`/manager/instance/${n.id}/typebot/${h}`);
      },
      f = () => {
        l();
      };
    return i.jsxs('main', {
      className: 'pt-5',
      children: [
        i.jsxs('div', {
          className: 'mb-1 flex items-center justify-between',
          children: [
            i.jsx('h3', { className: 'text-lg font-medium', children: e('typebot.title') }),
            i.jsxs('div', {
              className: 'flex flex-wrap items-center justify-end gap-2',
              children: [i.jsx(UI, {}), i.jsx(use, {}), i.jsx(gse, { resetTable: f })],
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
                children: o
                  ? i.jsx(On, {})
                  : i.jsx(i.Fragment, {
                      children:
                        s && s.length > 0 && Array.isArray(s)
                          ? s.map((h) =>
                              i.jsx(
                                se,
                                {
                                  className: 'flex h-auto flex-col items-start justify-start',
                                  onClick: () => d(`${h.id}`),
                                  variant: r === h.id ? 'secondary' : 'outline',
                                  children: h.description
                                    ? i.jsxs(i.Fragment, {
                                        children: [
                                          i.jsx('h4', { className: 'text-base', children: h.description }),
                                          i.jsxs('p', {
                                            className: 'text-wrap text-sm font-normal text-muted-foreground',
                                            children: [h.url, ' - ', h.typebot],
                                          }),
                                        ],
                                      })
                                    : i.jsxs(i.Fragment, {
                                        children: [
                                          i.jsx('h4', { className: 'text-base', children: h.url }),
                                          i.jsx('p', {
                                            className: 'text-wrap text-sm font-normal text-muted-foreground',
                                            children: h.typebot,
                                          }),
                                        ],
                                      }),
                                },
                                h.id,
                              ),
                            )
                          : i.jsx(se, { variant: 'link', children: e('typebot.table.none') }),
                    }),
              }),
            }),
            r &&
              i.jsxs(i.Fragment, {
                children: [
                  i.jsx(Bo, { withHandle: !0, className: 'border border-black' }),
                  i.jsx(Hn, { children: i.jsx(bse, { typebotId: r, resetTable: f }) }),
                ],
              }),
          ],
        }),
      ],
    });
  }
