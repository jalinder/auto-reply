'use client';
import QRCode from 'qrcode';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { useCan, useToast } from '@/components/providers';
import { Button, Dialog, Field, Input, Loading, PageHead, Pill } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { CONNECTION_STATUS, CONNECTOR_NAMES, fmtDate } from '@/lib/status';
import type { Connection } from '@/lib/types';

/** Alternative to scanning: WhatsApp → Linked devices → Link with phone number instead. */
function PairingCode({ id }: { id: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const request = async () => {
    setBusy(true);
    try { const r = await api<{ code: string }>(`/v1/connections/${id}/pairing-code`, { method: 'POST', body: { phone } }); setCode(r.code); }
    catch (e) { toast((e as Error).message, 'bad'); } finally { setBusy(false); }
  };
  if (!open) return <div><Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Can’t scan? Link with a code instead</Button></div>;
  return (
    <div className="panel stack">
      {code ? (
        <>
          <p className="muted">On the phone, open WhatsApp → <strong>Linked devices → Link a device → Link with phone number instead</strong>, then enter:</p>
          <p className="figure num" style={{ letterSpacing: '0.2em' }} aria-label={`Pairing code ${code.split('').join(' ')}`}>{code.slice(0, 4)}-{code.slice(4)}</p>
          <p className="subtle">The code expires in about 3 minutes. Never share it with anyone.</p>
          <div><Button size="sm" onClick={() => setCode(null)}>Get a new code</Button></div>
        </>
      ) : (
        <>
          <Field label="WhatsApp number to link" htmlFor="pair-ph" hint="Include the country code, e.g. +91 98123 45678.">
            <Input id="pair-ph" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <div className="row"><Button variant="primary" loading={busy} disabled={phone.length < 8} onClick={request}>Get pairing code</Button><Button variant="ghost" onClick={() => setOpen(false)}>Use QR instead</Button></div>
        </>
      )}
    </div>
  );
}

function QrPanel({ c }: { c: Connection }) {
  const toast = useToast();
  const [img, setImg] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const waiting = c.status === 'waiting_for_qr';
  const { data: qr, error, mutate } = useSWR<{ payload: string; expiresAt: string; ttlSeconds: number }>(waiting ? `/v1/connections/${c.id}/qr` : null, { revalidateOnFocus: false });

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!qr?.payload) { setImg(null); return; }
    QRCode.toDataURL(qr.payload, { margin: 0, width: 480, errorCorrectionLevel: 'M' }).then(setImg);
  }, [qr?.payload]);

  const remaining = qr ? Math.max(0, Math.round((new Date(qr.expiresAt).getTime() - now) / 1000)) : 0;
  // Browser sessions rotate the code automatically; only the final timeout counts as expired.
  const expired = c.status === 'qr_expired' || (waiting && c.connectorType !== 'browser' && (remaining === 0 || (error as ApiError)?.code === 'QR_EXPIRED'));
  const act = async (name: string, path: string) => {
    setBusy(name);
    try { await api(path, { method: 'POST' }); await mutate(); } catch (e) { toast((e as Error).message, 'bad'); } finally { setBusy(null); }
  };

  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <div className="stack" style={{ alignItems: 'flex-start' }}>
        <div className={`qr-frame ${expired || c.status === 'linking' ? 'dim' : ''}`}>
          {img && <img src={img} alt="QR code to link this WhatsApp number" />}
          {(expired || c.status === 'linking' || !img) && (
            <div className="qr-overlay">
              {c.status === 'linking' ? <div className="stack" style={{ alignItems: 'center' }}><span className="spinner" /><strong>Linking your number…</strong></div>
                : c.status === 'created' ? <div className="stack" style={{ alignItems: 'center' }}><span className="spinner" /><strong>Starting a secure session…</strong><span className="subtle">This takes up to a minute.</span></div>
                : expired ? <div className="stack" style={{ alignItems: 'center' }}><strong>This QR expired</strong><Button variant="primary" loading={busy === 'refresh'} onClick={() => act('refresh', `/v1/connections/${c.id}/refresh-qr`)}>Get a new QR</Button></div>
                : <span className="spinner" />}
            </div>
          )}
        </div>
        {waiting && !expired && (
          <>
            <div className="countdown" aria-hidden><span style={{ width: `${(remaining / (qr?.ttlSeconds ?? 60)) * 100}%` }} /></div>
            <p className="subtle" aria-live="polite">{c.connectorType === 'browser' ? `New code in ${remaining}s — scanning any shown code works` : `Expires in ${remaining}s`}</p>
          </>
        )}
        <div className="row">
          {!expired && waiting && <Button size="sm" loading={busy === 'refresh'} onClick={() => act('refresh', `/v1/connections/${c.id}/refresh-qr`)}>Refresh QR</Button>}
          <Button size="sm" variant="ghost" loading={busy === 'cancel'} onClick={() => act('cancel', `/v1/connections/${c.id}/cancel`)}>Cancel linking</Button>
        </div>
      </div>
      <div className="stack">
        <h2>Scan with WhatsApp on your phone</h2>
        <ol className="steps muted">
          <li>Open WhatsApp on the phone that owns this business number.</li>
          <li>Go to <strong>Settings → Linked devices → Link a device</strong>.</li>
          <li>Point the camera at this QR code.</li>
        </ol>
        <div className="callout">We will never ask for your WhatsApp two-step verification PIN. If anything asks you for it here, don’t enter it.</div>
        {waiting && !expired && <PairingCode id={c.id} />}
        {c.connectorType === 'sandbox' && waiting && !expired && (
          <div className="panel stack">
            <p className="muted">This is a sandbox number, so no phone is needed.</p>
            <div><Button variant="primary" loading={busy === 'scan'} onClick={() => act('scan', `/v1/connections/${c.id}/sandbox/scan`)}>Simulate scan</Button></div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ConnectionDetail({ params }: { params: { id: string } }) {
  const { data: c, mutate } = useSWR<Connection>(`/v1/connections/${params.id}`);
  const { data: events } = useSWR<{ items: { id: string; eventType: string; createdAt: string }[] }>(`/v1/connections/${params.id}/events`);
  const canAdmin = useCan('admin');
  const router = useRouter();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!c) return <Loading />;
  const st = CONNECTION_STATUS[c.status];
  const linking = ['created', 'waiting_for_qr', 'linking', 'qr_expired'].includes(c.status);
  const canRelink = c.capabilities?.qrLinking && ['disconnected', 'error'].includes(c.status);

  const remove = async () => {
    setBusy(true);
    try { await api(`/v1/connections/${c.id}`, { method: 'DELETE' }); toast('Connection removed. Campaigns using it were paused.'); router.push('/connections'); }
    catch (e) { toast((e as Error).message, 'bad'); setBusy(false); setConfirm(false); }
  };
  const relink = async () => {
    try { await api(`/v1/connections/${c.id}/refresh-qr`, { method: 'POST' }); mutate(); } catch (e) { toast((e as Error).message, 'bad'); }
  };

  return (
    <>
      <p className="subtle"><Link href="/connections">WhatsApp numbers</Link> /</p>
      <PageHead title={c.label} sub={<span className="row"><Pill tone={st.tone}>{st.label}</Pill><span>{CONNECTOR_NAMES[c.connectorType]}</span></span>}
        actions={canAdmin && c.status !== 'revoked' && <>
          {canRelink && <Button variant="primary" onClick={relink}>Reconnect</Button>}
          <Button variant="ghost" onClick={() => setConfirm(true)}>Remove</Button>
        </>} />

      {canAdmin && linking && c.capabilities?.qrLinking ? <div className="panel"><QrPanel c={c} /></div> : (
        <div className="grid-3">
          <div className="panel"><p className="muted">Account</p><p className="figure num" style={{ fontSize: '1.4rem' }}>{c.maskedAccount ?? '—'}</p></div>
          <div className="panel"><p className="muted">Connected</p><p style={{ fontWeight: 600 }}>{fmtDate(c.connectedAt)}</p></div>
          <div className="panel"><p className="muted">Last health check</p><p style={{ fontWeight: 600 }}>{fmtDate(c.lastSeenAt)}</p></div>
        </div>
      )}
      {c.lastErrorCode && c.status !== 'connected' && <div className="callout bad section">Last error: <span className="mono">{c.lastErrorCode}</span>. {c.lastErrorCode === 'LOGGED_OUT_ON_PHONE' ? 'This number was logged out from the phone (Linked devices). Reconnect and scan a new QR to continue.' : 'Try reconnecting. If it keeps happening, contact support with this code.'}</div>}

      {c.capabilities && (
        <section className="section">
          <h2>What this number can do</h2>
          <div className="panel row" style={{ gap: 18 }}>
            <span>{c.capabilities.templates ? '✓' : '—'} Approved templates</span>
            <span>{c.capabilities.media.length ? '✓' : '—'} Media ({c.capabilities.media.join(', ') || 'none'})</span>
            <span>{c.capabilities.deliveryReceipts ? '✓' : '—'} Delivery receipts</span>
            <span>{c.capabilities.readReceipts ? '✓' : '—'} Read receipts</span>
          </div>
        </section>
      )}

      <section className="section">
        <h2>Activity</h2>
        <div className="panel">
          <ul className="timeline">
            {(events?.items ?? []).map((e) => {
              const s = e.eventType.replace('status.', '');
              return <li key={e.id}><span className="dot" /><span>{CONNECTION_STATUS[s]?.label ?? s}</span><span className="subtle">{fmtDate(e.createdAt)}</span></li>;
            })}
          </ul>
        </div>
      </section>

      <Dialog open={confirm} onClose={() => setConfirm(false)} title="Remove this number?"
        description="Sending stops right away and any running campaigns on this number are paused. Stored credentials are deleted."
        footer={<><Button variant="ghost" onClick={() => setConfirm(false)}>Keep number</Button><Button variant="danger" loading={busy} onClick={remove}>Remove number</Button></>}>
        <p className="muted">You’ll be asked for your password to confirm.</p>
      </Dialog>
    </>
  );
}
