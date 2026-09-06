function l_({ status: e }) {
    const { t } = Ve();
    return e
      ? e === 'open'
        ? i.jsx(vu, { children: t('status.open') })
        : e === 'connecting'
          ? i.jsx(vu, { variant: 'warning', children: t('status.connecting') })
          : e === 'close' || e === 'closed'
            ? i.jsx(vu, { variant: 'destructive', children: t('status.closed') })
            : i.jsx(vu, { variant: 'secondary', children: e })
      : null;
  }
