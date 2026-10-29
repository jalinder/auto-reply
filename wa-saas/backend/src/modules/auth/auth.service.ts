import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import { randomInt, randomUUID } from 'crypto';
import { AuditService } from '../../common/audit.service';
import { config } from '../../common/config';
import { randomToken, safeEqual, sha256 } from '../../common/crypto';
import { MailerService } from '../../common/mailer.service';
import { authFailures } from '../../common/metrics';
import { AppError, Errors } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { slugify } from '../tenants/tenants.service';

const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
const MAX_FAILED = 8;
const LOCK_MINUTES = 15;

export interface TokenPair { accessToken: string; refreshToken: string; expiresIn: number }
export interface OtpChallenge { otpRequired: true; challengeId: string; expiresIn: number }

const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
/** Codes are bound to their challenge id, so a leaked hash can't be replayed for another challenge. */
export const hashOtp = (challengeId: string, code: string) => sha256(`${challengeId}:${code}`);

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly dummyHash = hash('timing-equalizer-password', ARGON);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly mailer: MailerService,
  ) {}

  hashPassword(pw: string) {
    return hash(pw, ARGON);
  }

  async register(input: { email: string; password: string; name: string; workspaceName: string }, ip: string | null) {
    const email = input.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw Errors.conflict('EMAIL_IN_USE', 'An account with this email already exists. Sign in instead.');
    const passwordHash = await this.hashPassword(input.password);
    const slug = `${slugify(input.workspaceName)}-${randomToken(3).toLowerCase()}`;
    const user = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email, name: input.name.trim(), passwordHash } });
      const tenant = await tx.tenant.create({ data: { name: input.workspaceName.trim(), slug } });
      await tx.tenantMember.create({ data: { tenantId: tenant.id, userId: user.id, role: 'owner' } });
      return user;
    });
    await this.audit.log({ actorId: user.id, action: 'user.registered', resourceType: 'user', resourceId: user.id, ip });
    return this.issue(user.id, user.email);
  }

  async login(emailRaw: string, password: string, deviceId: string | undefined, ip: string | null): Promise<TokenPair | OtpChallenge> {
    const email = emailRaw.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash || user.status !== 'active') {
      await verify(await this.dummyHash, password).catch(() => false);
      authFailures.inc({ reason: 'unknown_user' });
      throw new AppError('INVALID_CREDENTIALS', 'Email or password is incorrect.', 401);
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError('ACCOUNT_LOCKED', 'Too many failed attempts. Try again in 15 minutes or reset your password.', 423);
    }
    const ok = await verify(user.passwordHash, password).catch(() => false);
    if (!ok) {
      const failed = user.failedLogins + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLogins: failed >= MAX_FAILED ? 0 : failed,
          lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        },
      });
      await this.audit.log({ actorId: user.id, action: 'auth.login_failed', resourceType: 'user', resourceId: user.id, ip });
      authFailures.inc({ reason: 'bad_password' });
      throw new AppError('INVALID_CREDENTIALS', 'Email or password is incorrect.', 401);
    }
    if (user.failedLogins > 0 || user.lockedUntil) {
      await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    }
    if (user.twoFactorEnabled) return this.startChallenge(user.id, user.email, deviceId);
    await this.audit.log({ actorId: user.id, action: 'auth.login', resourceType: 'user', resourceId: user.id, ip });
    return this.issue(user.id, user.email, deviceId);
  }

  private async startChallenge(userId: string, email: string, deviceId?: string): Promise<OtpChallenge> {
    const recent = await this.prisma.loginChallenge.count({ where: { userId, createdAt: { gt: new Date(Date.now() - 15 * 60_000) } } });
    if (recent >= 5) throw new AppError('OTP_RATE_LIMITED', 'Too many sign-in codes requested. Wait 15 minutes and try again.', 429);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const ch = await this.prisma.loginChallenge.create({ data: { userId, codeHash: 'pending', deviceId: deviceId ?? null, expiresAt: new Date(Date.now() + OTP_TTL_MS) } });
    await this.prisma.loginChallenge.update({ where: { id: ch.id }, data: { codeHash: hashOtp(ch.id, code) } });
    await this.mailer.send(email, `${code} is your Relay sign-in code`,
      `Your Relay sign-in code is ${code}.\n\nIt expires in 5 minutes. If you didn't try to sign in, change your password now.`);
    return { otpRequired: true, challengeId: ch.id, expiresIn: OTP_TTL_MS / 1000 };
  }

  async verifyOtp(challengeId: string, code: string, ip: string | null): Promise<TokenPair> {
    const ch = await this.prisma.loginChallenge.findUnique({ where: { id: challengeId } });
    const invalid = new AppError('OTP_INVALID', 'That code is incorrect or has expired. Sign in again to get a new one.', 401);
    if (!ch || ch.consumedAt || ch.expiresAt < new Date() || ch.attempts >= OTP_MAX_ATTEMPTS) throw invalid;
    const bumped = await this.prisma.loginChallenge.updateMany({ where: { id: ch.id, attempts: { lt: OTP_MAX_ATTEMPTS }, consumedAt: null }, data: { attempts: { increment: 1 } } });
    if (!bumped.count) throw invalid;
    if (!safeEqual(hashOtp(ch.id, code.trim()), ch.codeHash)) {
      authFailures.inc({ reason: 'bad_otp' });
      throw invalid;
    }
    const consumed = await this.prisma.loginChallenge.updateMany({ where: { id: ch.id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (!consumed.count) throw invalid;
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: ch.userId } });
    if (user.status !== 'active') throw invalid;
    await this.audit.log({ actorId: user.id, action: 'auth.login', resourceType: 'user', resourceId: user.id, ip, metadata: { twoFactor: true } });
    return this.issue(user.id, user.email, ch.deviceId ?? undefined);
  }

  async setTwoFactor(userId: string, enabled: boolean) {
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: enabled } });
    await this.audit.log({ actorId: userId, action: enabled ? 'auth.2fa_enabled' : 'auth.2fa_disabled', resourceType: 'user', resourceId: userId });
  }

  /** Rotating refresh tokens. Reuse of a rotated token revokes the whole family. */
  async refresh(rawToken: string): Promise<TokenPair> {
    const tokenHash = sha256(rawToken);
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });
    if (!row) throw Errors.unauthorized();
    if (row.revokedAt) {
      await this.prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log({ actorId: row.userId, action: 'auth.refresh_reuse_detected', resourceType: 'user', resourceId: row.userId });
      this.logger.warn(`Refresh token reuse detected for family ${row.familyId}`);
      throw Errors.unauthorized();
    }
    if (row.expiresAt < new Date() || row.user.status !== 'active') throw Errors.unauthorized();
    const pair = await this.issue(row.userId, row.user.email, row.deviceId ?? undefined, row.familyId);
    const next = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(pair.refreshToken) } });
    const updated = await this.prisma.refreshToken.updateMany({
      where: { id: row.id, revokedAt: null },
      data: { revokedAt: new Date(), replacedById: next?.id },
    });
    if (updated.count === 0) throw Errors.unauthorized(); // concurrent rotation lost the race
    return pair;
  }

  async logout(rawToken: string) {
    await this.prisma.refreshToken.updateMany({ where: { tokenHash: sha256(rawToken), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeAllSessions(userId: string) {
    await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async stepUp(userId: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash || !(await verify(user.passwordHash, password).catch(() => false))) {
      throw new AppError('INVALID_CREDENTIALS', 'Password is incorrect.', 401);
    }
    const stepUpToken = await this.jwt.signAsync(
      { sub: userId, typ: 'step_up' },
      { secret: config.jwt.stepUpSecret, expiresIn: 300, algorithm: 'HS256' },
    );
    return { stepUpToken, expiresIn: 300 };
  }

  async requestPasswordReset(emailRaw: string, invite?: { workspaceName: string; inviterName: string }) {
    const user = await this.prisma.user.findUnique({ where: { email: emailRaw.toLowerCase().trim() } });
    if (!user || user.status === 'deleted' || user.status === 'disabled') return; // no account enumeration
    const token = randomToken();
    await this.prisma.passwordReset.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 30 * 60_000) },
    });
    const link = `${config.appBaseUrl}/reset-password?token=${token}`;
    if (invite) {
      await this.mailer.send(user.email, `${invite.inviterName} invited you to ${invite.workspaceName} on Relay`,
        `${invite.inviterName} added you to the ${invite.workspaceName} workspace on Relay.\n\nSet your password to get started (link valid for 30 minutes):\n${link}\n\nAfter it expires, use "Forgot password" on the sign-in page.`);
    } else {
      await this.mailer.send(user.email, 'Reset your Relay password',
        `Someone asked to reset the password for your Relay account.\n\nReset it here (link valid for 30 minutes):\n${link}\n\nIf this wasn't you, ignore this email; your password won't change.`);
    }
  }

  async confirmPasswordReset(token: string, password: string) {
    const row = await this.prisma.passwordReset.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.usedAt || row.expiresAt < new Date()) {
      throw new AppError('RESET_TOKEN_INVALID', 'This reset link is invalid or has expired. Request a new one.', 400);
    }
    const passwordHash = await this.hashPassword(password);
    await this.prisma.$transaction([
      this.prisma.passwordReset.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      this.prisma.user.update({
        where: { id: row.userId },
        data: { passwordHash, status: 'active', failedLogins: 0, lockedUntil: null },
      }),
      this.prisma.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.log({ actorId: row.userId, action: 'auth.password_reset', resourceType: 'user', resourceId: row.userId });
  }

  async changePassword(userId: string, current: string, next: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.passwordHash || !(await verify(user.passwordHash, current).catch(() => false))) {
      throw new AppError('INVALID_CREDENTIALS', 'Current password is incorrect.', 401);
    }
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await this.hashPassword(next) } });
    await this.revokeAllSessions(userId);
    await this.audit.log({ actorId: userId, action: 'auth.password_changed', resourceType: 'user', resourceId: userId });
  }

  private async issue(userId: string, email: string, deviceId?: string, familyId?: string): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, email, typ: 'access' },
      { secret: config.jwt.accessSecret, expiresIn: config.jwt.accessTtl, algorithm: 'HS256' },
    );
    const refreshToken = randomToken(48);
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256(refreshToken),
        familyId: familyId ?? randomUUID(),
        deviceId: deviceId ?? null,
        expiresAt: new Date(Date.now() + config.jwt.refreshTtlDays * 86_400_000),
      },
    });
    return { accessToken, refreshToken, expiresIn: config.jwt.accessTtl };
  }
}
