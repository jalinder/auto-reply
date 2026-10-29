import { Redis } from 'ioredis';

/** Per-connection BullMQ queue. Exactly one browser worker consumes it (the lease holder). */
export const connQueueName = (connectionId: string) => `browser-conn-${connectionId}`;
export const ASSIGN_QUEUE = 'browser-assign';
export const RESULTS_CHANNEL = 'browser:results';
export const LEASE_TTL_MS = 30_000;

const leaseKey = (connectionId: string) => `browser:lease:${connectionId}`;

export async function leaseOwner(redis: Redis, connectionId: string): Promise<string | null> {
  return redis.get(leaseKey(connectionId));
}

export async function acquireLease(redis: Redis, connectionId: string, workerId: string): Promise<boolean> {
  const ok = await redis.set(leaseKey(connectionId), workerId, 'PX', LEASE_TTL_MS, 'NX');
  if (ok) return true;
  return (await redis.get(leaseKey(connectionId))) === workerId;
}

/** Renews only if we still own it. Returns false when the lease was lost. */
export async function renewLease(redis: Redis, connectionId: string, workerId: string): Promise<boolean> {
  const r = await redis.eval(
    `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`,
    1, leaseKey(connectionId), workerId, String(LEASE_TTL_MS),
  );
  return r === 1;
}

export async function releaseLease(redis: Redis, connectionId: string, workerId: string) {
  await redis.eval(
    `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`,
    1, leaseKey(connectionId), workerId,
  );
}

export type AssignReason = 'link' | 'relink' | 'recover' | 'purge';
export interface AssignJob { connectionId: string; reason: AssignReason }

export type ConnCommand =
  | { kind: 'send'; requestId: string; recipientId: string; to: string; text?: string; mediaId?: string }
  | { kind: 'pair'; requestId: string; phone: string }
  | { kind: 'restart' }
  | { kind: 'logout' };

export type PairOutcome = { ok: true; code: string } | { ok: false; code: string };

export type SendOutcome =
  | { outcome: 'submitted'; externalRef: string }
  | { outcome: 'failed'; code: string; retryable: boolean }
  | { outcome: 'unknown'; code: string };
