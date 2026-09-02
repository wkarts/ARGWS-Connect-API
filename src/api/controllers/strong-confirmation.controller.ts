import { StrongConfirmationDecisionDto } from '@api/dto/strong-confirmation.dto';
import { InteractionEngineService } from '@api/services/interaction-engine.service';

export class StrongConfirmationController {
  constructor(private readonly interactionEngine: InteractionEngineService) {}

  public pending(instanceName: string) {
    return this.interactionEngine.listStrongConfirmations(instanceName);
  }

  public approve(instanceName: string, data: StrongConfirmationDecisionDto) {
    return this.interactionEngine.approveStrongConfirmation(instanceName, data.sessionId, data.actor, data.reason);
  }

  public reject(instanceName: string, data: StrongConfirmationDecisionDto) {
    return this.interactionEngine.rejectStrongConfirmation(instanceName, data.sessionId, data.actor, data.reason);
  }
}
