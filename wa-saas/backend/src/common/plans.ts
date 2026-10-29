export interface Plan {
  id: string;
  name: string;
  priceInrMonthly: number;
  limits: {
    messagesPerMonth: number;
    connections: number;
    contacts: number;
    members: number;
    mediaMaxBytes: number;
    campaignMaxRecipients: number;
    storageBytes: number;
  };
}

export const PLANS: Record<string, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    priceInrMonthly: 0,
    limits: { messagesPerMonth: 500, connections: 1, contacts: 1000, members: 2, mediaMaxBytes: 5 * 1024 * 1024, campaignMaxRecipients: 250, storageBytes: 250 * 1024 * 1024 },
  },
  growth: {
    id: 'growth',
    name: 'Growth',
    priceInrMonthly: 2499,
    limits: { messagesPerMonth: 20000, connections: 3, contacts: 50000, members: 10, mediaMaxBytes: 16 * 1024 * 1024, campaignMaxRecipients: 10000, storageBytes: 5 * 1024 ** 3 },
  },
  scale: {
    id: 'scale',
    name: 'Scale',
    priceInrMonthly: 9999,
    limits: { messagesPerMonth: 200000, connections: 10, contacts: 500000, members: 50, mediaMaxBytes: 64 * 1024 * 1024, campaignMaxRecipients: 100000, storageBytes: 50 * 1024 ** 3 },
  },
};

export function planFor(id: string | null | undefined): Plan {
  return PLANS[id ?? 'free'] ?? PLANS.free;
}

export function currentPeriod(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}
