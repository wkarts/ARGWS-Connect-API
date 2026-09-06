function Hh() {
    const e = nt(Q5, {
        invalidateKeys: [
          ['instance', 'fetchInstance'],
          ['instance', 'fetchInstances'],
        ],
      }),
      t = nt(Z5, { invalidateKeys: [['instance', 'fetchSettings']] }),
      n = nt(J5, {
        invalidateKeys: [
          ['instance', 'fetchInstance'],
          ['instance', 'fetchInstances'],
        ],
      }),
      r = nt(G5, {
        invalidateKeys: [
          ['instance', 'fetchInstance'],
          ['instance', 'fetchInstances'],
        ],
      }),
      s = nt(W5, {
        invalidateKeys: [
          ['instance', 'fetchInstance'],
          ['instance', 'fetchInstances'],
        ],
      }),
      o = nt(K5, { invalidateKeys: [['instance', 'fetchInstances']] });
    return { connect: e, updateSettings: t, deleteInstance: n, logout: r, restart: s, createInstance: o };
  }
