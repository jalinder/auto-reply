import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { MailerModule } from './common/mailer.service';
import { RedisService } from './common/redis';
import { RedisThrottlerStorage } from './common/redis-throttler.storage';
import { MetricsMiddleware, OpsController } from './modules/ops/ops.controller';
import { AccessGuard } from './common/access';
import { AuditModule } from './common/audit.service';
import { GlobalExceptionFilter } from './common/errors';
import { PrismaModule } from './common/prisma.service';
import { QueuesModule } from './common/queues';
import { RedisModule } from './common/redis';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { AuthController } from './modules/auth/auth.controller';
import { AuthService } from './modules/auth/auth.service';
import { BillingController } from './modules/billing/billing.controller';
import { CampaignsController } from './modules/campaigns/campaigns.controller';
import { CampaignsService } from './modules/campaigns/campaigns.service';
import { ConnectionsController } from './modules/connections/connections.controller';
import { ConnectionsService } from './modules/connections/connections.service';
import { ConnectorsModule } from './modules/connectors/connector.registry';
import { ContactsController } from './modules/contacts/contacts.controller';
import { DashboardController } from './modules/dashboard/dashboard.controller';
import { MediaController } from './modules/media/media.controller';
import { MessagesController } from './modules/messages/messages.controller';
import { MessagesService } from './modules/messages/messages.service';
import { StorageModule } from './modules/media/storage.service';
import { RealtimeController, RealtimeHub } from './modules/realtime/realtime.controller';
import { TenantsController } from './modules/tenants/tenants.controller';
import { UsageService } from './modules/usage/usage.service';
import { WebhooksController } from './modules/webhooks/webhooks.controller';

@Module({
  imports: [
    JwtModule.register({}),
    RedisModule,
    ThrottlerModule.forRootAsync({
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({ throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }], storage: new RedisThrottlerStorage(redis) }),
    }),
    PrismaModule, QueuesModule, AuditModule, StorageModule, ConnectorsModule, MailerModule,
  ],
  controllers: [
    AuthController, TenantsController, ConnectionsController, MediaController, ContactsController,
    CampaignsController, MessagesController, WebhooksController, BillingController, RealtimeController, DashboardController, OpsController,
  ],
  providers: [
    AuthService, UsageService, ConnectionsService, CampaignsService, MessagesService, RealtimeHub,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware, MetricsMiddleware).forRoutes('*');
  }
}
