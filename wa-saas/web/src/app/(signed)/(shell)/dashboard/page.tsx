'use client';
import Link from 'next/link';
import useSWR from 'swr';
import { Button, Loading, PageHead, Pill } from '@/components/ui';
import { CAMPAIGN_STATUS, fmtDate, fmtNum } from '@/lib/status';

interface Dash {
  connections: { total: number; connected: number; needsAttention: number };
  contacts: number; optOuts: number; activeCampaigns: number;
  messages: { used: number; limit: number };
  last7Days: { day: string; submitted: number; delivered: number; read: number; failed: number; unknown: number }[];
  recentCampaigns: { id: string; name: string; status: string; recipientCount: number; createdAt: string }[];
}

export default function Dashboard() {
  const { data } = useSWR<Dash>('/v1/dashboard', { refreshInterval: 30_000 });
  if (!data) return <Loading />;
  const pct = Math.min(100, Math.round((data.messages.used / Math.max(1, data.messages.limit)) * 100));
  const max = Math.max(1, ...data.last7Days.map((d) => d.submitted + d.failed + d.unknown));
  return (
    <>
      <PageHead title="Overview" sub="What’s happening across your workspace this month." actions={<Link href="/campaigns/new"><Button variant="primary">New campaign</Button></Link>} />

      {data.connections.connected === 0 && (
        <div className="callout" style={{ marginBottom: 20 }}>
          No WhatsApp number is connected yet. <Link href="/connections">Connect a number</Link> before launching a campaign.
        </div>
      )}
      {data.connections.needsAttention > 0 && (
        <div className="callout bad" style={{ marginBottom: 20 }}>
          {data.connections.needsAttention} connection{data.connections.needsAttention > 1 ? 's need' : ' needs'} attention. <Link href="/connections">Review connections</Link>
        </div>
      )}

      <div className="grid-3">
        <div className="panel">
          <p className="muted">Messages this month</p>
          <p className="figure num">{fmtNum(data.messages.used)} <span className="subtle">of {fmtNum(data.messages.limit)}</span></p>
          <div className="ladder" style={{ height: 8, marginTop: 10 }}><span className={pct > 90 ? 'failed' : 'delivered'} style={{ flexGrow: pct }} /><span style={{ flexGrow: 100 - pct }} /></div>
        </div>
        <div className="panel">
          <p className="muted">Contacts</p>
          <p className="figure num">{fmtNum(data.contacts)}</p>
          <p className="subtle">{fmtNum(data.optOuts)} opted out and never messaged</p>
        </div>
        <div className="panel">
          <p className="muted">Connected numbers</p>
          <p className="figure num">{data.connections.connected}<span className="subtle"> / {data.connections.total}</span></p>
          <p className="subtle">{data.activeCampaigns} campaign{data.activeCampaigns === 1 ? '' : 's'} in progress</p>
        </div>
      </div>

      <section className="section">
        <h2>Last 7 days</h2>
        <div className="panel">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 12, alignItems: 'end', height: 160 }}>
            {data.last7Days.map((d) => {
              const total = d.submitted + d.failed + d.unknown;
              return (
                <div key={d.day} style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 6, height: '100%', justifyContent: 'flex-end' }}
                  title={`${d.day}: ${d.submitted} accepted, ${d.delivered} delivered, ${d.read} read, ${d.failed} failed, ${d.unknown} unknown`}>
                  <div style={{ display: 'flex', flexDirection: 'column-reverse', height: `${(total / max) * 120}px`, minHeight: 2, borderRadius: 4, overflow: 'hidden', background: 'var(--surface-2)' }}>
                    <span style={{ flexGrow: d.read, background: 'var(--indigo)' }} />
                    <span style={{ flexGrow: Math.max(0, d.delivered - d.read), background: 'var(--pine)' }} />
                    <span style={{ flexGrow: Math.max(0, d.submitted - d.delivered), background: 'var(--slate-blue)' }} />
                    <span style={{ flexGrow: d.unknown, background: 'var(--unknown)' }} />
                    <span style={{ flexGrow: d.failed, background: 'var(--brick)' }} />
                  </div>
                  <span className="subtle" style={{ textAlign: 'center' }}>{new Date(d.day).toLocaleDateString(undefined, { weekday: 'short' })}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="section">
        <h2>Recent campaigns</h2>
        <div className="panel flush">
          {data.recentCampaigns.length === 0 ? <p className="muted" style={{ padding: 20 }}>No campaigns yet.</p> : (
            <table className="table"><tbody>
              {data.recentCampaigns.map((c) => (
                <tr key={c.id}>
                  <td><Link href={`/campaigns/${c.id}`}>{c.name}</Link></td>
                  <td><Pill tone={CAMPAIGN_STATUS[c.status]?.tone}>{CAMPAIGN_STATUS[c.status]?.label}</Pill></td>
                  <td className="num">{fmtNum(c.recipientCount)} recipients</td>
                  <td className="subtle">{fmtDate(c.createdAt)}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </div>
      </section>
    </>
  );
}
