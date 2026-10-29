import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { IsEmail, IsIn, IsOptional, IsString, Length } from 'class-validator';
import {
  AuthUser, CurrentTenant, CurrentUser, MinRole, NoTenant, ReqMeta, RequestMeta, RequireStepUp, Role, TenantCtx,
} from '../../common/access';
import { AuditService } from '../../common/audit.service';
import { randomToken } from '../../common/crypto';
import { AppError, Errors } from '../../common/errors';
import { page, PageQuery } from '../../common/pagination';
import { planFor } from '../../common/plans';
import { PrismaService } from '../../common/prisma.service';
import { AuthService } from '../auth/auth.service';
import { UsageService } from '../usage/usage.service';
import { slugify } from './tenants.service';

class CreateTenantDto { @IsString() @Length(2, 120) name: string }
class UpdateTenantDto { @IsOptional() @IsString() @Length(2, 120) name?: string }
class InviteDto {
  @IsEmail() email: string;
  @IsIn(['admin', 'editor', 'viewer']) role: Role;
  @IsOptional() @IsString() @Length(1, 120) name?: string;
}
class RoleDto { @IsIn(['owner', 'admin', 'editor', 'viewer']) role: Role }

@Controller('v1')
export class TenantsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly usage: UsageService,
    private readonly auth: AuthService,
  ) {}

  @NoTenant()
  @Post('tenants')
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateTenantDto, @ReqMeta() meta: RequestMeta) {
    const owned = await this.prisma.tenantMember.count({ where: { userId: user.id, role: 'owner', status: 'active' } });
    if (owned >= 5) throw new AppError('TENANT_QUOTA', 'You can own up to 5 workspaces.', 409);
    const tenant = await this.prisma.tenant.create({
      data: {
        name: dto.name.trim(),
        slug: `${slugify(dto.name)}-${randomToken(3).toLowerCase()}`,
        members: { create: { userId: user.id, role: 'owner' } },
      },
    });
    await this.audit.log({ tenantId: tenant.id, actorId: user.id, action: 'tenant.created', resourceType: 'tenant', resourceId: tenant.id, ...meta });
    return { tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, planId: tenant.planId }, role: 'owner' };
  }

  @Get('tenants/current')
  async current(@CurrentTenant() t: TenantCtx) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: t.id } });
    return { id: tenant.id, name: tenant.name, slug: tenant.slug, planId: tenant.planId, role: t.role, plan: planFor(tenant.planId) };
  }

  @MinRole('admin')
  @Patch('tenants/current')
  async update(@CurrentTenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Body() dto: UpdateTenantDto, @ReqMeta() meta: RequestMeta) {
    const tenant = await this.prisma.tenant.update({ where: { id: t.id }, data: { name: dto.name?.trim() } });
    await this.audit.log({ tenantId: t.id, actorId: u.id, action: 'tenant.updated', resourceType: 'tenant', resourceId: t.id, ...meta });
    return { id: tenant.id, name: tenant.name };
  }

  /** Soft-deletes the workspace; a purge job removes data after the retention window. */
  @MinRole('owner') @RequireStepUp() @HttpCode(204)
  @Delete('tenants/current')
  async remove(@CurrentTenant() t: TenantCtx, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    await this.prisma.$transaction([
      this.prisma.campaign.updateMany({ where: { tenantId: t.id, status: { in: ['scheduled', 'running', 'paused'] } }, data: { status: 'cancelled' } }),
      this.prisma.whatsappConnection.updateMany({ where: { tenantId: t.id }, data: { status: 'revoked' } }),
      this.prisma.tenant.update({ where: { id: t.id }, data: { status: 'deleted', deletedAt: new Date() } }),
    ]);
    await this.audit.log({ tenantId: t.id, actorId: u.id, action: 'tenant.deleted', resourceType: 'tenant', resourceId: t.id, ...meta });
  }

  @Get('members')
  async members(@CurrentTenant() t: TenantCtx) {
    const rows = await this.prisma.tenantMember.findMany({
      where: { tenantId: t.id, status: 'active' },
      include: { user: { select: { id: true, email: true, name: true, status: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return { items: rows.map((m) => ({ userId: m.userId, email: m.user.email, name: m.user.name, role: m.role, pending: m.user.status === 'invited', joinedAt: m.createdAt })) };
  }

  @MinRole('admin')
  @Post('members')
  async invite(@CurrentTenant() t: TenantCtx, @CurrentUser() actor: AuthUser, @Body() dto: InviteDto, @ReqMeta() meta: RequestMeta) {
    await this.usage.assertCanAdd(t.id, t.planId, 'members');
    const email = dto.email.toLowerCase().trim();
    let user = await this.prisma.user.findUnique({ where: { email } });
    if (user?.status === 'deleted' || user?.status === 'disabled') throw new AppError('USER_UNAVAILABLE', 'This user cannot be invited.', 409);
    if (!user) {
      user = await this.prisma.user.create({ data: { email, name: dto.name ?? email.split('@')[0], status: 'invited' } });
    }
    const existing = await this.prisma.tenantMember.findUnique({ where: { tenantId_userId: { tenantId: t.id, userId: user.id } } });
    if (existing?.status === 'active') throw Errors.conflict('ALREADY_MEMBER', 'This person is already in the workspace.');
    await this.prisma.tenantMember.upsert({
      where: { tenantId_userId: { tenantId: t.id, userId: user.id } },
      create: { tenantId: t.id, userId: user.id, role: dto.role },
      update: { role: dto.role, status: 'active' },
    });
    // Invited users set their password through the reset flow (email link).
    if (user.status === 'invited') {
      const [tenant, inviter] = await Promise.all([
        this.prisma.tenant.findUniqueOrThrow({ where: { id: t.id } }),
        this.prisma.user.findUniqueOrThrow({ where: { id: actor.id } }),
      ]);
      await this.auth.requestPasswordReset(email, { workspaceName: tenant.name, inviterName: inviter.name });
    }
    await this.audit.log({ tenantId: t.id, actorId: actor.id, action: 'member.invited', resourceType: 'user', resourceId: user.id, metadata: { role: dto.role }, ...meta });
    return { userId: user.id, email, role: dto.role, pending: user.status === 'invited' };
  }

  @MinRole('admin')
  @Patch('members/:userId')
  async changeRole(@CurrentTenant() t: TenantCtx, @CurrentUser() actor: AuthUser, @Param('userId') userId: string, @Body() dto: RoleDto, @ReqMeta() meta: RequestMeta) {
    const target = await this.prisma.tenantMember.findUnique({ where: { tenantId_userId: { tenantId: t.id, userId } } });
    if (!target || target.status !== 'active') throw Errors.notFound('Member');
    if ((dto.role === 'owner' || target.role === 'owner') && t.role !== 'owner') throw Errors.forbidden('Only owners can change ownership.');
    if (target.role === 'owner' && dto.role !== 'owner') {
      const owners = await this.prisma.tenantMember.count({ where: { tenantId: t.id, role: 'owner', status: 'active' } });
      if (owners <= 1) throw new AppError('LAST_OWNER', 'A workspace needs at least one owner.', 409);
    }
    await this.prisma.tenantMember.update({ where: { id: target.id }, data: { role: dto.role } });
    await this.audit.log({ tenantId: t.id, actorId: actor.id, action: 'member.role_changed', resourceType: 'user', resourceId: userId, metadata: { from: target.role, to: dto.role }, ...meta });
    return { userId, role: dto.role };
  }

  @MinRole('admin') @HttpCode(204)
  @Delete('members/:userId')
  async removeMember(@CurrentTenant() t: TenantCtx, @CurrentUser() actor: AuthUser, @Param('userId') userId: string, @ReqMeta() meta: RequestMeta) {
    const target = await this.prisma.tenantMember.findUnique({ where: { tenantId_userId: { tenantId: t.id, userId } } });
    if (!target) throw Errors.notFound('Member');
    if (target.role === 'owner') {
      if (t.role !== 'owner') throw Errors.forbidden('Only owners can remove an owner.');
      const owners = await this.prisma.tenantMember.count({ where: { tenantId: t.id, role: 'owner', status: 'active' } });
      if (owners <= 1) throw new AppError('LAST_OWNER', 'A workspace needs at least one owner.', 409);
    }
    await this.prisma.tenantMember.delete({ where: { id: target.id } });
    await this.audit.log({ tenantId: t.id, actorId: actor.id, action: 'member.removed', resourceType: 'user', resourceId: userId, ...meta });
  }

  @MinRole('admin')
  @Get('audit-logs')
  async auditLogs(@CurrentTenant() t: TenantCtx, @Query() q: PageQuery) {
    const limit = q.limit ?? 50;
    const rows = await this.prisma.auditLog.findMany({
      where: { tenantId: t.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const actorIds = [...new Set(rows.map((r) => r.actorId).filter(Boolean))] as string[];
    const actors = await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } });
    const byId = new Map(actors.map((a) => [a.id, a]));
    const p = page(rows, limit);
    return {
      ...p,
      items: p.items.map((r) => ({
        id: r.id, action: r.action, resourceType: r.resourceType, resourceId: r.resourceId,
        actor: r.actorId ? byId.get(r.actorId) ?? null : null, metadata: r.metadata, createdAt: r.createdAt,
      })),
    };
  }
}
