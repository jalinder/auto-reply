import { Body, Controller, Headers, HttpCode, Logger, Post, RawBodyRequest, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { Request } from 'express';
import { Public } from '../../common/access';
import { config } from '../../common/config';
import { hmacSha256Hex, safeEqual } from '../../common/crypto';
import { AppError } from '../../common/errors';
import { PLANS } from '../../common/plans';
import { PrismaService } from '../../common/prisma.service';

@Public() @SkipThrottle()
@Controller('v1/webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);
  constructor(private readonly prisma: PrismaService) {}

  @Post('razorpay') @HttpCode(200)
  async razorpay(@Req() req: RawBodyRequest<Request>, @Headers('x-razorpay-signature') sig: string | undefined,
    @Headers('x-razorpay-event-id') eventId: string | undefined, @Body() body: any) {
    if (!config.razorpay.webhookSecret || !req.rawBody || !sig) throw new AppError('BAD_SIGNATURE', 'Invalid signature.', 401);
    if (!safeEqual(hmacSha256Hex(config.razorpay.webhookSecret, req.rawBody), sig)) throw new AppError('BAD_SIGNATURE', 'Invalid signature.', 401);
    if (eventId) {
      try {
        await this.prisma.webhookReceipt.create({ data: { provider: 'razorpay', eventId } });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { ok: true, duplicate: true };
        throw e;
      }
    }
    const sub = body?.payload?.subscription?.entity;
    if (!sub?.id) return { ok: true };
    const tenantId = sub.notes?.tenantId as string | undefined;
    const planId = sub.notes?.planId as string | undefined;
    if (!tenantId || !planId || !PLANS[planId]) return { ok: true };
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return { ok: true };

    const periodEnd = sub.current_end ? new Date(sub.current_end * 1000) : null;
    await this.prisma.subscription.upsert({
      where: { providerSubscriptionId: sub.id },
      create: { tenantId, provider: 'razorpay', providerSubscriptionId: sub.id, planId, status: sub.status, periodEnd },
      update: { status: sub.status, periodEnd },
    });
    const active = ['active', 'authenticated'].includes(sub.status);
    const ended = ['cancelled', 'completed', 'expired', 'halted'].includes(sub.status);
    if (active) await this.prisma.tenant.update({ where: { id: tenantId }, data: { planId } });
    if (ended) await this.prisma.tenant.update({ where: { id: tenantId }, data: { planId: 'free' } });
    await this.prisma.auditLog.create({ data: { tenantId, action: `billing.${body.event ?? 'event'}`, resourceType: 'subscription', metadata: { status: sub.status, planId } } });
    return { ok: true };
  }
}
