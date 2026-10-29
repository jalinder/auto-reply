import { Module } from '@nestjs/common';
import { AuditModule } from './common/audit.service';
import { MailerModule } from './common/mailer.service';
import { PrismaModule } from './common/prisma.service';
import { QueuesModule } from './common/queues';
import { RedisModule } from './common/redis';
import { BrowserSessionManager } from './modules/browser/session-manager';
import { ConnectionsService } from './modules/connections/connections.service';
import { ConnectorsModule } from './modules/connectors/connector.registry';
import { StorageModule } from './modules/media/storage.service';
import { UsageService } from './modules/usage/usage.service';

@Module({
  imports: [PrismaModule, RedisModule, QueuesModule, AuditModule, StorageModule, ConnectorsModule, MailerModule],
  providers: [UsageService, ConnectionsService, BrowserSessionManager],
})
export class BrowserWorkerModule {}
