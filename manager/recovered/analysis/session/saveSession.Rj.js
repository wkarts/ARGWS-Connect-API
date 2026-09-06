const Rj = async (e) => {
      if (e.url) {
        const t = e.url.endsWith('/') ? e.url.slice(0, -1) : e.url;
        localStorage.setItem('apiUrl', t);
      }
      (e.token && localStorage.setItem('token', e.token),
        e.version && localStorage.setItem('version', e.version),
        e.facebookAppId && localStorage.setItem('facebookAppId', e.facebookAppId),
        e.facebookConfigId && localStorage.setItem('facebookConfigId', e.facebookConfigId),
        e.facebookUserToken && localStorage.setItem('facebookUserToken', e.facebookUserToken),
        e.clientName && localStorage.setItem('clientName', e.clientName));
    };
