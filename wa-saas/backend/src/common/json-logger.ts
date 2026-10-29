import { LoggerService } from '@nestjs/common';

const SECRET_KEYS = /pass(word)?|token|secret|authorization|cookie|qr|payload|code|otp|session/i;
const SECRET_VALUES = [/Bearer\s+[\w.-]+/g, /eyJ[\w-]+\.[\w-]+\.[\w-]+/g, /\b\d{6}\b(?=.*code)/gi];

function redact(v: unknown, depth = 0): unknown {
  if (depth > 4) return '[depth]';
  if (typeof v === 'string') return SECRET_VALUES.reduce((s, re) => s.replace(re, '[redacted]'), v).slice(0, 4000);
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => redact(x, depth + 1));
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, SECRET_KEYS.test(k) ? '[redacted]' : redact(x, depth + 1)]));
  }
  return v;
}

/** One JSON object per line (CloudWatch / Loki friendly), with secrets redacted. */
export class JsonLogger implements LoggerService {
  constructor(private readonly service: string) {}
  private write(level: string, message: unknown, context?: string, extra?: unknown) {
    const line: Record<string, unknown> = { ts: new Date().toISOString(), level, service: this.service, context };
    if (message && typeof message === 'object') Object.assign(line, redact(message) as object);
    else line.msg = redact(String(message));
    if (extra) line.stack = redact(String(extra));
    process.stdout.write(JSON.stringify(line) + '\n');
  }
  log(m: unknown, c?: string) { this.write('info', m, c); }
  error(m: unknown, stack?: string, c?: string) { this.write('error', m, c, stack); }
  warn(m: unknown, c?: string) { this.write('warn', m, c); }
  debug(m: unknown, c?: string) { this.write('debug', m, c); }
  verbose(m: unknown, c?: string) { this.write('debug', m, c); }
}

export function appLogger(service: string) {
  return process.env.LOG_FORMAT === 'json' || process.env.NODE_ENV === 'production' ? new JsonLogger(service) : undefined;
}
