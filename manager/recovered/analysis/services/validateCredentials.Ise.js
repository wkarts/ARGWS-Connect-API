const Ise = async ({ url: e, token: t }) => {
      try {
        const { data: n } = await sn.post(`${e}/verify-creds`, {}, { headers: { apikey: t } });
        return (
          Rj({
            facebookAppId: n.facebookAppId,
            facebookConfigId: n.facebookConfigId,
            facebookUserToken: n.facebookUserToken,
          }),
          n
        );
      } catch {
        return null;
      }
    };
