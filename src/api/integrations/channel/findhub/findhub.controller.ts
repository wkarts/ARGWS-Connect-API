import { WAMonitoringService } from '@api/services/monitor.service';
import { BadRequestException, NotFoundException } from '@exceptions';

import { FINDHUB_INTEGRATION } from './findhub.constants';
import { FindHubStartupService } from './services/findhub-runtime.service';

export class FindHubController {
  constructor(private readonly monitor: WAMonitoringService) {}

  private runtime(instanceName: string): FindHubStartupService {
    const runtime = this.monitor.waInstances[instanceName];
    if (!runtime) throw new NotFoundException(`The "${instanceName}" instance does not exist`);
    if (runtime.integration !== FINDHUB_INTEGRATION) {
      throw new BadRequestException('The selected instance is not a Google Find Hub instance');
    }
    return runtime as FindHubStartupService;
  }

  public startAuth(instanceName: string, data: any) {
    return this.runtime(instanceName).auth().start(instanceName, data.email);
  }

  public async importCredentials(instanceName: string, data: any) {
    const runtime = this.runtime(instanceName);
    const result = await runtime.auth().importBundle(instanceName, data);
    await runtime.connect();
    return result;
  }

  public status(instanceName: string) { return this.runtime(instanceName).auth().status(instanceName); }
  public devices(instanceName: string) { return this.runtime(instanceName).devices(); }
  public refreshDevices(instanceName: string) { return this.runtime(instanceName).refreshDevices(); }
  public device(instanceName: string, deviceId: string) { return this.runtime(instanceName).device(deviceId); }
  public locate(instanceName: string, deviceId: string) { return this.runtime(instanceName).locate(deviceId); }
  public startTracking(instanceName: string, deviceId: string, data: any) { return this.runtime(instanceName).startTracking(deviceId, data.intervalSeconds); }
  public stopTracking(instanceName: string, deviceId: string) { return this.runtime(instanceName).stopTracking(deviceId); }
  public positions(instanceName: string, deviceId: string, limit: number) { return this.runtime(instanceName).positions(deviceId, limit); }
  public setTraccar(instanceName: string, deviceId: string, data: any) { return this.runtime(instanceName).setTraccar(deviceId, data); }
  public removeTraccar(instanceName: string, deviceId: string) { return this.runtime(instanceName).removeTraccar(deviceId); }
}
