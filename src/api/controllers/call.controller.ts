import { CallIdDto, MuteCallDto, OfferCallDto } from '@api/dto/call.dto';
import { InstanceDto } from '@api/dto/instance.dto';
import { WAMonitoringService } from '@api/services/monitor.service';
import { VoiceMediaService } from '@api/services/voice-media.service';
import { BadRequestException, NotFoundException } from '@exceptions';

export class CallController {
  constructor(
    private readonly waMonitor: WAMonitoringService,
    private readonly voiceMediaService: VoiceMediaService,
  ) {}

  private instance(instanceName: string): any {
    const instance = this.waMonitor.waInstances[instanceName];
    if (!instance) throw new NotFoundException(`Instance "${instanceName}" not found`);
    return instance;
  }

  private method(instanceName: string, methodName: string): (...args: any[]) => Promise<any> {
    const instance = this.instance(instanceName);
    const method = instance?.[methodName];
    if (typeof method !== 'function') {
      throw new BadRequestException(`The selected provider does not support the call operation "${methodName}"`);
    }
    return method.bind(instance);
  }

  public async offerCall({ instanceName }: InstanceDto, data: OfferCallDto) {
    return this.method(instanceName, 'offerCall')(data);
  }

  public async acceptCall({ instanceName }: InstanceDto, data: CallIdDto) {
    return this.method(instanceName, 'acceptCall')(data.callId);
  }

  public async rejectCall({ instanceName }: InstanceDto, data: CallIdDto) {
    return this.method(instanceName, 'rejectCall')(data.callId);
  }

  public async endCall({ instanceName }: InstanceDto, data: CallIdDto) {
    return this.method(instanceName, 'endCall')(data.callId);
  }

  public async muteCall({ instanceName }: InstanceDto, data: MuteCallDto) {
    return this.method(instanceName, 'muteCall')(data.callId, data.muted);
  }

  public async mediaTicket({ instanceName }: InstanceDto, data: CallIdDto) {
    return this.voiceMediaService.createMediaTicket(instanceName, data.callId);
  }

  public async listCalls({ instanceName }: InstanceDto) {
    return this.method(instanceName, 'listCalls')();
  }
}
