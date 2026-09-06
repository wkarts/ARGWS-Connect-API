function un({ children: e }) {
    const { instanceId: t } = ls();
    return i.jsx(VM, {
      children: i.jsxs('div', {
        className: 'flex h-screen flex-col',
        children: [
          i.jsx(zM, { instanceId: t }),
          i.jsxs('div', {
            className: 'flex min-h-[calc(100vh_-_56px)] flex-1 flex-col md:flex-row',
            children: [
              i.jsx(Wy, {
                className: 'mr-2 py-6 md:w-64',
                children: i.jsx('div', { className: 'flex h-full', children: i.jsx(j5, {}) }),
              }),
              i.jsx(Wy, {
                className: 'w-full',
                children: i.jsxs('div', {
                  className: 'flex h-full flex-col',
                  children: [
                    i.jsx('div', { className: 'my-2 flex flex-1 flex-col gap-2 pl-2 pr-4', children: e }),
                    i.jsx(Vb, {}),
                  ],
                }),
              }),
            ],
          }),
        ],
      }),
    });
  }
