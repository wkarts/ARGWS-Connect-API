const Q5 = async ({ instanceName: e, token: t, number: n }) =>
      (await Ee.get(`/instance/connect/${e}`, { headers: { apikey: t }, params: { number: n } })).data;
