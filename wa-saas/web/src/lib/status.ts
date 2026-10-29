/** One vocabulary for statuses across the app. Labels only claim what evidence supports. */
type Tone = 'good' | 'warn' | 'bad' | 'info' | 'read' | 'neutral';

export const CONNECTION_STATUS: Record<string, { label: string; tone: Tone }> = {
  created: { label: 'Connecting', tone: 'neutral' },
  waiting_for_qr: { label: 'Waiting for scan', tone: 'info' },
  linking: { label: 'Linking', tone: 'info' },
  connected: { label: 'Connected', tone: 'good' },
  qr_expired: { label: 'QR expired', tone: 'warn' },
  disconnected: { label: 'Disconnected', tone: 'warn' },
  error: { label: 'Needs attention', tone: 'bad' },
  revoked: { label: 'Removed', tone: 'neutral' },
};

export const CAMPAIGN_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  scheduled: { label: 'Scheduled', tone: 'info' },
  running: { label: 'Sending', tone: 'good' },
  paused: { label: 'Paused', tone: 'warn' },
  completed: { label: 'Finished', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export const RECIPIENT_STATUS: Record<string, { label: string; tone: Tone; help: string }> = {
  queued: { label: 'Queued', tone: 'neutral', help: 'Waiting for its turn to send.' },
  attempting: { label: 'Attempting', tone: 'info', help: 'Being handed to WhatsApp right now.' },
  submitted: { label: 'Accepted', tone: 'info', help: 'WhatsApp accepted the message. Delivery not yet confirmed.' },
  delivered: { label: 'Delivered', tone: 'good', help: 'WhatsApp confirmed it reached the phone.' },
  read: { label: 'Read', tone: 'read', help: 'WhatsApp reported the recipient opened it.' },
  failed: { label: 'Failed', tone: 'bad', help: 'Not sent. See the reason code.' },
  unknown: { label: 'Unknown', tone: 'warn', help: 'We can’t prove whether it was sent (e.g. a timeout). It won’t be retried automatically.' },
  skipped: { label: 'Skipped', tone: 'neutral', help: 'Excluded before sending, e.g. the person opted out.' },
  cancelled: { label: 'Cancelled', tone: 'neutral', help: 'The campaign was cancelled before this send.' },
};

export const PAUSE_REASONS: Record<string, string> = {
  USER_PAUSED: 'Paused by a teammate.',
  CONNECTION_NOT_READY: 'Paused because the WhatsApp connection isn’t connected.',
  CONNECTION_UNHEALTHY: 'Paused because the connection stopped responding.',
  CONNECTION_REVOKED: 'Paused because the connection was removed.',
  QUOTA_EXHAUSTED: 'Paused because this month’s message allowance is used up.',
  DAILY_LIMIT_REACHED: 'Paused because this number reached its daily sending limit. Resume tomorrow, or spread the audience across more numbers.',
};

export const CONNECTOR_NAMES: Record<string, string> = {
  browser: 'WhatsApp (linked device)',
  sandbox: 'Sandbox (test only)',
};

export const ROLE_LABEL: Record<string, string> = { owner: 'Owner', admin: 'Admin', editor: 'Editor', viewer: 'Viewer' };

export function fmtDate(s: string | null | undefined, withTime = true) {
  if (!s) return '—';
  const d = new Date(s);
  return d.toLocaleString(undefined, withTime ? { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' } : { day: 'numeric', month: 'short', year: 'numeric' });
}
export function fmtNum(n: number | undefined) {
  return (n ?? 0).toLocaleString();
}
export function relTime(s: string | null | undefined) {
  if (!s) return '—';
  const diff = (Date.now() - new Date(s).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return fmtDate(s, false);
}
