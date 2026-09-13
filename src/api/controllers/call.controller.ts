import { CallIdDto, MuteCallDto, OfferCallDto } from '@api/dto/call.dto';
import { InstanceDto } from '@api/dto/instance.dto';
import { WAMonitoringService } from '@api/services/monitor.service';
import { VoiceMediaService } from '@api/services/voice-media.service';
import { BadRequestException, NotFoundException } from '@exceptions';

import { diagnostics } from '../../diagnostics/diagnostics.service';

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
    return this.command('start', instanceName, undefined, () => this.method(instanceName, 'offerCall')(data));
  }

  public async acceptCall({ instanceName }: InstanceDto, data: CallIdDto) {
    return this.command('accept', instanceName, data.callId, () =>
      this.method(instanceName, 'acceptCall')(data.callId),
    );
  }

  public async rejectCall({ instanceName }: InstanceDto, data: CallIdDto) {
    return this.command('reject', instanceName, data.callId, () =>
      this.method(instanceName, 'rejectCall')(data.callId),
    );
  }

  public async endCall({ instanceName }: InstanceDto, data: CallIdDto) {
    return this.command('end', instanceName, data.callId, () => this.method(instanceName, 'endCall')(data.callId));
  }

  public async muteCall({ instanceName }: InstanceDto, data: MuteCallDto) {
    return this.command('mute', instanceName, data.callId, () =>
      this.method(instanceName, 'muteCall')(data.callId, data.muted),
    );
  }

  private async command(action: string, instanceId: string, callId: string | undefined, execute: () => Promise<any>) {
    const started = performance.now();
    diagnostics.record({ code: 'call.action', action, phase: 'requested', instanceId, callId });
    try {
      const result = await execute();
      // "completed" means the provider method returned; remote acceptance still requires CALL signaling/state.
      diagnostics.record({
        code: 'call.action',
        action,
        phase: 'completed',
        instanceId,
        callId: callId ?? result?.callId ?? result?.id,
        durationMs: performance.now() - started,
      });
      return result;
    } catch (error) {
      diagnostics.record({
        code: 'call.action',
        action,
        phase: 'failed',
        instanceId,
        callId,
        durationMs: performance.now() - started,
        error,
      });
      throw error;
    }
  }

  public async mediaTicket({ instanceName }: InstanceDto, data: CallIdDto) {
    return this.voiceMediaService.createMediaTicket(instanceName, data.callId);
  }

  public async listCalls({ instanceName }: InstanceDto) {
    return this.method(instanceName, 'listCalls')();
  }
}
