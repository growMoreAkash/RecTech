import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { scopedClient, type ScopedPrisma } from './tenant';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Tenant-scoped client. Use this for all tenant data; the raw client is for auth bootstrap and system jobs. */
  forOrg(organizationId: string): ScopedPrisma {
    return scopedClient(this, organizationId);
  }
}
