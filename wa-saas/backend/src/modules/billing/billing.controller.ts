import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { AuthUser, CurrentTenant, CurrentUser, MinRole, ReqMeta, RequestMeta, RequireStepUp, TenantCtx } from '../../common/access';
import { AuditService } from '../../common/audit.service';
import { config } from '../../common/config';
import { AppError } from '../../common/errors';
import { currentPeriod, PLANS, planFor } from '../../common/plans';
import { PrismaService } from '../../common/prisma.service';
import { UsageService } from '../usage/usage.service';

class SubscribeDto { @IsIn(['growth', 'scale']) planId: string }

@Controller('v1/billing')
export class BillingController {
  constructor(private readonly prisma: PrismaService, private readonly usage: UsageService, private readonly audit: AuditService) {}

  private async razorpay(path: string, body?: unknown) {
    if (!config.razorpay.keyId) throw new AppError('BILLING_NOT_CONFIGURED', 'Billing is not set up yet. Contact support.', 503);
    const res = await fetch(`https://api.razorpay.com/v1/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Basic ${Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString('base64')}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new AppError('BILLING_PROVIDER_ERROR', 'The payment provider rejected the request. Try again later.', 502);
    return json;
  }

  @Get()
  async overview(@CurrentTenant() t: TenantCtx) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: t.id } });
    const plan = planFor(tenant.planId);
    const [used, connections, contacts, members, sub] = await Promise.all([
      this.usage.messagesUsed(t.id),
      this.prisma.whatsappConnection.count({ where: { tenantId: t.id, status: { not: 'revoked' } } }),
      this.prisma.contact.count({ where: { tenantId: t.id, deletedAt: null } }),
      this.prisma.tenantMember.count({ where: { tenantId: t.id, status: 'active' } }),
      this.prisma.subscription.findFirst({ where: { tenantId: t.id }, orderBy: { createdAt: 'desc' } }),
    ]);
    const { start, end } = currentPeriod();
    return {
      plan, plans: Object.values(PLANS),
      usage: { messages: used, connections, contacts, members, periodStart: start, periodEnd: end },
      subscription: sub ? { id: sub.id, planId: sub.planId, status: sub.status, periodEnd: sub.periodEnd } : null,
    };
  }

  /** Invoices from the payment provider for this workspace's subscriptions. */
  @MinRole('admin')
  @Get('invoices')
  async invoices(@CurrentTenant() t: TenantCtx) {
    if (!config.razorpay.keyId) return { items: [] };
    const subs = await this.prisma.subscription.findMany({ where: { tenantId: t.id }, orderBy: { createdAt: 'desc' }, take: 5 });
    const items: { id: string; amount: number; currency: string; status: string; issuedAt: string | null; url: string | null }[] = [];
    for (const s of subs) {
      const r = await this.razorpay(`invoices?subscription_id=${encodeURIComponent(s.providerSubscriptionId)}&count=50`).catch(() => ({ items: [] }));
      for (const inv of r.items ?? []) {
        items.push({
          id: inv.id, amount: (inv.amount_paid || inv.amount || 0) / 100, currency: inv.currency ?? 'INR', status: inv.status,
          issuedAt: inv.issued_at ? new Date(inv.issued_at * 1000).toISOString() : null, url: inv.short_url ?? null,
        });
      }
    }
    items.sort((a, b) => (b.issuedAt ?? '').localeCompare(a.issuedAt ?? ''));
    return { items };
  }

  @MinRole('owner') @RequireStepUp() @HttpCode(200)
  @Post('subscribe')
  async subscribe(@CurrentTenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Body() dto: SubscribeDto, @ReqMeta() meta: RequestMeta) {
    const providerPlan = config.razorpay.plans[dto.planId];
    if (!providerPlan) throw new AppError('BILLING_NOT_CONFIGURED', 'This plan is not available for purchase yet.', 503);
    const sub = await this.razorpay('subscriptions', {
      plan_id: providerPlan, total_count: 120, customer_notify: 1, notes: { tenantId: t.id, planId: dto.planId },
    });
    await this.prisma.subscription.create({ data: { tenantId: t.id, provider: 'razorpay', providerSubscriptionId: sub.id, planId: dto.planId, status: sub.status } });
    await this.audit.log({ tenantId: t.id, actorId: u.id, action: 'billing.subscribe_started', resourceType: 'subscription', resourceId: null, metadata: { planId: dto.planId }, ...meta });
    return { checkoutUrl: sub.short_url as string, subscriptionId: sub.id as string };
  }

  @MinRole('owner') @RequireStepUp() @HttpCode(200)
  @Post('cancel')
  async cancel(@CurrentTenant() t: TenantCtx, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    const sub = await this.prisma.subscription.findFirst({ where: { tenantId: t.id, status: { in: ['active', 'authenticated'] } }, orderBy: { createdAt: 'desc' } });
    if (!sub) throw new AppError('NO_ACTIVE_SUBSCRIPTION', 'There is no active subscription to cancel.', 409);
    await this.razorpay(`subscriptions/${sub.providerSubscriptionId}/cancel`, { cancel_at_cycle_end: 1 });
    await this.audit.log({ tenantId: t.id, actorId: u.id, action: 'billing.cancel_requested', resourceType: 'subscription', resourceId: sub.id, ...meta });
    return { ok: true, effectiveAt: sub.periodEnd };
  }
}
