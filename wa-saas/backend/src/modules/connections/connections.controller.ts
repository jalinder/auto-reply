import { Body, Controller, Delete, Get, Headers, Param, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsString, Length } from 'class-validator';
import { Response } from 'express';
import {
  AuthUser, CurrentTenant, CurrentUser, MinRole, ReqMeta, RequestMeta, RequireStepUp, TenantCtx,
} from '../../common/access';
import { AppError } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { ConnectorRegistry } from '../connectors/connector.registry';
import { ConnectionsService, toPublicConnection } from './connections.service';

class PairingDto { @IsString() @Length(6, 25) phone: string }

class CreateConnectionDto {
  @IsIn(['browser', 'sandbox']) connectorType: string;
  @IsString() @Length(1, 80) label: string;
}

@Controller('v1/connections')
export class ConnectionsController {
  constructor(
    private readonly svc: ConnectionsService,
    private readonly prisma: PrismaService,
    private readonly registry: ConnectorRegistry,
  ) {}

  @Get('types')
  types() {
    return { items: this.registry.available().filter((t) => t.enabled) };
  }

  @Get()
  async list(@CurrentTenant() t: TenantCtx) {
    const rows = await this.prisma.whatsappConnection.findMany({
      where: { tenantId: t.id, status: { not: 'revoked' } },
      orderBy: { createdAt: 'desc' },
    });
    return { items: rows.map((c) => toPublicConnection(c, this.registry)) };
  }

  @MinRole('admin') @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post()
  async create(@CurrentTenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Body() dto: CreateConnectionDto,
    @Headers('idempotency-key') idem: string | undefined, @ReqMeta() meta: RequestMeta) {
    if (idem && !/^[\w-]{8,100}$/.test(idem)) throw new AppError('BAD_IDEMPOTENCY_KEY', 'Idempotency-Key is malformed.');
    const c = await this.svc.create({
      tenantId: t.id, planId: t.planId, userId: u.id, connectorType: dto.connectorType, label: dto.label,
      idempotencyKey: idem, ...meta,
    });
    return toPublicConnection(c, this.registry);
  }

  @Get(':id')
  async get(@CurrentTenant() t: TenantCtx, @Param('id') id: string) {
    return toPublicConnection(await this.svc.getOwned(t.id, id), this.registry);
  }

  @MinRole('admin') @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':id/qr')
  async qr(@CurrentTenant() t: TenantCtx, @Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    return this.svc.getQr(t.id, id);
  }

  @MinRole('admin') @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Post(':id/refresh-qr')
  async refresh(@CurrentTenant() t: TenantCtx, @Param('id') id: string) {
    return toPublicConnection(await this.svc.refreshQr(t.id, id), this.registry);
  }

  @MinRole('admin') @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':id/pairing-code')
  async pairingCode(@CurrentTenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Param('id') id: string,
    @Body() dto: PairingDto, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return this.svc.requestPairingCode(t.id, id, u.id, dto.phone);
  }

  @MinRole('admin')
  @Post(':id/cancel')
  async cancel(@CurrentTenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    return toPublicConnection(await this.svc.cancelLinking(t.id, id, u.id), this.registry);
  }

  @MinRole('admin')
  @Post(':id/sandbox/scan')
  async sandboxScan(@CurrentTenant() t: TenantCtx, @Param('id') id: string) {
    return toPublicConnection(await this.svc.sandboxScan(t.id, id), this.registry);
  }

  @MinRole('admin') @RequireStepUp()
  @Delete(':id')
  async revoke(@CurrentTenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Param('id') id: string, @ReqMeta() meta: RequestMeta) {
    return toPublicConnection(await this.svc.revoke(t.id, id, u.id, meta.ip, meta.requestId), this.registry);
  }

  @Get(':id/events')
  async events(@CurrentTenant() t: TenantCtx, @Param('id') id: string) {
    await this.svc.getOwned(t.id, id);
    const rows = await this.prisma.connectionEvent.findMany({ where: { connectionId: id }, orderBy: { createdAt: 'desc' }, take: 50 });
    return { items: rows.map((e) => ({ id: e.id, eventType: e.eventType, metadata: e.safeMetadata, createdAt: e.createdAt })) };
  }
}
