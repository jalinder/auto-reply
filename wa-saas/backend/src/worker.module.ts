import { Module } from '@nestjs/common';
import { AuditModule } from './common/audit.service';
import { MailerModule } from './common/mailer.service';
import { PrismaModule } from './common/prisma.service';
import { QueuesModule } from './common/queues';
import { RedisModule } from './common/redis';
import { CampaignsService } from './modules/campaigns/campaigns.service';
import { MessageStatusService } from './modules/campaigns/message-status.service';
import { ConnectionsService } from './modules/connections/connections.service';
import { ConnectorsModule } from './modules/connectors/connector.registry';
import { StorageModule } from './modules/media/storage.service';
import { UsageService } from './modules/usage/usage.service';
import { CampaignProcessor } from './worker/campaign.processor';
import { ImportProcessor } from './worker/import.processor';
import { MaintenanceProcessor } from './worker/maintenance.processor';
import { SendProcessor } from './worker/send.processor';

@Module({
  imports: [PrismaModule, RedisModule, QueuesModule, AuditModule, StorageModule, ConnectorsModule, MailerModule],
  providers: [UsageService, ConnectionsService, CampaignsService, MessageStatusService, SendProcessor, CampaignProcessor, ImportProcessor, MaintenanceProcessor],
})
export class WorkerModule {}
