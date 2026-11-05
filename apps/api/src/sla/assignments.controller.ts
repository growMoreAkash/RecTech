import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Ctx, Roles } from '../auth/decorators';
import type { RequestContext } from '../common/request';
import { AssignmentsService } from './assignments.service';

@ApiTags('assignments')
@ApiBearerAuth()
@Controller('outlets/:outletId/assignments')
export class AssignmentsController {
  constructor(private readonly assignments: AssignmentsService) {}

  @Post(':assignmentId/ack')
  @HttpCode(200)
  @Roles('WAITER', 'MANAGER', 'OWNER')
  ack(
    @Ctx() ctx: RequestContext,
    @Param('outletId') outletId: string,
    @Param('assignmentId') assignmentId: string,
  ) {
    return this.assignments.acknowledge(ctx, outletId, assignmentId);
  }
}
