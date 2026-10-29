# Relay — multi-tenant WhatsApp campaign platform

Implementation of the *WhatsApp SaaS Architecture and Implementation Blueprint* using the
**browser-session (Puppeteer / WhatsApp Web) connector with QR linking**, with the mobile client built
as a **native Android app (Kotlin + Jetpack Compose)** instead of Flutter.

```
backend/   NestJS API · send worker · browser worker (Puppeteer) · Prisma/MySQL 8 · Redis · S3
web/       Next.js 14 dashboard (BFF pattern, tokens only in HttpOnly cookies)
android/   Kotlin, Compose (Material 3), Hilt, Retrofit/OkHttp, Keystore-encrypted tokens
docker-compose.yml   MySQL, Redis, MinIO (+ API, worker, web containers)
```

## Architecture

```
Android app ─┐                     ┌─ MySQL (tenants, contacts, campaigns, events, audit)
Web (BFF) ───┼─ HTTPS ─▶ API ──────┼─ Redis (BullMQ queues, leases, QR codes with TTL, pub/sub)
             │   SSE ◀── /v1/events└─ S3 private bucket (signed URLs only)
             │
             │   Send worker ── pre-send checks ── per-number queue ──▶ Browser worker(s)
             │                                                         ├─ Chromium session per linked number
             │                                                         │  (whatsapp-web.js on Puppeteer)
             │   ◀── message acks (sent / delivered / read) ───────────┘  profiles on encrypted volume
```

Three deployable backend processes, as the blueprint recommends (§3, §7):

| Process | Entry | Role |
| --- | --- | --- |
| API | `dist/main.js` | Auth, tenants, validation, QR endpoint, reports, SSE |
| Send worker | `dist/worker.js` | Campaign dispatch, pre-send checks, retries, imports, status ingestion |
| Browser worker | `dist/browser-worker.js` | Owns WhatsApp Web sessions; only process that runs Chromium |

### WhatsApp connector: browser session (Puppeteer)

Linking and sending go through WhatsApp Web, driven by Puppeteer via the
[`whatsapp-web.js`](https://github.com/pedroslopez/whatsapp-web.js) library (pinned to 1.34.7).
It's used instead of hand-written page selectors, which the blueprint warns against as an unstable contract.

**Linking (§6 state machine)**
1. *Connect a number* creates a connection in `created` state and queues an assignment.
2. A browser worker with spare capacity takes the job, acquires a single-writer Redis lease, and starts an isolated Chromium profile for that connection only (`LocalAuth`, one directory per connection ID).
3. Each QR code WhatsApp generates is stored only in Redis with a ~30s TTL. The connection moves to `waiting_for_qr` and clients are notified over SSE to refetch from the admin-only, `no-store` QR endpoint. QR payloads are never written to MySQL, logs or event payloads.
4. Scanning moves the connection through `authenticated` → `linking`, and `ready` → `connected` with a masked number.
5. If no one scans after `BROWSER_QR_MAX_RETRIES` rotations, the connection becomes `qr_expired`. Logging out from the phone moves it to `disconnected`, wipes the profile and pauses its campaigns. Cancel or Remove logs the linked device out and deletes the profile.

**Sending**
1. The send worker runs every pre-send check: campaign state, connection health, opt-out, contact status and monthly quota. It then claims the recipient with a lease.
2. It enforces the per-number daily limit and puts the message on that number's own queue (`browser-conn-<id>`). That queue is consumed with concurrency 1 by the lease holder, so sends on one number are strictly serialized.
3. The browser worker re-checks the recipient, campaign and opt-out, confirms the number is on WhatsApp (`NOT_ON_WHATSAPP` otherwise), sends text or media with a caption, and returns the message ID over Redis pub/sub.
4. Outcomes are recorded as follows:
   - **Timeout** → Unknown. It's never auto-resent, and it's reconciled if the send later completes.
   - **Error after `sendMessage` started** → Unknown.
   - **Lookup failure** → Failed, retryable.
5. WhatsApp Web acknowledgements (server, device, read) drive Accepted → Delivered → Read through the same evidence pipeline. STOP replies add the sender to the opt-out list.

**Reliability**
- Leases renew every 10 seconds. If a browser worker dies, its leases expire, and another worker restores those sessions from their saved profiles within about 30 seconds without a re-scan.
- Workers that are at capacity hand assignments to other workers.
- If a session restarts mid-campaign, its sends are retried with backoff. If the session stays down, the campaign is paused.

**Account protection (not evasion)**
- Pacing is set by `BROWSER_MIN_INTERVAL_MS` (default 4s per number).
- `BROWSER_DAILY_LIMIT` caps sends per number per day; when it's reached, the campaign pauses with a clear reason.
- Consent is required by default, and opt-outs are honoured before every send.
- There is no fingerprint spoofing, no CAPTCHA handling and no anti-detection logic, as the blueprint requires (§6).

> **Risk.** Automating WhatsApp Web isn't permitted by WhatsApp's terms. Linked numbers can be
> rate-limited or banned, and the connector can break when WhatsApp Web changes. Pin the library
> version, test upgrades in staging, and expect occasional re-linking (blueprint §7, §18). A `sandbox`
> connector (dev/staging only) exercises the identical flow without WhatsApp.

### One-off sends (`POST /v1/messages`)

Campaigns are for audiences; `POST /v1/messages` is for a single message from an app or integration.
It is a thin front door onto the same pipeline, so nothing is bypassed: a direct message is stored as a
one-recipient campaign (`kind = 'direct'`) and still goes through opt-out checks, the monthly quota, the
per-number pacing and daily cap, and the same Accepted → Delivered → Read evidence ladder.

```bash
curl -X POST https://api.example.com/v1/messages \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "X-Tenant-Id: $TENANT_ID" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"to":"+919876543210","text":"Your order shipped.","mediaId":"<optional>"}'
```

- `202 Accepted` returns the message with `status: "queued"`; poll `GET /v1/messages/:id` for the outcome.
- Media is uploaded first through `POST /v1/media/upload-url` → signed PUT → `POST /v1/media/:id/complete`.
  A file can be sent on its own; `text` becomes its caption when both are given.
- `connectionId` is optional while exactly one number is connected, and required past that.
- Replaying an `Idempotency-Key` returns the original message instead of sending a second one.
- Direct messages are kept out of the campaign list and the dashboard counts; the recipient still gets a
  contact record, so delivery history stays in one place.
- Rate limit: 60 requests per minute per tenant, on top of the connection's own pacing.

## Run locally

Prerequisites: Docker, Node 20, JDK 17, Android Studio (Ladybug or newer).

```bash
# 1. Infrastructure
docker compose up -d mysql redis minio minio-init

# 2. Backend
cd backend
cp .env.example .env              # then set real secrets (see below)
npm ci
npx prisma migrate dev --name init
npm run seed                      # demo login: owner@demo.test / DemoPassword123
npm run dev                       # API on :4000
npm run dev:worker                # 2nd terminal — dispatch, sending, imports, statuses
PUPPETEER_SKIP_DOWNLOAD=1 npm ci  # (already done above if you set it) — uses system Chrome
BROWSER_EXECUTABLE_PATH="/path/to/chrome" npm run dev:browser   # 3rd terminal — WhatsApp Web sessions

# 3. Web
cd ../web && cp .env.example .env.local && npm ci && npm run dev   # http://localhost:3000

# 4. Android
# Open android/ in Android Studio, let it sync, run on an emulator.
# Debug builds call http://10.0.2.2:4000 (the host machine). If the Gradle wrapper jar
# is missing, run `gradle wrapper --gradle-version 8.10.2` once, or let Android Studio create it.
```

To link a real number: add a **WhatsApp (linked device)** number, then scan the QR from the phone
(*Settings → Linked devices → Link a device*). The QR must be shown on a different screen from the phone
that scans it — use the web dashboard, or the Android app on another device.

To try the full flow without WhatsApp: add a **Sandbox** number, tap **Simulate scan**, create a
campaign for the seeded `vip` tag, launch it, and watch the evidence ladder fill in. Numbers ending in
`0000` simulate a permanent failure and numbers ending in `9999` simulate an ambiguous timeout (Unknown).

### Required secrets and settings (backend/.env)

| Variable | Notes |
| --- | --- |
| `JWT_ACCESS_SECRET`, `JWT_STEPUP_SECRET` | `openssl rand -base64 48`, distinct values |
| `SECRETS_MASTER_KEY` | `openssl rand -base64 32` |
| `ENABLED_CONNECTORS` | `browser` in production. `sandbox` is refused when `NODE_ENV=production` |
| `BROWSER_DATA_DIR` | Session profiles. **Must be an encrypted volume** (EBS/EFS with KMS, or LUKS), mode `0700`, mounted only into browser workers. Shared between them so sessions survive a worker restart |
| `BROWSER_MAX_SESSIONS` | Numbers per browser worker. Plan for roughly 300–500 MB RAM per session |
| `BROWSER_MIN_INTERVAL_MS`, `BROWSER_DAILY_LIMIT` | Pacing and per-number daily cap |
| `RAZORPAY_*` | Key, secret, webhook secret, plan IDs; webhook URL `https://<api>/v1/webhooks/razorpay` |
| `S3_*` | Private bucket with SSE. Omit `S3_ENDPOINT` on AWS |

**Deploying browser workers**
- Use `backend/Dockerfile.browser`. It runs Chromium as a non-root user, has no published ports and no remote debugging, and starts through `dumb-init`.
- Give each container CPU and memory limits and `shm_size` of 1 GB or more.
- Scale horizontally. Each linked number is controlled by exactly one worker at a time.
- Exclude session volumes from general backups and support exports. Treat them like passwords.

Android release builds read the API URL from a Gradle property:
`./gradlew assembleRelease -PRELAY_API_URL=https://api.yourdomain.com/`. Update the reset-password
App Link host in `AndroidManifest.xml` and publish `assetlinks.json` on that domain.

## How the blueprint's rules are enforced

- **Tenant isolation.** A single `AccessGuard` verifies the JWT, then derives membership and role from the database for the `X-Tenant-Id` selector. Every query is scoped by `tenantId`. S3 keys are prefixed per tenant, and connector secrets use the tenant ID as AES-GCM additional data, so a copied ciphertext won't decrypt under another tenant.
- **Auth.**
  - Passwords are hashed with Argon2id, and repeated failed logins lock the account.
  - Access tokens last 15 minutes. Refresh tokens rotate on every use, and reusing an old one revokes the whole token family.
  - Sensitive actions need a 5-minute step-up token from re-entering your password. These are: removing a number, exporting contacts, billing changes, and deleting a workspace or account.
- **QR and sessions.**
  - The QR payload lives only in Redis with a time limit. It is never stored in MySQL, logged, or sent over the event stream, and it is served `no-store` to admins only.
  - Android sets `FLAG_SECURE` on the QR screen, and the UI never asks for a WhatsApp two-step PIN.
  - Each number has its own browser profile, with a single-writer lease. Removing a number logs out the linked device and deletes its profile.
- **Sending pipeline.**
  - Launch requires a preview, an `Idempotency-Key`, and an explicit confirmation where you type the recipient count. The server re-checks that count.
  - Launch freezes the message content and creates one durable row per recipient.
  - Right before each send, the worker re-checks campaign state, connection health, opt-outs, contact status and monthly quota.
  - Each recipient is claimed atomically with a lease, and connectors that require it are serialized per connection.
  - Only transient failures are retried, with backoff. Timeouts and lost leases become **Unknown** and are never resent automatically; later webhook evidence can reconcile them.
- **Honest statuses.** Recipients move through Queued → Accepted → Delivered → Read, plus Failed, Unknown and Skipped. "Delivered" and "Read" only come from provider evidence, and status updates never move backwards.
- **Media.**
  - Uploads go to a private bucket through signed PUT URLs, against an allowlist of file types.
  - Size limits are per plan, and the server checks each file's magic bytes after upload.
  - Retention jobs clean up old files.
- **Compliance.**
  - Consent is recorded per purpose and source.
  - There is a central opt-out list, and STOP replies are added to it automatically.
  - CSV exports are protected against formula injection.
  - Every sensitive action is audited.

## Blueprint coverage

| Blueprint section | Where it's implemented |
| --- | --- |
| §2 Workspaces, roles, contacts, consent, campaigns, media, scheduling, pause/resume/cancel, reports | Backend modules + web + Android |
| §2 iOS app | **Not built.** The mobile client is native Android, as requested. A native iOS (Swift) app would reuse the same API |
| §5 Login, rotating refresh tokens, step-up for sensitive actions | `modules/auth`, `common/access.ts` |
| §5 Optional SaaS OTP | Email sign-in codes (Settings → Your account → Two-step sign-in). Codes stored hashed, valid 5 min, 5 attempts |
| §5 Never ask for the WhatsApp PIN | No PIN fields anywhere; warning shown on the linking screen |
| §6 QR **and pairing** flow, state machine, expiry/refresh/cancel | `modules/connections`, `modules/browser`. "Link with a code" works on the same phone |
| §7 Puppeteer connector, isolated sessions, single-writer lease, pinned version, no debug port | `modules/browser`, `Dockerfile.browser` |
| §9 Signed uploads, file signature, size **and storage quota**, malware scan | `modules/media` (+ optional ClamAV via `CLAMAV_HOST`) |
| §9/§13 One job per recipient, idempotency, leases, safe retries, Unknown outcome | `worker/`, `campaigns.service.ts` |
| §10 Schema | `prisma/schema.prisma` (all listed tables, plus login challenges, secrets, webhook receipts) |
| §11 API endpoints | All present; the provider webhook is replaced by WhatsApp Web acknowledgements |
| §12 HttpOnly cookies, CSRF, strict CORS, **CSP** | Web BFF + `next.config.mjs` |
| §12 Rate limits | Redis-backed, so they hold across all API instances |
| §12 Audit | Connections, exports, launches, roles, billing, sign-ins, 2FA changes. (There's no support-access feature yet to audit) |
| §12 Retention/deletion | Nightly job: message text, event history, logs, expired tokens; deleted workspaces purged with files and browser profiles |
| §12 Privacy notice | `/privacy` and `/terms`. **Templates**: fill in bracketed details and have a lawyer review |
| §13 Dead-letter queue | Exhausted jobs move to the `dead-letter` queue |
| §13 Metrics + alerts, structured logs | Prometheus metrics (API `/metrics`, workers `METRICS_PORT`), rules in `ops/alerts.yml`, JSON logs with secrets redacted |
| §14 Screens and status labels | Web + Android |
| §15 CI/CD: tests, dependency scan, secret scan, reviewed migrations | `.github/workflows/ci.yml`, Dependabot, CODEOWNERS |
| §3 Billing: plans, subscriptions, **invoices**, verified webhooks | `modules/billing`, Razorpay webhook |

## Operations

**Email.** Set `SMTP_*`. Without it, production cannot send password resets, invitations or sign-in codes. Development prints them to the console.

**Monitoring.**
- Scrape the API at `/metrics` with header `Authorization: Bearer $METRICS_TOKEN`. Scrape the workers on `METRICS_PORT`, which must be internal only.
- Load `ops/alerts.yml`. It alerts on send backlog, dead-letter growth, sessions dropping, workers down, failure spikes, abnormal volume, sign-in failure spikes and API errors.
- Logs are one JSON object per line in production (`LOG_FORMAT=json`), with passwords, tokens, QR and pairing codes redacted.

**Retention.** The windows are configurable with `RETENTION_*` variables. Defaults:

| Data | Kept for |
| --- | --- |
| Message text | 90 days |
| Delivery history | 400 days |
| Audit log | 2 years |
| Deleted workspaces | Purged after 30 days |

Keep these in line with your privacy notice.

**Backups.**
- Back up MySQL daily and test a restore regularly.
- Exclude browser session volumes from general backups. If one is ever exposed, remove the affected numbers and re-link them.

**First deploy.**
1. Run `npx prisma migrate dev --name init` once locally and commit `backend/prisma/migrations`. CI requires it.
2. In production, run `npx prisma migrate deploy` before starting the API.

## Verification status

| Part | Status |
| --- | --- |
| Backend | `tsc` clean, including against the `whatsapp-web.js` typings. 27 unit tests pass (`npm test`), including two-step sign-in codes (expiry, attempt limit, no replay), log redaction and virus-scan parsing. They cover cross-tenant guard rejection, tenant-bound encryption, status progression and webhook dedup, file signatures, safe templating (a test caught a real `{{constructor}}` prototype leak, now fixed), and phone normalization. |
| Web | `tsc` clean. `next build` succeeds, including the privacy and terms pages and the sign-in code route. |
| Android | **Not compiled yet.** The sandbox used to write it couldn't reach Google's Maven repository, so a Gradle build wasn't possible. The Kotlin compiler confirmed every file parses, and the code was reviewed by hand. Expect to fix a few small compile issues on first sync in Android Studio. |
| Browser connector | Typechecked and reviewed, but **not run against WhatsApp Web**. The build sandbox had no access to `web.whatsapp.com`. Link a test number on the local stack before anything else. |
| Integration | Not run end-to-end against live MySQL/Redis. Run the local stack above before staging. |

Before production, work through blueprint §15–16:
- Threat-model review
- Load test
- Restore drill
- Legal review of WhatsApp's terms for browser automation, and of Indian privacy/marketing rules
- Tests that start MySQL/Redis containers and hit the real API
