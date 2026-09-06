const tn = ({ children: e }) => {
      const t = dr(jn.API_URL),
        n = dr(jn.TOKEN),
        r = dr(jn.VERSION);
      return !t || !n || !r ? i.jsx(Cj, { to: '/manager/login' }) : e;
    };
