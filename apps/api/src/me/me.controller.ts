import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Authenticated, Ctx } from '../auth/decorators';
import type { RequestContext } from '../common/request';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  @Get()
  @Authenticated()
  me(@Ctx() ctx: RequestContext) {
    const { sub, org, name, outlets, deviceId } = ctx.user;
    return { id: sub, organizationId: org, name, outlets, deviceId: deviceId ?? null };
  }
}
