import { Global, Injectable, Module } from '@nestjs/common';
import { WhatsappConnection } from '@prisma/client';
import { config } from '../../common/config';
import { AppError } from '../../common/errors';
import { SecretStore } from '../../common/secret-store.service';
import { BrowserSessionConnector } from './browser.connector';
import { ConnectorContext, ConnectorType, WhatsAppConnector } from './connector.types';
import { SandboxConnector } from './sandbox.connector';

@Injectable()
export class ConnectorRegistry {
  private readonly map: Record<ConnectorType, WhatsAppConnector>;
  constructor(
    readonly browser: BrowserSessionConnector,
    readonly sandbox: SandboxConnector,
    private readonly secrets: SecretStore,
  ) {
    this.map = { browser, sandbox };
  }

  isEnabled(type: string): type is ConnectorType {
    if (type === 'sandbox' && config.isProd) return false;
    return type in this.map && config.enabledConnectors.includes(type);
  }

  available() {
    return (Object.keys(this.map) as ConnectorType[]).map((type) => ({
      type,
      enabled: this.isEnabled(type),
      capabilities: this.map[type].getCapabilities(),
    }));
  }

  get(type: string): WhatsAppConnector {
    if (!this.isEnabled(type)) throw new AppError('CONNECTOR_DISABLED', 'This connection type is not available.', 400);
    return this.map[type];
  }

  /** Returns the implementation even if disabled (used for cleanup of existing connections). */
  raw(type: string): WhatsAppConnector | null {
    return (this.map as Record<string, WhatsAppConnector>)[type] ?? null;
  }

  capabilities(type: string) {
    return (this.map as any)[type]?.getCapabilities() ?? null;
  }

  async context(connection: WhatsappConnection): Promise<ConnectorContext> {
    const secret = connection.secretRef ? await this.secrets.get(connection.tenantId, connection.secretRef) : null;
    return { connection, secret };
  }
}

@Global()
@Module({
  providers: [SandboxConnector, BrowserSessionConnector, SecretStore, ConnectorRegistry],
  exports: [ConnectorRegistry, SecretStore],
})
export class ConnectorsModule {}
