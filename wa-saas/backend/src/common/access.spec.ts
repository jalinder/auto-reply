process.env.JWT_ACCESS_SECRET = 'test-access-secret-0123456789abcdef';
process.env.JWT_STEPUP_SECRET = 'test-stepup-secret-0123456789abcdef';
process.env.SECRETS_MASTER_KEY = Buffer.alloc(32, 7).toString('base64');

import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AccessGuard } from './access';

function ctx(headers: Record<string, string>) {
  const req: any = { headers };
  return { req, ec: { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => () => {}, getClass: () => class {} } as any };
}

describe('AccessGuard tenant isolation', () => {
  const jwt = new JwtService({});
  const reflector = new Reflector();
  const memberships: Record<string, any> = {
    'tenantA:user1': { status: 'active', role: 'editor', tenant: { status: 'active', planId: 'free' } },
  };
  const prisma: any = {
    tenantMember: { findUnique: async ({ where }: any) => memberships[`${where.tenantId_userId.tenantId}:${where.tenantId_userId.userId}`] ?? null },
  };
  const guard = new AccessGuard(reflector, jwt, prisma);
  const token = () => jwt.signAsync({ sub: 'user1', email: 'u@x.com', typ: 'access' }, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: 60 });

  it('rejects requests without a token', async () => {
    await expect(guard.canActivate(ctx({}).ec)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects tokens signed with another secret', async () => {
    const bad = await jwt.signAsync({ sub: 'user1', typ: 'access' }, { secret: 'other-secret-xxxxxxxxxxxxxxxxxxxxxxxx' });
    await expect(guard.canActivate(ctx({ authorization: `Bearer ${bad}`, 'x-tenant-id': 'tenantA' }).ec)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('allows a member of tenant A', async () => {
    const { req, ec } = ctx({ authorization: `Bearer ${await token()}`, 'x-tenant-id': 'tenantA' });
    await expect(guard.canActivate(ec)).resolves.toBe(true);
    expect(req.tenant).toEqual({ id: 'tenantA', role: 'editor', planId: 'free' });
  });

  it('blocks the same user from tenant B (cross-tenant access)', async () => {
    const { ec } = ctx({ authorization: `Bearer ${await token()}`, 'x-tenant-id': 'tenantB' });
    await expect(guard.canActivate(ec)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
