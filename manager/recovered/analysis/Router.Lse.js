const Lse = Z2([
      { path: '/', element: i.jsx(Fse, {}) },
      { path: '/manager/login', element: i.jsx(jL, { children: i.jsx(Dse, {}) }) },
      { path: '/manager/', element: i.jsx(tn, { children: i.jsx(B5, { children: i.jsx(CZ, {}) }) }) },
      {
        path: '/manager/instance/:instanceId/dashboard',
        element: i.jsx(tn, { children: i.jsx(un, { children: i.jsx(PX, {}) }) }),
      },
      {
        path: '/manager/instance/:instanceId/chat',
        element: i.jsx(tn, { children: i.jsx(un, { children: i.jsx(tk, {}) }) }),
      },
      {
        path: '/manager/instance/:instanceId/chat/:remoteJid',
        element: i.jsx(tn, { children: i.jsx(un, { children: i.jsx(tk, {}) }) }),
      },
      {
        path: '/manager/instance/:instanceId/settings',
        element: i.jsx(tn, { children: i.jsx(un, { children: i.jsx(qre, {}) }) }),
      },
      {
        path: '/manager/instance/:instanceId/openai',
        element: i.jsx(tn, { children: i.jsx(un, { children: i.jsx(Tk, {}) }) }),
      },
      {
        path: '/manager/instance/:instanceId/openai/:botId',
        element: i.jsx(tn, { children: i.jsx(un, { children: i.jsx(Tk, {}) }) }),
      },
      {
        path: '/manager/instance/:instanceId/webhook',
        element: i.jsx(tn, { children: i.jsx(un, { children: i.jsx(jse, {}) }) }),
      },
      {
        path: '/manager/instance/:instanceId/websocket',
        element: i.jsx(tn, { children: i.jsx(un, { children: i.jsx(Ose, {}) }) }),
      },
      {
        path: '/manager/instance/:instanceId/rabbitmq',
        element: i.jsx(tn, { children: i.jsx(un, { children: i.jsx(Bre, {}) }) }),
      },
      {
        path: '/manager/instance/:instanceId/sqs',
        element: i.jsx(tn, { children: i.jsx(un, { children: i.jsx(Yre, {}) }) }),
      },
      {
        path: '/manager/instance/:instanceId/chatwoot',
        element: i.jsx(tn, { children: i.jsx(un, { children: i.jsx(yX, {}) }) }),
      },
      {
        path: '/manager/instance/:instanceId/typebot',
        element: i.jsx(tn, { children: i.jsx(un, { children: i.jsx(Nk, {}) }) }),
      },
      {
        path: '/manager/instance/:instanceId/typebot/:typebotId',
        element: i.jsx(tn, { children: i.jsx(un, { children: i.jsx(Nk, {}) }) }),
      },
      {
        path: '/manager/instance/:instanceId/dify',
        element: i.jsx(tn, { children: i.jsx(un, { children: i.jsx(xk, {}) }) }),
      },
      {
        path: '/manager/instance/:instanceId/dify/:difyId',
        element: i.jsx(tn, { children: i.jsx(un, { children: i.jsx(xk, {}) }) }),
      },
      {
        path: '/manager/instance/:instanceId/n8n',
        element: i.jsx(tn, { children: i.jsx(un, { children: i.jsx(jk, {}) }) }),
      },
      {
        path: '/manager/instance/:instanceId/n8n/:n8nId',
        element: i.jsx(tn, { children: i.jsx(un, { children: i.jsx(jk, {}) }) }),
      },
      {
        path: '/manager/instance/:instanceId/connectAI',
        element: i.jsx(tn, { children: i.jsx(un, { children: i.jsx(Ck, {}) }) }),
      },
      {
        path: '/manager/instance/:instanceId/connectAI/:connectAIId',
        element: i.jsx(tn, { children: i.jsx(un, { children: i.jsx(Ck, {}) }) }),
      },
      {
        path: '/manager/instance/:instanceId/connectBot',
        element: i.jsx(tn, { children: i.jsx(un, { children: i.jsx(Ek, {}) }) }),
      },
      {
        path: '/manager/instance/:instanceId/connectBot/:connectBotId',
        element: i.jsx(tn, { children: i.jsx(un, { children: i.jsx(Ek, {}) }) }),
      },
      {
        path: '/manager/instance/:instanceId/flowise',
        element: i.jsx(tn, { children: i.jsx(un, { children: i.jsx(kk, {}) }) }),
      },
      {
        path: '/manager/instance/:instanceId/flowise/:flowiseId',
        element: i.jsx(tn, { children: i.jsx(un, { children: i.jsx(kk, {}) }) }),
      },
      {
        path: '/manager/instance/:instanceId/proxy',
        element: i.jsx(tn, { children: i.jsx(un, { children: i.jsx(Ore, {}) }) }),
      },
      { path: '/manager/embed-chat', element: i.jsx(Sk, {}) },
      { path: '/manager/embed-chat/:remoteJid', element: i.jsx(Sk, {}) },
    ]),
    $se = {
      type: 'logger',
      log(e) {
        this.output('log', e);
      },
      warn(e) {
        this.output('warn', e);
      },
      error(e) {
        this.output('error', e);
      },
      output(e, t) {
        console && console[e] && console[e].apply(console, t);
      },
    };
