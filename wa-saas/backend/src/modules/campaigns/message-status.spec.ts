import { MessageStatusService } from './message-status.service';

function fakePrisma(initial: any) {
  const state = { recipient: { ...initial }, events: new Set<string>() };
  return {
    state,
    campaignRecipient: {
      findFirst: async () => state.recipient,
      updateMany: async ({ data }: any) => { Object.assign(state.recipient, data); return { count: 1 }; },
    },
    messageEvent: {
      create: async ({ data }: any) => {
        if (state.events.has(data.dedupKey)) {
          const { Prisma } = require('@prisma/client');
          throw new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });
        }
        state.events.add(data.dedupKey);
      },
    },
  };
}

describe('evidence-based status progression', () => {
  const base = { id: 'r1', tenantId: 't', campaignId: 'c', status: 'submitted', deliveredAt: null, submittedAt: new Date() };

  it('moves submitted → delivered → read', async () => {
    const p = fakePrisma(base);
    const s = new MessageStatusService(p as any);
    await s.apply({ externalRef: 'w1', status: 'delivered', source: 'webhook' });
    expect(p.state.recipient.status).toBe('delivered');
    await s.apply({ externalRef: 'w1', status: 'read', source: 'webhook' });
    expect(p.state.recipient.status).toBe('read');
  });

  it('never moves backwards when events arrive out of order', async () => {
    const p = fakePrisma({ ...base, status: 'read' });
    await new MessageStatusService(p as any).apply({ externalRef: 'w1', status: 'delivered', source: 'webhook' });
    expect(p.state.recipient.status).toBe('read');
    expect(p.state.recipient.deliveredAt).toBeInstanceOf(Date);
  });

  it('reconciles an Unknown outcome when provider evidence arrives', async () => {
    const p = fakePrisma({ ...base, status: 'unknown' });
    await new MessageStatusService(p as any).apply({ externalRef: 'w1', status: 'delivered', source: 'webhook' });
    expect(p.state.recipient.status).toBe('delivered');
  });

  it('deduplicates repeated webhook deliveries', async () => {
    const p = fakePrisma(base);
    const s = new MessageStatusService(p as any);
    await s.apply({ externalRef: 'w1', status: 'failed', errorCode: 'WA_ACK_ERROR', source: 'webhook' });
    p.state.recipient.status = 'submitted';
    await s.apply({ externalRef: 'w1', status: 'failed', source: 'webhook' });
    expect(p.state.recipient.status).toBe('submitted'); // second identical event ignored
  });
});
