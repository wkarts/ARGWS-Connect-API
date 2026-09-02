import { metaCloudMetrics } from '@api/compat/meta-cloud/meta-cloud.metrics';
import { MetaCloudAdminRouter } from '@api/compat/meta-cloud/meta-cloud.router';
import { MetaCloudGraphRouter } from '@api/compat/meta-cloud/meta-cloud-graph.router';
import { authGuard } from '@api/guards/auth.guard';
import { instanceExistsGuard, instanceLoggedGuard } from '@api/guards/instance.guard';
import Telemetry from '@api/guards/telemetry.guard';
import { ChannelRouter } from '@api/integrations/channel/channel.router';
import { ChatbotRouter } from '@api/integrations/chatbot/chatbot.router';
import { EventRouter } from '@api/integrations/event/event.router';
import { StorageRouter } from '@api/integrations/storage/storage.router';
import { waMonitor } from '@api/server.module';
import { configService, ConfigSessionPhone, Database, Facebook } from '@config/env.config';
import { fetchLatestWaWebVersion } from '@utils/fetchLatestWaWebVersion';
import express, { NextFunction, Request, Response, Router } from 'express';
import fs from 'fs';
import path from 'path';

import { ActionRouter } from './action.router';
import { BusinessRouter } from './business.router';
import { CallRouter } from './call.router';
import { ChatRouter } from './chat.router';
import { GroupRouter } from './group.router';
import { InstanceRouter } from './instance.router';
import { LabelRouter } from './label.router';
import { MicroAppRouter } from './micro-app.router';
import { ProxyRouter } from './proxy.router';
import { RecipeRouter } from './recipe.router';
import { MessageRouter } from './sendMessage.router';
import { SettingsRouter } from './settings.router';
import { StrongConfirmationRouter } from './strong-confirmation.router';
import { TemplateRouter } from './template.router';
import { ViewsRouter } from './view.router';

enum HttpStatus {
  OK = 200,
  CREATED = 201,
  NOT_FOUND = 404,
  FORBIDDEN = 403,
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  INTERNAL_SERVER_ERROR = 500,
}

const router: Router = Router();
const serverConfig = configService.get('SERVER');
const databaseConfig = configService.get<Database>('DATABASE');
const guards = [instanceExistsGuard, instanceLoggedGuard, authGuard['apikey']];

const telemetry = new Telemetry();

const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));

// Middleware for metrics IP whitelist
const metricsIPWhitelist = (req: Request, res: Response, next: NextFunction) => {
  const metricsConfig = configService.get('METRICS');
  const allowedIPs = metricsConfig.ALLOWED_IPS?.split(',').map((ip) => ip.trim()) || ['127.0.0.1'];
  const clientIPs = [
    req.ip,
    req.connection.remoteAddress,
    req.socket.remoteAddress,
    req.headers['x-forwarded-for'],
  ].filter((ip) => ip !== undefined);

  if (allowedIPs.filter((ip) => clientIPs.includes(ip)) === 0) {
    return res.status(403).send('Forbidden: IP not allowed');
  }

  next();
};

// Middleware for metrics Basic Authentication
const metricsBasicAuth = (req: Request, res: Response, next: NextFunction) => {
  const metricsConfig = configService.get('METRICS');
  const metricsUser = metricsConfig.USER;
  const metricsPass = metricsConfig.PASSWORD;

  if (!metricsUser || !metricsPass) {
    return res.status(500).send('Metrics authentication not configured');
  }

  const auth = req.get('Authorization');
  if (!auth || !auth.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="ARGWS Connect API Metrics"');
    return res.status(401).send('Authentication required');
  }

  const credentials = Buffer.from(auth.slice(6), 'base64').toString();
  const [user, pass] = credentials.split(':');

  if (user !== metricsUser || pass !== metricsPass) {
    return res.status(401).send('Invalid credentials');
  }

  next();
};

// Expose Prometheus metrics when enabled by env flag
const metricsConfig = configService.get('METRICS');
if (metricsConfig.ENABLED) {
  const metricsMiddleware = [];

  // Add IP whitelist if configured
  if (metricsConfig.ALLOWED_IPS) {
    metricsMiddleware.push(metricsIPWhitelist);
  }

  // Add Basic Auth if required
  if (metricsConfig.AUTH_REQUIRED) {
    metricsMiddleware.push(metricsBasicAuth);
  }

  router.get('/metrics', ...metricsMiddleware, async (req, res) => {
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');

    const escapeLabel = (value: unknown) =>
      String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/"/g, '\\"');

    const lines: string[] = [];

    const clientName = databaseConfig.CONNECTION.CLIENT_NAME || 'unknown';
    const serverUrl = serverConfig.URL || '';

    // environment info
    lines.push('# HELP connect_environment_info Environment information');
    lines.push('# TYPE connect_environment_info gauge');
    lines.push(
      `connect_environment_info{version="${escapeLabel(packageJson.version)}",clientName="${escapeLabel(
        clientName,
      )}",serverUrl="${escapeLabel(serverUrl)}"} 1`,
    );

    const instances = (waMonitor && waMonitor.waInstances) || {};
    const instanceEntries = Object.entries(instances);

    // total instances
    lines.push('# HELP connect_instances_total Total number of instances');
    lines.push('# TYPE connect_instances_total gauge');
    lines.push(`connect_instances_total ${instanceEntries.length}`);

    // per-instance status
    lines.push('# HELP connect_instance_up 1 if instance state is open, else 0');
    lines.push('# TYPE connect_instance_up gauge');
    lines.push('# HELP connect_instance_state Instance state as a labelled metric');
    lines.push('# TYPE connect_instance_state gauge');

    for (const [name, instance] of instanceEntries) {
      const state = instance?.connectionStatus?.state || 'unknown';
      const integration = instance?.integration || '';
      const up = state === 'open' ? 1 : 0;

      lines.push(
        `connect_instance_up{instance="${escapeLabel(name)}",integration="${escapeLabel(integration)}"} ${up}`,
      );
      lines.push(
        `connect_instance_state{instance="${escapeLabel(name)}",integration="${escapeLabel(
          integration,
        )}",state="${escapeLabel(state)}"} 1`,
      );
    }

    lines.push(...metaCloudMetrics.prometheusLines());
    res.send(lines.join('\n') + '\n');
  });
}

if (!serverConfig.DISABLE_MANAGER) router.use('/manager', new ViewsRouter().router);

const managerAssetsPath = path.join(process.cwd(), 'manager', 'dist', 'assets');
router.use(
  '/assets',
  express.static(managerAssetsPath, {
    dotfiles: 'deny',
    fallthrough: true,
    index: false,
    maxAge: '1h',
  }),
);

router
  .use((req, res, next) => telemetry.collectTelemetry(req, res, next))

  .get('/health', (_req, res) => {
    res.status(HttpStatus.OK).json({
      status: 'ok',
      service: 'ARGWS Connect API',
      version: packageJson.version,
      uptime: Math.floor(process.uptime()),
    });
  })
  .get('/', async (req, res) => {
    res.status(HttpStatus.OK).json({
      status: HttpStatus.OK,
      message: 'Welcome to the ARGWS Connect API, it is working!',
      version: packageJson.version,
      clientName: configService.get<ConfigSessionPhone>('CONFIG_SESSION_PHONE').CLIENT,
      manager: !serverConfig.DISABLE_MANAGER ? `${req.protocol}://${req.get('host')}/manager` : undefined,
      documentation: `https://github.com/wkarts/argws-connect-api`,
      whatsappWebVersion: (await fetchLatestWaWebVersion({})).version.join('.'),
    });
  })
  .post('/verify-creds', authGuard['apikey'], async (req, res) => {
    const facebookConfig = configService.get<Facebook>('FACEBOOK');
    return res.status(HttpStatus.OK).json({
      status: HttpStatus.OK,
      message: 'Credentials are valid',
      facebookAppId: facebookConfig.APP_ID,
      facebookConfigId: facebookConfig.CONFIG_ID,
      facebookUserToken: facebookConfig.USER_TOKEN,
    });
  })
  .use('/graph', new MetaCloudGraphRouter().router)
  .use('/compat/meta', new MetaCloudAdminRouter().router)
  .use('/instance', new InstanceRouter(configService, ...guards).router)
  .use('/message', new MessageRouter(...guards).router)
  .use('/call', new CallRouter(...guards).router)
  .use('/chat', new ChatRouter(...guards).router)
  .use('/business', new BusinessRouter(...guards).router)
  .use('/group', new GroupRouter(...guards).router)
  .use('/template', new TemplateRouter(configService, ...guards).router)
  .use('/action', new ActionRouter(...guards).router)
  .use('/recipe', new RecipeRouter(...guards).router)
  .use('/micro-app', new MicroAppRouter(...guards).router)
  .use('/interaction/strong', new StrongConfirmationRouter(instanceExistsGuard, authGuard['globalApiKey']).router)
  .use('/settings', new SettingsRouter(...guards).router)
  .use('/proxy', new ProxyRouter(...guards).router)
  .use('/label', new LabelRouter(...guards).router)
  .use('', new ChannelRouter(configService, ...guards).router)
  .use('', new EventRouter(configService, ...guards).router)
  .use('', new ChatbotRouter(...guards).router)
  .use('', new StorageRouter(...guards).router);

export { HttpStatus, router };