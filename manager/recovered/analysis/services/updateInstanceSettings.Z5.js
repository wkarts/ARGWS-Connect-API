const Z5 = async ({ instanceName: e, token: t, data: n }) =>
      (await Ee.post(`/settings/set/${e}`, n, { headers: { apikey: t } })).data;
