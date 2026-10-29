import { Body, Controller, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { AuthUser, CurrentTenant, CurrentUser, MinRole, ReqMeta, RequestMeta, TenantCtx } from '../../common/access';
import { AppError } from '../../common/errors';
import { MessagesService } from './messages.service';

class SendMessageDto {
  @IsString() @Length(4, 30) to: string;
  @IsOptional() @IsString() @MaxLength(4096) text?: string;
  @IsOptional() @IsString() mediaId?: string;
  @IsOptional() @IsString() connectionId?: string;
  @IsOptional() @Matches(/^[A-Z]{2}$/) defaultCountry?: string;
}

/**
 * One-off sends for apps and integrations. Pace your own calls: the connection applies a minimum
 * interval and a daily cap per number, and a send that trips the cap comes back as 'failed'.
 */
@Controller('v1/messages')
export class MessagesController {
  constructor(private readonly svc: MessagesService) {}

  @MinRole('editor') @Throttle({ default: { limit: 60, ttl: 60_000 } }) @HttpCode(202)
  @Post()
  async send(@CurrentTenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Body() dto: SendMessageDto,
    @Headers('idempotency-key') idem: string | undefined, @ReqMeta() meta: RequestMeta) {
    if (idem && !/^[\w-]{8,100}$/.test(idem)) throw new AppError('BAD_IDEMPOTENCY_KEY', 'Idempotency-Key is malformed.');
    return this.svc.send({
      tenantId: t.id, planId: t.planId, userId: u.id,
      to: dto.to, text: dto.text, mediaId: dto.mediaId, connectionId: dto.connectionId,
      defaultCountry: dto.defaultCountry, idempotencyKey: idem, ...meta,
    });
  }

  /** Poll for the delivery evidence: queued → submitted → delivered → read, or failed / unknown. */
  @Get(':id')
  async get(@CurrentTenant() t: TenantCtx, @Param('id') id: string) {
    return this.svc.get(t.id, id);
  }
}
