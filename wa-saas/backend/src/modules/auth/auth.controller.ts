import { Body, Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, CurrentUser, NoTenant, Public, ReqMeta, RequestMeta, RequireStepUp } from '../../common/access';
import { AuditService } from '../../common/audit.service';
import { PrismaService } from '../../common/prisma.service';
import {
  ChangePasswordDto, LoginDto, RefreshDto, RegisterDto, ResetConfirmDto, ResetRequestDto, StepUpDto, TwoFactorDto, VerifyOtpDto,
} from './auth.dto';
import { AuthService } from './auth.service';
import { AppError } from '../../common/errors';

@Controller('v1')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Public() @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('auth/register')
  register(@Body() dto: RegisterDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.register(dto, meta.ip);
  }

  @Public() @Throttle({ default: { limit: 10, ttl: 60_000 } }) @HttpCode(200)
  @Post('auth/login')
  login(@Body() dto: LoginDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.login(dto.email, dto.password, dto.deviceId, meta.ip);
  }

  @Public() @Throttle({ default: { limit: 10, ttl: 60_000 } }) @HttpCode(200)
  @Post('auth/login/verify')
  verifyOtp(@Body() dto: VerifyOtpDto, @ReqMeta() meta: RequestMeta) {
    return this.auth.verifyOtp(dto.challengeId, dto.code, meta.ip);
  }

  /** Turn email sign-in codes on or off. Requires a fresh password confirmation. */
  @NoTenant() @RequireStepUp() @HttpCode(200)
  @Post('auth/2fa')
  async twoFactor(@CurrentUser() user: AuthUser, @Body() dto: TwoFactorDto) {
    await this.auth.setTwoFactor(user.id, dto.enabled);
    return { twoFactorEnabled: dto.enabled };
  }

  @Public() @Throttle({ default: { limit: 30, ttl: 60_000 } }) @HttpCode(200)
  @Post('auth/refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public() @HttpCode(204)
  @Post('auth/logout')
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
  }

  @NoTenant() @Throttle({ default: { limit: 5, ttl: 60_000 } }) @HttpCode(200)
  @Post('auth/step-up')
  stepUp(@CurrentUser() user: AuthUser, @Body() dto: StepUpDto) {
    return this.auth.stepUp(user.id, dto.password);
  }

  @Public() @Throttle({ default: { limit: 3, ttl: 60_000 } }) @HttpCode(202)
  @Post('auth/password-reset/request')
  async resetRequest(@Body() dto: ResetRequestDto) {
    await this.auth.requestPasswordReset(dto.email);
    return { ok: true };
  }

  @Public() @Throttle({ default: { limit: 5, ttl: 60_000 } }) @HttpCode(200)
  @Post('auth/password-reset/confirm')
  async resetConfirm(@Body() dto: ResetConfirmDto) {
    await this.auth.confirmPasswordReset(dto.token, dto.password);
    return { ok: true };
  }

  @NoTenant() @HttpCode(200)
  @Post('auth/change-password')
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    await this.auth.changePassword(user.id, dto.currentPassword, dto.newPassword);
    return { ok: true };
  }

  @NoTenant() @HttpCode(204)
  @Post('auth/logout-all')
  async logoutAll(@CurrentUser() user: AuthUser) {
    await this.auth.revokeAllSessions(user.id);
  }

  @NoTenant()
  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: {
        memberships: {
          where: { status: 'active', tenant: { status: 'active' } },
          include: { tenant: { select: { id: true, name: true, slug: true, planId: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    return {
      user: { id: u.id, email: u.email, name: u.name, phone: u.phone, twoFactorEnabled: u.twoFactorEnabled },
      memberships: u.memberships.map((m) => ({ tenant: m.tenant, role: m.role })),
    };
  }

  /** Account deletion (privacy). Blocks while the user is the sole owner of an active workspace. */
  @NoTenant() @RequireStepUp() @HttpCode(204)
  @Delete('me')
  async deleteMe(@CurrentUser() user: AuthUser, @ReqMeta() meta: RequestMeta) {
    const owned = await this.prisma.tenantMember.findMany({ where: { userId: user.id, role: 'owner', status: 'active' } });
    for (const m of owned) {
      const owners = await this.prisma.tenantMember.count({ where: { tenantId: m.tenantId, role: 'owner', status: 'active' } });
      if (owners === 1) {
        throw new AppError('SOLE_OWNER', 'Transfer ownership or delete your workspaces before deleting your account.', 409);
      }
    }
    await this.prisma.$transaction([
      this.prisma.tenantMember.deleteMany({ where: { userId: user.id } }),
      this.prisma.refreshToken.deleteMany({ where: { userId: user.id } }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { status: 'deleted', email: `deleted+${user.id}@invalid`, name: 'Deleted user', phone: null, passwordHash: null },
      }),
    ]);
    await this.audit.log({ actorId: user.id, action: 'user.deleted', resourceType: 'user', resourceId: user.id, ...meta });
  }
}
