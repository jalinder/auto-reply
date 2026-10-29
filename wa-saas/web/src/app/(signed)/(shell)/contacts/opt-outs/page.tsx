'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { useCan, useToast } from '@/components/providers';
import { Button, Empty, ErrorNote, Field, Input, Loading, PageHead } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/status';
import type { Page } from '@/lib/types';
import { ContactTabs } from '../tabs';

const SOURCE: Record<string, string> = { manual: 'Added by team', inbound_keyword: 'Replied STOP', import: 'Import', api: 'API' };

export default function OptOutsPage() {
  const { data, mutate } = useSWR<Page<{ id: string; phone: string; reason: string | null; source: string; createdAt: string }>>('/v1/opt-outs?limit=200');
  const canEdit = useCan('editor');
  const canAdmin = useCan('admin');
  const toast = useToast();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<unknown>(null);
  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    try { await api('/v1/opt-outs', { method: 'POST', body: { phone } }); setPhone(''); mutate(); toast('Number added. Queued messages to it were skipped.'); }
    catch (err) { setError(err); }
  };
  const remove = async (id: string) => {
    if (!confirm('Only remove a number if the person asked to hear from you again. Continue?')) return;
    try { await api(`/v1/opt-outs/${id}`, { method: 'DELETE' }); mutate(); } catch (e) { toast((e as Error).message, 'bad'); }
  };
  return (
    <>
      <PageHead title="Contacts" />
      <ContactTabs />
      <p className="muted" style={{ marginBottom: 16 }}>Numbers here are never messaged, even if they’re in a campaign audience. People who reply STOP are added automatically.</p>
      {canEdit && (
        <form className="panel row" style={{ marginBottom: 16, alignItems: 'flex-end' }} onSubmit={add}>
          <div style={{ flex: 1 }}><Field label="Add a number" htmlFor="oo"><Input id="oo" type="tel" placeholder="+91 98123 45678" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field></div>
          <Button variant="primary" type="submit" disabled={!phone}>Add to opt-outs</Button>
        </form>
      )}
      <ErrorNote error={error} />
      {!data ? <Loading /> : data.items.length === 0 ? <div className="panel"><Empty title="No opt-outs" body="When someone asks to stop hearing from you, they’ll appear here." /></div> : (
        <div className="panel flush table-wrap">
          <table className="table"><thead><tr><th>Number</th><th>Source</th><th>Reason</th><th>Added</th><th /></tr></thead>
            <tbody>{data.items.map((o) => (
              <tr key={o.id}><td className="num">{o.phone}</td><td>{SOURCE[o.source] ?? o.source}</td><td className="muted">{o.reason ?? '—'}</td><td className="subtle">{fmtDate(o.createdAt)}</td>
                <td style={{ textAlign: 'right' }}>{canAdmin && <Button size="sm" variant="ghost" onClick={() => remove(o.id)}>Remove</Button>}</td></tr>
            ))}</tbody></table>
        </div>
      )}
    </>
  );
}
