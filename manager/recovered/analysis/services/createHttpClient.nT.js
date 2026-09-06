function nT(e) {
    const t = new hi(e),
      n = Oj(hi.prototype.request, t);
    return (
      ce.extend(n, hi.prototype, t, { allOwnKeys: !0 }),
      ce.extend(n, t, null, { allOwnKeys: !0 }),
      (n.create = function (s) {
        return nT(Si(e, s));
      }),
      n
    );
  }
