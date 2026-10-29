function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Missing required env var ${name}`);
  return v;
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  get isProd() {
    return this.env === 'production';
  },
  port: Number(process.env.PORT ?? 4000),
  appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  redisUrl: req('REDIS_URL', 'redis://localhost:6379'),
  jwt: {
    accessSecret: req('JWT_ACCESS_SECRET'),
    stepUpSecret: req('JWT_STEPUP_SECRET'),
    accessTtl: Number(process.env.ACCESS_TOKEN_TTL_SECONDS ?? 900),
    refreshTtlDays: Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30),
  },
  secrets: {
    masterKey: req('SECRETS_MASTER_KEY'),
    keyVersion: Number(process.env.SECRETS_KEY_VERSION ?? 1),
  },
  s3: {
    bucket: req('S3_BUCKET', 'wasaas-media'),
    region: process.env.S3_REGION ?? 'ap-south-1',
    endpoint: process.env.S3_ENDPOINT || undefined,
    publicEndpoint: process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    accessKeyId: process.env.S3_ACCESS_KEY_ID || undefined,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || undefined,
  },
  browser: {
    /** Persistent per-connection Chromium profiles. Must be an encrypted volume (see README). */
    dataDir: process.env.BROWSER_DATA_DIR ?? './.sessions',
    executablePath: process.env.BROWSER_EXECUTABLE_PATH || undefined,
    maxSessionsPerWorker: Number(process.env.BROWSER_MAX_SESSIONS ?? 10),
    minIntervalMs: Number(process.env.BROWSER_MIN_INTERVAL_MS ?? 4000),
    dailyLimitPerNumber: Number(process.env.BROWSER_DAILY_LIMIT ?? 1000),
    sendTimeoutMs: Number(process.env.BROWSER_SEND_TIMEOUT_MS ?? 90_000),
    qrMaxRetries: Number(process.env.BROWSER_QR_MAX_RETRIES ?? 5),
    extraArgs: (process.env.BROWSER_ARGS ?? '--disable-dev-shm-usage').split(' ').filter(Boolean),
  },
  enabledConnectors: (process.env.ENABLED_CONNECTORS ?? 'browser').split(',').map((s) => s.trim()),
  mail: {
    host: process.env.SMTP_HOST ?? '',
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.MAIL_FROM ?? 'Relay <no-reply@example.com>',
  },
  metricsToken: process.env.METRICS_TOKEN ?? '',
  metricsPort: Number(process.env.METRICS_PORT ?? 0),
  clamav: { host: process.env.CLAMAV_HOST ?? '', port: Number(process.env.CLAMAV_PORT ?? 3310) },
  retention: {
    deletedTenantDays: Number(process.env.RETENTION_DELETED_TENANT_DAYS ?? 30),
    messageContentDays: Number(process.env.RETENTION_MESSAGE_CONTENT_DAYS ?? 90),
    messageEventDays: Number(process.env.RETENTION_MESSAGE_EVENT_DAYS ?? 400),
    auditDays: Number(process.env.RETENTION_AUDIT_DAYS ?? 730),
  },
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID ?? '',
    keySecret: process.env.RAZORPAY_KEY_SECRET ?? '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? '',
    plans: {
      growth: process.env.RAZORPAY_PLAN_GROWTH ?? '',
      scale: process.env.RAZORPAY_PLAN_SCALE ?? '',
    } as Record<string, string>,
  },
};
