const VM = ({ children: e }) => {
      const t = ls(),
        [n, r] = y.useState(null),
        { data: s, refetch: o } = vT({ instanceId: n });
      return (
        y.useEffect(() => {
          t.instanceId ? r(t.instanceId) : r(null);
        }, [t]),
        i.jsx(UM.Provider, {
          value: {
            instance: s ?? null,
            reloadInstance: async () => {
              await o();
            },
          },
          children: e,
        })
      );
    };
