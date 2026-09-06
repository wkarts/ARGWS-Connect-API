const vT = (e) => {
      const { instanceId: t, ...n } = e;
      return mt({ ...n, queryKey: NB({ instanceId: t }), queryFn: () => MB({ instanceId: t }), enabled: !!t });
    };
