import { AppError } from '../../common/errors';
import { MessagesService } from './messages.service';

const CONNECTED = { id: 'conn1', tenantId: 't1', status: 'connected', connectorType: 'browser' };

function harness(over: {
  connections?: any[];
  optOut?: any;
  contact?: any;
  media?: any;
  priorCampaign?: any;
  launch?: (...a: any[]) => Promise<any>;
} = {}) {
  const state = {
    campaigns: [] as any[],
    contactsCreated: [] as any[],
    launched: [] as any[],
    deleted: [] as string[],
  };
  const connections = over.connections ?? [CONNECTED];
  const prisma: any = {
    optOut: { findUnique: async () => over.optOut ?? null },
    whatsappConnection: {
      findFirst: async ({ where }: any) => connections.find((c) => c.id === where.id) ?? null,
      findMany: async () => connections.filter((c) => c.status === 'connected'),
    },
    mediaAsset: { findFirst: async () => over.media ?? null },
    contact: {
      findUnique: async () => over.contact ?? null,
      create: async ({ data }: any) => { const c = { id: 'ct1', ...data }; state.contactsCreated.push(c); return c; },
      update: async ({ data }: any) => ({ ...over.contact, ...data }),
    },
    campaign: {
      create: async ({ data }: any) => { const c = { id: `cm${state.campaigns.length + 1}`, status: 'draft', ...data }; state.campaigns.push(c); return c; },
      findUnique: async () => over.priorCampaign ?? null,
      deleteMany: async ({ where }: any) => { state.deleted.push(where.id); return { count: 1 }; },
    },
    campaignRecipient: {
      findFirst: async ({ where }: any) => ({
        id: 'msg1', tenantId: 't1', phoneE164: '+919876543210', status: 'queued', attemptCount: 0,
        lastErrorCode: null, submittedAt: null, deliveredAt: null, readAt: null, failedAt: null,
        createdAt: new Date(), updatedAt: new Date(),
        campaign: state.campaigns.find((c) => c.id === where.campaignId) ?? over.priorCampaign ?? { id: 'cm1', connectionId: 'conn1', body: 'hi', mediaId: null },
      }),
    },
  };
  const campaigns: any = { launch: over.launch ?? (async (...a: any[]) => { state.launched.push(a); }) };
  const registry: any = { capabilities: () => ({ media: ['image', 'document', 'video'] }) };
  const usage: any = { assertCanAdd: async () => undefined };
  return { svc: new MessagesService(prisma, campaigns, registry, usage), state };
}

const base = { tenantId: 't1', planId: 'free', userId: 'u1', ip: null, requestId: null };

async function codeOf(p: Promise<unknown>) {
  try { await p; return null; } catch (e) { return (e as AppError).code; }
}

describe('direct messages', () => {
  it('rejects an unusable phone number', async () => {
    const { svc } = harness();
    expect(await codeOf(svc.send({ ...base, to: '12', text: 'hi' }))).toBe('INVALID_PHONE');
  });

  it('rejects a message with neither text nor media', async () => {
    const { svc } = harness();
    expect(await codeOf(svc.send({ ...base, to: '+919876543210', text: '   ' }))).toBe('EMPTY_MESSAGE');
  });

  it('refuses to send to someone who opted out', async () => {
    const { svc } = harness({ optOut: { id: 'o1' } });
    expect(await codeOf(svc.send({ ...base, to: '+919876543210', text: 'hi' }))).toBe('OPTED_OUT');
  });

  it('refuses when no number is connected', async () => {
    const { svc } = harness({ connections: [] });
    expect(await codeOf(svc.send({ ...base, to: '+919876543210', text: 'hi' }))).toBe('NO_CONNECTED_NUMBER');
  });

  it('asks which number to use when several are connected', async () => {
    const { svc } = harness({ connections: [CONNECTED, { ...CONNECTED, id: 'conn2' }] });
    expect(await codeOf(svc.send({ ...base, to: '+919876543210', text: 'hi' }))).toBe('CONNECTION_REQUIRED');
  });

  it('refuses a number that exists but is not connected', async () => {
    const { svc } = harness({ connections: [{ ...CONNECTED, status: 'disconnected' }] });
    expect(await codeOf(svc.send({ ...base, to: '+919876543210', text: 'hi', connectionId: 'conn1' }))).toBe('CONNECTION_NOT_READY');
  });

  it('refuses to message a blocked contact', async () => {
    const { svc } = harness({ contact: { id: 'ct1', status: 'blocked', deletedAt: null } });
    expect(await codeOf(svc.send({ ...base, to: '+919876543210', text: 'hi' }))).toBe('CONTACT_BLOCKED');
  });

  it('sends media with no caption, as a one-recipient direct campaign', async () => {
    const { svc, state } = harness({ media: { id: 'md1', mimeType: 'image/jpeg' } });
    const msg = await svc.send({ ...base, to: '09876543210', mediaId: 'md1' });
    expect(state.campaigns).toHaveLength(1);
    expect(state.campaigns[0]).toMatchObject({ kind: 'direct', mediaId: 'md1', body: null, messageType: 'text' });
    expect(state.campaigns[0].audience).toEqual({ type: 'contacts', contactIds: ['ct1'], requireConsent: false });
    expect(state.launched[0][4]).toBe(1); // expectedCount
    expect(state.launched[0][6]).toEqual({ auditAction: 'message.sent' });
    expect(msg.to).toBe('+919876543210');
    expect(msg.status).toBe('queued');
  });

  it('rejects a file type the connection cannot send', async () => {
    const { svc } = harness({ media: { id: 'md1', mimeType: 'application/pdf' } });
    (svc as any).registry = { capabilities: () => ({ media: ['image'] }) };
    expect(await codeOf(svc.send({ ...base, to: '+919876543210', mediaId: 'md1' }))).toBe('MEDIA_NOT_SUPPORTED');
  });

  it('replays an Idempotency-Key instead of sending twice', async () => {
    const prior = { id: 'cm0', connectionId: 'conn1', body: 'hi', mediaId: null };
    const { svc, state } = harness({ priorCampaign: prior });
    const msg = await svc.send({ ...base, to: '+919876543210', text: 'hi', idempotencyKey: 'abc12345' });
    expect(state.campaigns).toHaveLength(0);
    expect(state.launched).toHaveLength(0);
    expect(msg.campaignId).toBe('cm0');
  });

  it('cleans up the draft when the launch is refused', async () => {
    const { svc, state } = harness({ launch: async () => { throw new AppError('PLAN_LIMIT_REACHED', 'No quota left.', 402); } });
    expect(await codeOf(svc.send({ ...base, to: '+919876543210', text: 'hi' }))).toBe('PLAN_LIMIT_REACHED');
    expect(state.deleted).toEqual(['cm1']);
  });
});
