import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { config } from './config';
import { Errors } from './errors';
import { PrismaService } from './prisma.service';

export type Role = 'owner' | 'admin' | 'editor' | 'viewer';
const RANK: Record<Role, number> = { viewer: 1, editor: 2, admin: 3, owner: 4 };

export interface AuthUser { id: string; email: string }
export interface TenantCtx { id: string; role: Role; planId: string }

const PUBLIC = 'access:public';
const NO_TENANT = 'access:noTenant';
const MIN_ROLE = 'access:minRole';
const STEP_UP = 'access:stepUp';

/** No authentication required (login, webhooks, health). */
export const Public = () => SetMetadata(PUBLIC, true);
/** Authenticated, but not scoped to a workspace (e.g. /me, create workspace). */
export const NoTenant = () => SetMetadata(NO_TENANT, true);
/** Minimum workspace role. Default for tenant routes is "viewer". */
export const MinRole = (role: Role) => SetMetadata(MIN_ROLE, role);
/** Requires a fresh password confirmation (X-Step-Up-Token), for sensitive actions. */
export const RequireStepUp = () => SetMetadata(STEP_UP, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser =>
  ctx.switchToHttp().getRequest().user);
export const CurrentTenant = createParamDecorator((_: unknown, ctx: ExecutionContext): TenantCtx =>
  ctx.switchToHttp().getRequest().tenant);
export const ReqMeta = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const r = ctx.switchToHttp().getRequest();
  return { ip: (r.ip as string) ?? null, requestId: (r.requestId as string) ?? null };
});
export type RequestMeta = { ip: string | null; requestId: string | null };

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  private meta<T>(key: string, ctx: ExecutionContext): T | undefined {
    return this.reflector.getAllAndOverride<T>(key, [ctx.getHandler(), ctx.getClass()]);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.meta<boolean>(PUBLIC, ctx)) return true;
    const req = ctx.switchToHttp().getRequest();

    const header: string | undefined = req.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw Errors.unauthorized();
    let payload: { sub: string; email: string; typ: string };
    try {
      payload = await this.jwt.verifyAsync(token, { secret: config.jwt.accessSecret, algorithms: ['HS256'] });
    } catch {
      throw Errors.unauthorized();
    }
    if (payload.typ !== 'access') throw Errors.unauthorized();
    req.user = { id: payload.sub, email: payload.email } satisfies AuthUser;

    if (this.meta<boolean>(STEP_UP, ctx)) {
      const stepUp = req.headers['x-step-up-token'];
      try {
        const s = await this.jwt.verifyAsync(String(stepUp ?? ''), { secret: config.jwt.stepUpSecret, algorithms: ['HS256'] });
        if (s.sub !== payload.sub || s.typ !== 'step_up') throw new Error();
      } catch {
        throw Errors.stepUpRequired();
      }
    }

    if (this.meta<boolean>(NO_TENANT, ctx)) return true;

    const tenantId = req.headers['x-tenant-id'];
    if (typeof tenantId !== 'string' || tenantId.length > 36) throw Errors.forbidden('Select a workspace first.');
    // Membership is always derived server-side; the header is only a selector.
    const member = await this.prisma.tenantMember.findUnique({
      where: { tenantId_userId: { tenantId, userId: payload.sub } },
      include: { tenant: { select: { status: true, planId: true } } },
    });
    if (!member || member.status !== 'active' || member.tenant.status !== 'active') {
      throw Errors.forbidden('You are not a member of this workspace.');
    }
    const role = member.role as Role;
    const minRole = this.meta<Role>(MIN_ROLE, ctx) ?? 'viewer';
    if (RANK[role] < RANK[minRole]) throw Errors.forbidden();
    req.tenant = { id: tenantId, role, planId: member.tenant.planId } satisfies TenantCtx;
    return true;
  }
}

export function roleAtLeast(role: Role, min: Role) {
  return RANK[role] >= RANK[min];
}
