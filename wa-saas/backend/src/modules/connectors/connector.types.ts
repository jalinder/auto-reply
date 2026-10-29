import { WhatsappConnection } from '@prisma/client';

export type ConnectorType = 'browser' | 'sandbox';

export interface ConnectorCapabilities {
  qrLinking: boolean;
  text: boolean;
  templates: boolean;
  media: Array<'image' | 'document' | 'video'>;
  /** Connector can report delivered/read with provider evidence. */
  deliveryReceipts: boolean;
  readReceipts: boolean;
  /** Free-form text only allowed inside a customer-initiated service window. */
  freeformRequiresOpenWindow: boolean;
  /** Pacing between sends on one connection. */
  minIntervalMs: number;
  /** Must sends on one connection be strictly serialized? */
  serialized: boolean;
}

export interface BeginConnectionInput {
  tenantId: string;
  connectionId: string;
}

export interface BeginConnectionResult {
  /** 'pending': linking continues asynchronously and reports progress via connection events. */
  status: 'connected' | 'waiting_for_qr' | 'pending' | 'error';
  maskedAccount?: string;
  providerAccountId?: string;
  wabaId?: string;
  /** Persisted encrypted in SecretStore; never returned to clients. */
  secret?: Record<string, unknown>;
  /** Short-lived QR, stored only in Redis with TTL. */
  qr?: { payload: string; expiresAt: Date };
  errorCode?: string;
}

export interface ConnectorContext {
  connection: WhatsappConnection;
  secret: Record<string, any> | null;
}

export interface OutboundMedia {
  mediaId: string;
  kind: 'image' | 'document' | 'video';
  mimeType: string;
  fileName: string;
  /** Lazily loads bytes from private storage, so connectors that upload can do so. */
  load: () => Promise<Buffer>;
}

export interface SendInput {
  ctx: ConnectorContext;
  to: string; // E.164
  idempotencyKey: string;
  recipientId: string;
  text?: string;
  template?: { name: string; language: string; bodyParams: string[] };
  media?: OutboundMedia;
}

export type SendResult =
  | { outcome: 'submitted'; externalRef: string }
  | { outcome: 'failed'; code: string; retryable: boolean }
  | { outcome: 'unknown'; code: string };

export interface HealthResult { ok: boolean; code?: string }

export interface WhatsAppConnector {
  readonly type: ConnectorType;
  getCapabilities(): ConnectorCapabilities;
  beginConnection(input: BeginConnectionInput): Promise<BeginConnectionResult>;
  send(input: SendInput): Promise<SendResult>;
  checkHealth(ctx: ConnectorContext): Promise<HealthResult>;
  disconnect(ctx: ConnectorContext): Promise<void>;
  /** Optional: link by entering a code on the phone instead of scanning a QR. */
  requestPairingCode?(ctx: ConnectorContext, phoneE164: string): Promise<string>;
}

export class ConnectorDisabledError extends Error {
  constructor(public readonly type: string) { super(`Connector ${type} is disabled`); }
}
