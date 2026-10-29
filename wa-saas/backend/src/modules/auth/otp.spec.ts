process.env.JWT_ACCESS_SECRET = 'test-access-secret-0123456789abcdef';
process.env.JWT_STEPUP_SECRET = 'test-stepup-secret-0123456789abcdef';
process.env.SECRETS_MASTER_KEY = Buffer.alloc(32, 7).toString('base64');

import { JwtService } from '@nestjs/jwt';
import { AuthService, hashOtp } from './auth.service';

function setup(overrides: Partial<{ expiresAt: Date; attempts: number; consumedAt: Date | null }> = {}) {
  const ch: any = { id: '11111111-1111-1111-1111-111111111111', userId: 'u1', deviceId: null, attempts: 0, consumedAt: null, expiresAt: new Date(Date.now() + 60_000), ...overrides };
  ch.codeHash = hashOtp(ch.id, '123456');
  const prisma: any = {
    loginChallenge: {
      findUnique: async () => ch,
      updateMany: async ({ where, data }: any) => {
        if (where.consumedAt === null && ch.consumedAt) return { count: 0 };
        if (where.attempts && ch.attempts >= where.attempts.lt) return { count: 0 };
        if (data.attempts) ch.attempts++;
        if (data.consumedAt) ch.consumedAt = data.consumedAt;
        return { count: 1 };
      },
    },
    user: { findUniqueOrThrow: async () => ({ id: 'u1', email: 'a@b.co', status: 'active' }) },
    refreshToken: { create: async () => ({}) },
  };
  const svc = new AuthService(prisma, new JwtService({}), { log: async () => undefined } as any, { send: async () => undefined } as any);
  return { svc, ch };
}

describe('two-step sign-in codes', () => {
  it('issues tokens for the right code, once', async () => {
    const { svc, ch } = setup();
    const t = await svc.verifyOtp(ch.id, '123456', null);
    expect(t.accessToken).toBeTruthy();
    await expect(svc.verifyOtp(ch.id, '123456', null)).rejects.toMatchObject({ code: 'OTP_INVALID' }); // no replay
  });
  it('rejects a wrong code and counts the attempt', async () => {
    const { svc, ch } = setup();
    await expect(svc.verifyOtp(ch.id, '000000', null)).rejects.toMatchObject({ code: 'OTP_INVALID' });
    expect(ch.attempts).toBe(1);
  });
  it('locks the challenge after 5 attempts even with the right code', async () => {
    const { svc, ch } = setup({ attempts: 5 });
    await expect(svc.verifyOtp(ch.id, '123456', null)).rejects.toMatchObject({ code: 'OTP_INVALID' });
  });
  it('rejects expired codes', async () => {
    const { svc, ch } = setup({ expiresAt: new Date(Date.now() - 1000) });
    await expect(svc.verifyOtp(ch.id, '123456', null)).rejects.toMatchObject({ code: 'OTP_INVALID' });
  });
  it('binds the hash to the challenge id', () => {
    expect(hashOtp('a', '123456')).not.toBe(hashOtp('b', '123456'));
  });
});
