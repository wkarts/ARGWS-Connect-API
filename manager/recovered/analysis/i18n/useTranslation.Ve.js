const Ve = (e, t = {}) => {
      const { i18n: n } = t,
        { i18n: r, defaultNS: s } = y.useContext(sj) || {},
        o = n || r || jF();
      if ((o && !o.reportNamespaces && (o.reportNamespaces = new NF()), !o)) {
        jy('You will need to pass in an i18next instance by using initReactI18next');
        const _ = (N, O) =>
            fi(O) ? O : yF(O) && fi(O.defaultValue) ? O.defaultValue : Array.isArray(N) ? N[N.length - 1] : N,
          R = [_, {}, !1];
        return ((R.t = _), (R.i18n = {}), (R.ready = !1), R);
      }
      o.options.react?.wait &&
        jy('It seems you are still using the old wait option, you may migrate to the new useSuspense behaviour.');
      const l = { ...EF(), ...o.options.react, ...t },
        { useSuspense: u, keyPrefix: d } = l;
      let f = s || o.options?.defaultNS;
      ((f = fi(f) ? [f] : f || ['translation']), o.reportNamespaces.addUsedNamespaces?.(f));
      const h = (o.isInitialized || o.initializedStoreOnce) && f.every((_) => vF(_, o, l)),
        m = _F(o, t.lng || null, l.nsMode === 'fallback' ? f : f[0], d),
        g = () => m,
        x = () => oj(o, t.lng || null, l.nsMode === 'fallback' ? f : f[0], d),
        [b, w] = y.useState(g);
      let C = f.join();
      t.lng && (C = `${t.lng}${C}`);
      const k = MF(C),
        j = y.useRef(!0);
      (y.useEffect(() => {
        const { bindI18n: _, bindI18nStore: R } = l;
        ((j.current = !0),
          !h &&
            !u &&
            (t.lng
              ? X0(o, t.lng, f, () => {
                  j.current && w(x);
                })
              : Y0(o, f, () => {
                  j.current && w(x);
                })),
          h && k && k !== C && j.current && w(x));
        const N = () => {
          j.current && w(x);
        };
        return (
          _ && o?.on(_, N),
          R && o?.store.on(R, N),
          () => {
            ((j.current = !1),
              o && _?.split(' ').forEach((O) => o.off(O, N)),
              R && o && R.split(' ').forEach((O) => o.store.off(O, N)));
          }
        );
      }, [o, C]),
        y.useEffect(() => {
          j.current && h && w(g);
        }, [o, d, h]));
      const M = [b, o, h];
      if (((M.t = b), (M.i18n = o), (M.ready = h), h || (!h && !u))) return M;
      throw new Promise((_) => {
        t.lng ? X0(o, t.lng, f, () => _()) : Y0(o, f, () => _());
      });
    };
