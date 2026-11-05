import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import type { EdgeDevice } from '@prisma/client';
import { type EdgeBatch, edgeBatchSchema, EDGE_HEADERS } from '@dinesense/shared';
import { HttpStatus } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { AppError } from '../common/app-error';
import { ZodPipe } from '../common/zod';
import { Edge, EdgeGuard } from './edge.guard';
import { EdgeService } from './edge.service';

/** Endpoints for edge vision devices. HMAC-signed (see packages/shared/src/edge/signing.ts); no user sessions. */
@ApiTags('edge')
@Public()
@UseGuards(EdgeGuard)
@ApiHeader({ name: EDGE_HEADERS.device, required: true })
@ApiHeader({ name: EDGE_HEADERS.timestamp, required: true })
@ApiHeader({ name: EDGE_HEADERS.signature, required: true })
@Controller('edge')
export class EdgeController {
  constructor(private readonly edge: EdgeService) {}

  @Get('config')
  config(@Edge() device: EdgeDevice) {
    return this.edge.config(device);
  }

  @Post('events')
  @HttpCode(200)
  events(@Edge() device: EdgeDevice, @Body(new ZodPipe(edgeBatchSchema)) body: EdgeBatch) {
    if (body.deviceId !== device.id)
      throw new AppError('FORBIDDEN', HttpStatus.FORBIDDEN, 'Batch is for another device');
    return this.edge.ingest(device, body.events);
  }

  /** Calibration snapshot (image/jpeg). Faces/heads are blurred on the device before upload. */
  @Post('cameras/:cameraId/snapshot')
  @HttpCode(204)
  async snapshot(
    @Edge() device: EdgeDevice,
    @Param('cameraId') cameraId: string,
    @Body() body: unknown,
  ): Promise<void> {
    if (!Buffer.isBuffer(body))
      throw new AppError('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, 'Send the snapshot as image/jpeg');
    await this.edge.saveSnapshot(device, cameraId, body);
  }
}
