function nt(e, t) {
    const n = Ob(),
      r = cF({ mutationFn: e });
    return (s, o) =>
      r.mutateAsync(s, {
        onSuccess: async (l, u, d) => {
          (t?.invalidateKeys && (await Promise.all(t.invalidateKeys.map((f) => n.invalidateQueries({ queryKey: f })))),
            o?.onSuccess?.(l, u, d));
        },
        onError(l, u, d) {
          o?.onError?.(l, u, d);
        },
        onSettled(l, u, d, f) {
          o?.onSettled?.(l, u, d, f);
        },
      });
  }
