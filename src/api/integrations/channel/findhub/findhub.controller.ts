import { WAMonitoringService } from '@api/services/monitor.service';
import { BadRequestException, NotFoundException } from '@exceptions';

import { diagnostics } from '../../../../diagnostics/diagnostics.service';
import { FindHubAuthError } from './auth/findhub-auth.error';
import { FindHubBrowserAuthService } from './auth/findhub-browser-auth.service';
import { FINDHUB_EXTENSION_ID } from './auth/findhub-extension.constants';
import { FINDHUB_INTEGRATION } from './findhub.constants';
import { FindHubStartupService } from './services/findhub-runtime.service';

export class FindHubController {
  private readonly browser = new FindHubBrowserAuthService();

  constructor(private readonly monitor: WAMonitoringService) {}

  private runtime(instanceName: string): FindHubStartupService {
    const runtime = this.monitor.waInstances[instanceName];
    if (!runtime) throw new NotFoundException(`The "${instanceName}" instance does not exist`);
    if (runtime.integration !== FINDHUB_INTEGRATION) {
      throw new BadRequestException('The selected instance is not a Google Find Hub instance');
    }
    return runtime as FindHubStartupService;
  }

  public snapshot(instanceName: string) {
    return this.runtime(instanceName).snapshot();
  }
  public subscribe(instanceName: string, listener: (event: any) => void) {
    return this.runtime(instanceName).subscribe(listener);
  }
  public settings(instanceName: string) {
    return this.runtime(instanceName).settings();
  }
  public async saveSettings(instanceName: string, data: any) {
    try {
      return await this.runtime(instanceName).saveSettings(data);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Configuração inválida.');
    }
  }
  public traccarConfiguration(instanceName: string) {
    return this.runtime(instanceName).traccarConfiguration();
  }
  public async saveTraccarConfiguration(instanceName: string, data: any) {
    try {
      return await this.runtime(instanceName).saveTraccarConfiguration(data);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Configuração Traccar inválida.');
    }
  }
  public async provisionTraccar(instanceName: string, deviceId: string) {
    try {
      return await this.runtime(instanceName).provisionTraccar(deviceId);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Falha ao vincular dispositivo.');
    }
  }

  public startAuth(instanceName: string, data: any) {
    return this.runtime(instanceName).auth().start(instanceName, data.email);
  }

  public async importCredentials(instanceName: string, data: any) {
    const runtime = this.runtime(instanceName);
    await runtime.auth().importBundle(instanceName, data);
    await runtime.connect();
    return await this.status(instanceName);
  }

  public async status(instanceName: string) {
    const runtime = this.runtime(instanceName);
    const status = await runtime.auth().status(instanceName);
    const connected = status.ready && runtime.transportReady;
    return {
      ...status,
      ready: connected,
      connected,
      connectionState: runtime.connectionStatus.state,
      pending: this.browser.pending(runtime),
      historyEnabled: (await runtime.settings()).historyEnabled,
      minimumIntervalSeconds: 0,
      helper: {
        extensionId: FINDHUB_EXTENSION_ID,
        version: '0.1.6',
        required: true,
        mobileSupported: false,
        downloadPath: `/findhub/auth/extension/${encodeURIComponent(instanceName)}`,
      },
    };
  }
  public async browserAuth(instanceName: string, operation: 'start' | 'exchange' | 'complete' | 'cancel', data: any) {
    try {
      const runtime = this.runtime(instanceName);
      if (operation === 'start') return await this.browser.start(runtime, data.email);
      if (operation === 'exchange') return await this.browser.exchange(runtime, data);
      if (operation === 'complete') return await this.browser.complete(runtime, data);
      return this.browser.cancel(runtime, data);
    } catch (error) {
      if (error instanceof FindHubAuthError) {
        diagnostics.record({
          code: 'runtime.error',
          component: 'findhub-auth',
          instanceId: instanceName,
          level: 'warn',
          error,
        });
      }
      throw new BadRequestException(error instanceof Error ? error.message : 'Falha na vinculação Google.');
    }
  }
  public extensionAllowed(instanceName: string) {
    this.runtime(instanceName);
  }
  public traccar(instanceName: string, deviceId: string) {
    return this.runtime(instanceName).traccarBinding(deviceId);
  }
  public async disconnect(instanceName: string) {
    const runtime = this.runtime(instanceName);
    this.browser.abort(runtime);
    await runtime.logoutInstance();
    return { state: 'WAITING_AUTH', connected: false };
  }
  public devices(instanceName: string) {
    return this.runtime(instanceName).devices();
  }
  public refreshDevices(instanceName: string) {
    return this.runtime(instanceName).refreshDevices();
  }
  public device(instanceName: string, deviceId: string) {
    return this.runtime(instanceName).device(deviceId);
  }
  public locate(instanceName: string, deviceId: string, timeoutMs?: number) {
    return this.runtime(instanceName).locate(deviceId, timeoutMs);
  }
  public startTracking(instanceName: string, deviceId: string, data: any) {
    return this.runtime(instanceName).startTracking(deviceId, data.intervalSeconds, data.timeoutMs);
  }
  public stopTracking(instanceName: string, deviceId: string) {
    return this.runtime(instanceName).stopTracking(deviceId);
  }
  public positions(instanceName: string, deviceId: string, limit: number, from?: string, to?: string) {
    return this.runtime(instanceName).positions(deviceId, limit, from, to);
  }
  public setTraccar(instanceName: string, deviceId: string, data: any) {
    return this.runtime(instanceName).setTraccar(deviceId, data);
  }
  public removeTraccar(instanceName: string, deviceId: string) {
    return this.runtime(instanceName).removeTraccar(deviceId);
  }
}
