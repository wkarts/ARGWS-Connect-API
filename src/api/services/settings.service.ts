import { InstanceDto } from '@api/dto/instance.dto';
import { SettingsDto } from '@api/dto/settings.dto';
import { Integration } from '@api/types/wa.types';
import { Logger } from '@config/logger.config';
import { BadRequestException } from '@exceptions';

import { WAMonitoringService } from './monitor.service';

export class SettingsService {
  constructor(private readonly waMonitor: WAMonitoringService) {}

  private readonly logger = new Logger('SettingsService');

  public async create(instance: InstanceDto, data: SettingsDto) {
    if (this.waMonitor.waInstances[instance.instanceName]?.integration === Integration.GOOGLE_FIND_HUB) {
      throw new BadRequestException('Configurações do WhatsApp não se aplicam ao Google Find Hub. Use /findhub.');
    }
    await this.waMonitor.waInstances[instance.instanceName].setSettings(data);

    return { settings: { ...instance, settings: data } };
  }

  public async find(instance: InstanceDto): Promise<SettingsDto> {
    if (this.waMonitor.waInstances[instance.instanceName]?.integration === Integration.GOOGLE_FIND_HUB) return null;
    try {
      const result = await this.waMonitor.waInstances[instance.instanceName].findSettings();

      if (Object.keys(result).length === 0) {
        throw new Error('Settings not found');
      }

      return result;
    } catch {
      return null;
    }
  }
}
