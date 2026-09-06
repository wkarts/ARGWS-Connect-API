function dQ({ resetTable: e }) {
    const { t } = Ve(),
      { createInstance: n } = Hh(),
      [r, s] = y.useState(!1),
      o = [
        { value: 'WHATSAPP-BAILEYS', label: t('instance.form.integration.baileys') },
        { value: 'WHATSAPP-BUSINESS', label: t('instance.form.integration.whatsapp') },
        { value: 'CONNECT', label: t('instance.form.integration.connect') },
      ],
      l = on({
        resolver: an(uQ),
        defaultValues: {
          name: '',
          integration: 'WHATSAPP-BAILEYS',
          token: E1().replace('-', '').toUpperCase(),
          number: '',
          businessId: '',
        },
      }),
      u = l.watch('integration'),
      d = async (h) => {
        try {
          const m = {
            instanceName: h.name,
            integration: h.integration,
            token: h.token === '' ? null : h.token,
            number: h.number === '' ? null : h.number,
            businessId: h.businessId === '' ? null : h.businessId,
          };
          (await n(m), me.success(t('toast.instance.created')), s(!1), f(), e());
        } catch (m) {
          (console.error('Error:', m), me.error(`Error : ${m?.response?.data?.response?.message}`));
        }
      },
      f = () => {
        l.reset({
          name: '',
          integration: 'WHATSAPP-BAILEYS',
          token: E1().replace('-', '').toLocaleUpperCase(),
          number: '',
          businessId: '',
        });
      };
    return i.jsxs(Pt, {
      open: r,
      onOpenChange: s,
      children: [
        i.jsx(Bt, {
          asChild: !0,
          children: i.jsxs(se, {
            variant: 'default',
            size: 'sm',
            children: [t('instance.button.create'), ' ', i.jsx(cs, { size: '18' })],
          }),
        }),
        i.jsxs(Nt, {
          className: 'sm:max-w-[650px]',
          onCloseAutoFocus: f,
          children: [
            i.jsx(Mt, { children: i.jsx(zt, { children: t('instance.modal.title') }) }),
            i.jsx(Gn, {
              ...l,
              children: i.jsxs('form', {
                onSubmit: l.handleSubmit(d),
                className: 'grid gap-4 py-4',
                children: [
                  i.jsx(le, { required: !0, name: 'name', label: t('instance.form.name'), children: i.jsx(ne, {}) }),
                  i.jsx(Jt, { name: 'integration', label: t('instance.form.integration.label'), options: o }),
                  i.jsx(le, { required: !0, name: 'token', label: t('instance.form.token'), children: i.jsx(ne, {}) }),
                  i.jsx(le, { name: 'number', label: t('instance.form.number'), children: i.jsx(ne, { type: 'tel' }) }),
                  u === 'WHATSAPP-BUSINESS' &&
                    i.jsx(le, {
                      required: !0,
                      name: 'businessId',
                      label: t('instance.form.businessId'),
                      children: i.jsx(ne, {}),
                    }),
                  i.jsx(Yt, { children: i.jsx(se, { type: 'submit', children: t('instance.button.save') }) }),
                ],
              }),
            }),
          ],
        }),
      ],
    });
  }
