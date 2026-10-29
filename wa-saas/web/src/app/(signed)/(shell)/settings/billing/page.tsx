'use client';
import useSWR from 'swr';
import { useCan, useToast } from '@/components/providers';
import { Button, Loading, Pill } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtDate, fmtNum } from '@/lib/status';

interface Plan { id: string; name: string; priceInrMonthly: number; limits: Record<string, number> }
interface Billing { plan: Plan; plans: Plan[]; usage: { messages: number; connections: number; contacts: number; members: number; periodEnd: string }; subscription: { status: string; periodEnd: string | null } | null }

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">{label}</span><span className="num">{fmtNum(used)} / {fmtNum(limit)}</span></div>
      <div className="ladder" style={{ height: 8, marginTop: 6 }}><span className={pct > 90 ? 'failed' : 'delivered'} style={{ flexGrow: pct }} /><span style={{ flexGrow: 100 - pct }} /></div>
    </div>
  );
}

export default function BillingPage() {
  const { data, mutate } = useSWR<Billing>('/v1/billing');
  const canSeeInvoices = useCan('admin');
  const { data: invoices } = useSWR<{ items: { id: string; amount: number; currency: string; status: string; issuedAt: string | null; url: string | null }[] }>(canSeeInvoices ? '/v1/billing/invoices' : null);
  const isOwner = useCan('owner');
  const toast = useToast();
  if (!data) return <Loading />;
  const subscribe = async (planId: string) => {
    try { const r = await api<{ checkoutUrl: string }>('/v1/billing/subscribe', { method: 'POST', body: { planId } }); window.location.href = r.checkoutUrl; }
    catch (e) { toast((e as Error).message, 'bad'); }
  };
  const cancel = async () => {
    if (!confirm('Cancel your subscription at the end of this billing period?')) return;
    try { await api('/v1/billing/cancel', { method: 'POST' }); toast('Subscription will end at the period close.'); mutate(); } catch (e) { toast((e as Error).message, 'bad'); }
  };
  const l = data.plan.limits;
  return (
    <div className="stack">
      <div className="panel stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{data.plan.name} plan</h2>
          {data.subscription && <Pill tone={data.subscription.status === 'active' ? 'good' : 'warn'}>{data.subscription.status}</Pill>}
        </div>
        <p className="subtle">Usage resets on {fmtDate(data.usage.periodEnd, false)}.</p>
        <div className="grid-2">
          <Meter label="Messages this month" used={data.usage.messages} limit={l.messagesPerMonth} />
          <Meter label="Contacts" used={data.usage.contacts} limit={l.contacts} />
          <Meter label="WhatsApp numbers" used={data.usage.connections} limit={l.connections} />
          <Meter label="Team members" used={data.usage.members} limit={l.members} />
        </div>
        {isOwner && data.subscription?.status === 'active' && <div><Button variant="ghost" onClick={cancel}>Cancel subscription</Button></div>}
      </div>
      <div className="grid-3">
        {data.plans.map((p) => (
          <div key={p.id} className="panel stack" style={p.id === data.plan.id ? { borderColor: 'var(--pine)' } : undefined}>
            <h2>{p.name}</h2>
            <p><span className="figure num">₹{fmtNum(p.priceInrMonthly)}</span><span className="subtle"> / month</span></p>
            <ul className="muted" style={{ margin: 0, paddingLeft: 18 }}>
              <li>{fmtNum(p.limits.messagesPerMonth)} messages / month</li>
              <li>{fmtNum(p.limits.contacts)} contacts</li>
              <li>{p.limits.connections} WhatsApp numbers</li>
              <li>{p.limits.members} team members</li>
            </ul>
            {p.id === data.plan.id ? <Pill tone="good">Current plan</Pill> : isOwner && p.id !== 'free' && <Button variant="primary" onClick={() => subscribe(p.id)}>Switch to {p.name}</Button>}
          </div>
        ))}
      </div>
      {canSeeInvoices && (
        <section className="stack">
          <h2>Invoices</h2>
          {!invoices ? <p className="muted">Loading invoices…</p> : invoices.items.length === 0 ? <p className="muted">No invoices yet.</p> : (
            <div className="panel flush table-wrap"><table className="table">
              <thead><tr><th>Date</th><th>Amount</th><th>Status</th><th /></tr></thead>
              <tbody>{invoices.items.map((i) => (
                <tr key={i.id}><td>{fmtDate(i.issuedAt, false)}</td><td className="num">{i.currency} {i.amount.toLocaleString()}</td><td>{i.status}</td>
                  <td style={{ textAlign: 'right' }}>{i.url && <a href={i.url} target="_blank" rel="noopener noreferrer">View invoice</a>}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
      )}
      <p className="subtle">Prices exclude GST. Plan limits apply per workspace.</p>
    </div>
  );
}
