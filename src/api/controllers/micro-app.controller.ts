import { InstanceDto } from '@api/dto/instance.dto';
import { MicroAppSessionDto, MicroAppSubmitDto } from '@api/dto/micro-app.dto';
import { MicroAppService } from '@api/services/micro-app.service';

export class MicroAppController {
  constructor(private readonly service: MicroAppService) {}

  public createSession(instance: InstanceDto, data: MicroAppSessionDto) {
    return this.service.createSession(instance, data);
  }

  public state(token: string) {
    return this.service.state(token);
  }

  public submit(token: string, data: MicroAppSubmitDto, clientIp?: string) {
    return this.service.submit(token, data, clientIp);
  }

  public html(token: string) {
    return this.service.htmlShell(token);
  }

  public runtimeScript() {
    return this.service.runtimeScript();
  }
}
