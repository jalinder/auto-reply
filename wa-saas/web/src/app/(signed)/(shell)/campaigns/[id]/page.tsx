'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import useSWR from 'swr';
import { Ladder } from '@/components/ladder';
import { useCan, useToast } from '@/components/providers';
import { Button, Dialog, ErrorNote, Input, Loading, PageHead, Pill } from '@/components/ui';
import { api, newIdempotencyKey } from '@/lib/api';
import { CAMPAIGN_STATUS, fmtDate, fmtNum, PAUSE_REASONS, RECIPIENT_STATUS } from '@/lib/status';
import type { Campaign, Preview } from '@/lib/types';

interface ReportRow { id: string; phone: string; displayName: string | null; status: string; attemptCount: number; lastErrorCode: string | null; updatedAt: string }

function DraftView({ c, onLaunched }: { c: Campaign; onLaunched: () => void }) {
  const { data: p, error, mutate, isValidating } = useSWR<Preview>(`/v1/campaigns/${c.id}/preview`, (k: string) => api(k, { method: 'POST' }), { revalidateOnFocus: false });
  const canEdit = useCan('editor');
  const toast = useToast();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [launchErr, setLaunchErr] = useState<unknown>(null);
  const [idem] = useState(newIdempotencyKey);

  const launch = async () => {
    setBusy(true); setLaunchErr(null);
    try {
      await api(`/v1/campaigns/${c.id}/launch`, { method: 'POST', headers: { 'Idempotency-Key': idem }, body: { confirm: true, expectedRecipientCount: p!.audience.eligible } });
      toast(c.scheduledAt ? 'Campaign scheduled.' : 'Campaign launched.'); setConfirming(false); onLaunched();
    } catch (e: any) { setLaunchErr(e); if (e.code === 'AUDIENCE_CHANGED') mutate(); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!confirm('Delete this draft?')) return;
    await api(`/v1/campaigns/${c.id}`, { method: 'DELETE' }); router.push('/campaigns');
  };

  if (error) return <ErrorNote error={error} />;
  if (!p) return <Loading label="Building preview" />;
  const ex = p.audience.excluded;
  return (
    <div className="stack">
      <div className="grid-2" style={{ alignItems: 'start' }}>
        <div className="panel stack">
          <h2>Audience</h2>
          <p><span className="figure num">{fmtNum(p.audience.eligible)}</span> <span className="muted">will receive this</span></p>
          <ul className="muted" style={{ margin: 0, paddingLeft: 18 }}>
            <li>{fmtNum(p.audience.selected)} selected</li>
            {ex.optedOut > 0 && <li>{fmtNum(ex.optedOut)} excluded — opted out</li>}
            {ex.noConsent > 0 && <li>{fmtNum(ex.noConsent)} excluded — no marketing consent</li>}
            {ex.blocked > 0 && <li>{fmtNum(ex.blocked)} excluded — blocked</li>}
          </ul>
          <p className="subtle">Sending from {p.connection.label} {p.connection.maskedAccount ? `(${p.connection.maskedAccount})` : ''} · {fmtNum(p.messagesRemaining)} messages left this month</p>
        </div>
        <div className="phone-preview stack" style={{ gap: 10 }}>
          <p className="subtle">Rendered for real recipients</p>
          {p.samples.map((s) => (
            <div key={s.contact.id}>
              <p className="subtle">{s.contact.displayName ?? s.contact.phone}</p>
              <div className="bubble">{s.rendered || <span className="subtle">(empty)</span>}</div>
              {s.missing.length > 0 && <p className="subtle" style={{ color: 'var(--unknown)' }}>Missing: {s.missing.join(', ')}</p>}
            </div>
          ))}
        </div>
      </div>
      {p.errors.map((e) => <div key={e} className="callout bad">{e}</div>)}
      {p.warnings.map((w) => <div key={w} className="callout">{w}</div>)}
      {canEdit && (
        <div className="row">
          <Button variant="primary" disabled={!p.canLaunch} onClick={() => { setTyped(''); setLaunchErr(null); setConfirming(true); }}>{c.scheduledAt ? 'Schedule campaign' : 'Review and launch'}</Button>
          <Link href={`/campaigns/${c.id}/edit`}><Button>Edit draft</Button></Link>
          <Button variant="ghost" loading={isValidating} onClick={() => mutate()}>Refresh preview</Button>
          <Button variant="ghost" onClick={remove}>Delete draft</Button>
        </div>
      )}
      <Dialog open={confirming} onClose={() => setConfirming(false)} title={c.scheduledAt ? 'Schedule this campaign?' : 'Send this campaign now?'}
        description={`${fmtNum(p.audience.eligible)} people will get this message from ${p.connection.label}${c.scheduledAt ? ` on ${fmtDate(c.scheduledAt)}` : ''}. You can pause it at any time, but sent messages can’t be recalled.`}
        footer={<><Button variant="ghost" onClick={() => setConfirming(false)}>Go back</Button><Button variant="primary" loading={busy} disabled={typed !== String(p.audience.eligible)} onClick={launch}>{c.scheduledAt ? 'Schedule' : `Send to ${fmtNum(p.audience.eligible)}`}</Button></>}>
        <ErrorNote error={launchErr} />
        <label className="field"><span style={{ fontWeight: 600 }}>Type <span className="num">{p.audience.eligible}</span> to confirm the recipient count</span>
          <Input inputMode="numeric" autoFocus value={typed} onChange={(e) => setTyped(e.target.value.trim())} /></label>
      </Dialog>
    </div>
  );
}

function Monitor({ c, refresh }: { c: Campaign; refresh: () => void }) {
  const [filter, setFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<ReportRow | null>(null);
  const canEdit = useCan('editor');
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const live = ['running', 'scheduled'].includes(c.status);
  const statusQ = filter === 'queued' ? 'queued' : filter;
  const { data: report } = useSWR<{ items: ReportRow[]; counts: Record<string, number> }>(
    `/v1/campaigns/${c.id}/report?limit=100${statusQ ? `&status=${statusQ}` : ''}${search ? `&search=${encodeURIComponent(search)}` : ''}`,
    { refreshInterval: live ? 5000 : 0 });
  const { data: tl } = useSWR<{ recipient: { renderedBody: string | null; renderedParams: string[] | null }; items: { id: string; eventType: string; source: string; occurredAt: string; detail: string | null }[] }>(open ? `/v1/campaigns/${c.id}/recipients/${open.id}/events` : null);

  const act = async (name: string) => {
    if (name === 'cancel' && !confirm('Cancel this campaign? Queued messages won’t be sent. This can’t be undone.')) return;
    setBusy(name);
    try { await api(`/v1/campaigns/${c.id}/${name}`, { method: 'POST' }); refresh(); } catch (e) { toast((e as Error).message, 'bad'); } finally { setBusy(null); }
  };

  return (
    <div className="stack">
      {c.status === 'paused' && c.pausedReason && <div className="callout">{PAUSE_REASONS[c.pausedReason] ?? 'Paused.'}</div>}
      {c.status === 'scheduled' && <div className="callout good">Scheduled for {fmtDate(c.scheduledAt)}.</div>}
      <div className="panel">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
          <h2>Outcomes</h2>
          {canEdit && (
            <div className="row">
              {['running', 'scheduled'].includes(c.status) && <Button loading={busy === 'pause'} onClick={() => act('pause')}>Pause</Button>}
              {c.status === 'paused' && <Button variant="primary" loading={busy === 'resume'} onClick={() => act('resume')}>Resume</Button>}
              {['running', 'scheduled', 'paused'].includes(c.status) && <Button variant="ghost" loading={busy === 'cancel'} onClick={() => act('cancel')}>Cancel campaign</Button>}
            </div>
          )}
        </div>
        <Ladder big counts={report?.counts ?? c.counts} selected={filter} onSelect={setFilter} />
        <p className="subtle" style={{ marginTop: 10 }}>“Accepted” means WhatsApp took the message; “Delivered” and “Read” appear only when WhatsApp confirms them. “Unknown” sends are never retried automatically, to avoid duplicates.</p>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Recipients {filter && <span className="subtle">· {RECIPIENT_STATUS[filter]?.label}</span>}</h2>
        <div style={{ width: 240 }}><Input type="search" placeholder="Search number" aria-label="Search recipients" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      </div>
      <div className="panel flush table-wrap">
        {!report ? <Loading /> : (
          <table className="table">
            <thead><tr><th>Recipient</th><th>Status</th><th>Detail</th><th>Updated</th></tr></thead>
            <tbody>
              {report.items.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => setOpen(r)}>
                  <td>{r.displayName ?? r.phone}<div className="subtle num">{r.displayName ? r.phone : ''}</div></td>
                  <td><Pill tone={RECIPIENT_STATUS[r.status]?.tone} title={RECIPIENT_STATUS[r.status]?.help}>{RECIPIENT_STATUS[r.status]?.label}</Pill></td>
                  <td className="subtle">{r.lastErrorCode ? <span className="mono">{r.lastErrorCode}</span> : r.attemptCount > 1 ? `${r.attemptCount} attempts` : ''}</td>
                  <td className="subtle">{fmtDate(r.updatedAt)}</td>
                </tr>
              ))}
              {report.items.length === 0 && <tr><td colSpan={4} className="muted" style={{ textAlign: 'center' }}>No recipients match.</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      <Dialog open={!!open} onClose={() => setOpen(null)} title={open?.displayName ?? open?.phone ?? ''} footer={<Button onClick={() => setOpen(null)}>Close</Button>}>
        {!tl ? <Loading /> : (
          <>
            <div className="bubble">{tl.recipient.renderedBody ?? (tl.recipient.renderedParams ?? []).join(' | ')}</div>
            <ul className="timeline">
              {tl.items.map((e) => (
                <li key={e.id}>
                  <span className="dot" style={{ background: e.eventType === 'failed' ? 'var(--brick)' : e.eventType === 'read' ? 'var(--indigo)' : e.eventType === 'delivered' ? 'var(--pine)' : e.eventType === 'unknown' ? 'var(--unknown)' : undefined }} />
                  <span>{RECIPIENT_STATUS[e.eventType]?.label ?? e.eventType.replace('_', ' ')}{e.detail && <span className="subtle"> · <span className="mono">{e.detail}</span></span>}<div className="subtle">{e.source === 'webhook' ? 'Reported by WhatsApp' : e.source === 'connector' ? 'Provider response' : 'Relay'}</div></span>
                  <span className="subtle">{fmtDate(e.occurredAt)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Dialog>
    </div>
  );
}

export default function CampaignDetail({ params }: { params: { id: string } }) {
  const { data: c, mutate } = useSWR<Campaign>(`/v1/campaigns/${params.id}`);
  if (!c) return <Loading />;
  const st = CAMPAIGN_STATUS[c.status];
  return (
    <>
      <p className="subtle"><Link href="/campaigns">Campaigns</Link> /</p>
      <PageHead title={c.name} sub={<span className="row"><Pill tone={st.tone}>{st.label}</Pill>{c.launchedAt && <span>Launched {fmtDate(c.launchedAt)}</span>}{c.recipientCount > 0 && <span className="num">{fmtNum(c.recipientCount)} recipients</span>}</span>} />
      {c.status === 'draft' ? <DraftView c={c} onLaunched={() => mutate()} /> : <Monitor c={c} refresh={() => mutate()} />}
    </>
  );
}
