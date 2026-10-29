'use client';
import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import { useCan, useToast } from '@/components/providers';
import { Button, Dialog, Empty, ErrorNote, Field, Input, Loading, PageHead, Pill, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtDate, fmtNum, RECIPIENT_STATUS } from '@/lib/status';
import type { Contact, Page } from '@/lib/types';
import { ContactTabs } from './tabs';

function ContactDialog({ id, onClose, onChanged }: { id: string | 'new' | null; onClose: () => void; onChanged: () => void }) {
  const isNew = id === 'new';
  const { data, mutate } = useSWR<Contact>(id && !isNew ? `/v1/contacts/${id}` : null);
  const canEdit = useCan('editor');
  const toast = useToast();
  const [form, setForm] = useState({ phone: '', displayName: '', tags: '', fields: '', consent: true, source: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const customFields = Object.fromEntries(form.fields.split('\n').map((l) => l.split('=')).filter((p) => p.length === 2 && p[0].trim()).map(([k, v]) => [k.trim(), v.trim()]));
      await api('/v1/contacts', { method: 'POST', body: {
        phone: form.phone, displayName: form.displayName || undefined, tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean), customFields,
        consent: form.consent ? { purpose: 'marketing', source: form.source || 'manual-entry' } : undefined,
      } });
      toast('Contact added.'); onChanged(); onClose();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try { await fn(); toast(msg); mutate(); onChanged(); } catch (e) { toast((e as Error).message, 'bad'); }
  };

  if (!id) return null;
  if (isNew) {
    return (
      <Dialog open onClose={onClose} title="Add contact" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Add contact</Button></>}>
        <ErrorNote error={error} />
        <Field label="Phone number" htmlFor="ph" hint="Include the country code, e.g. +91 98123 45678."><Input id="ph" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label="Name" htmlFor="nm"><Input id="nm" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></Field>
        <Field label="Tags" htmlFor="tg" hint="Comma-separated, e.g. vip, pune"><Input id="tg" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></Field>
        <Field label="Custom fields" htmlFor="cf" hint="One per line as key=value. Use them as {{key}} in messages.">
          <textarea id="cf" className="textarea" style={{ minHeight: 70 }} value={form.fields} onChange={(e) => setForm({ ...form, fields: e.target.value })} />
        </Field>
        <label className="check"><input type="checkbox" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} />
          <span>This person agreed to receive marketing messages from us.</span></label>
        {form.consent && <Field label="Where did they agree?" htmlFor="src" hint="e.g. checkout opt-in, in-store form"><Input id="src" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} /></Field>}
      </Dialog>
    );
  }
  return (
    <Dialog open onClose={onClose} title={data?.displayName || data?.phone || 'Contact'} footer={<Button onClick={onClose}>Close</Button>}>
      {!data ? <Loading /> : (
        <>
          <div className="row"><span className="num">{data.phone}</span>{data.optedOut && <Pill tone="bad">Opted out</Pill>}{data.status === 'blocked' && <Pill tone="warn">Blocked</Pill>}</div>
          {data.tags.length > 0 && <div className="row">{data.tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>}
          {Object.keys(data.customFields).length > 0 && <div className="subtle">{Object.entries(data.customFields).map(([k, v]) => <div key={k}><span className="mono">{`{{${k}}}`}</span> = {v}</div>)}</div>}
          <div>
            <h3>Consent</h3>
            {data.consents.length === 0 ? <p className="muted">No consent on record. Campaigns that require consent will skip this person.</p> :
              data.consents.map((c) => (
                <div key={c.id} className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}>
                  <span>{c.purpose} · <span className="subtle">{c.source}, {fmtDate(c.capturedAt, false)}</span></span>
                  {canEdit && <Button size="sm" variant="ghost" onClick={() => act(() => api(`/v1/contacts/${data.id}/consent/${c.id}`, { method: 'DELETE' }), 'Consent revoked.')}>Revoke</Button>}
                </div>
              ))}
            {canEdit && !data.consents.some((c) => c.purpose === 'marketing') && (
              <Button size="sm" style={{ marginTop: 8 }} onClick={() => act(() => api(`/v1/contacts/${data.id}/consent`, { method: 'POST', body: { purpose: 'marketing', source: 'manual-entry' } }), 'Consent recorded.')}>Record marketing consent</Button>
            )}
          </div>
          {data.history && data.history.length > 0 && (
            <div><h3>Recent messages</h3>
              {data.history.map((h) => <div key={h.campaignId} className="row" style={{ justifyContent: 'space-between' }}><Link href={`/campaigns/${h.campaignId}`}>{h.campaignName}</Link><Pill tone={RECIPIENT_STATUS[h.status]?.tone}>{RECIPIENT_STATUS[h.status]?.label}</Pill></div>)}
            </div>
          )}
          {canEdit && (
            <div className="row" style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>
              {!data.optedOut && <Button size="sm" onClick={() => act(() => api('/v1/opt-outs', { method: 'POST', body: { phone: data.phone, reason: 'Added by team' } }), 'Added to opt-out list.')}>Add to opt-outs</Button>}
              <Button size="sm" onClick={() => act(() => api(`/v1/contacts/${data.id}`, { method: 'PATCH', body: { status: data.status === 'blocked' ? 'active' : 'blocked' } }), data.status === 'blocked' ? 'Contact unblocked.' : 'Contact blocked.')}>{data.status === 'blocked' ? 'Unblock' : 'Block'}</Button>
              <Button size="sm" variant="ghost" onClick={async () => { await act(() => api(`/v1/contacts/${data.id}`, { method: 'DELETE' }), 'Contact deleted.'); onClose(); }}>Delete</Button>
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}

export default function ContactsPage() {
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('');
  const [openId, setOpenId] = useState<string | 'new' | null>(null);
  const canEdit = useCan('editor');
  const canAdmin = useCan('admin');
  const toast = useToast();
  const { data: tags } = useSWR<{ items: { tag: string; count: number }[] }>('/v1/contacts/tags');
  const qs = (cursor?: string | null) => `/v1/contacts?limit=50${search ? `&search=${encodeURIComponent(search)}` : ''}${tag ? `&tag=${encodeURIComponent(tag)}` : ''}${cursor ? `&cursor=${cursor}` : ''}`;
  const { data, size, setSize, mutate, isValidating } = useSWRInfinite<Page<Contact>>((i, prev) => (i === 0 ? qs() : prev?.nextCursor ? qs(prev.nextCursor) : null));
  const rows = data?.flatMap((p) => p.items) ?? [];
  const more = !!data?.[data.length - 1]?.nextCursor;

  const exportCsv = async () => {
    try {
      const res = await api<Response>('/v1/contacts-export', { raw: true });
      const blob = await res.blob();
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'contacts.csv' });
      a.click(); URL.revokeObjectURL(a.href);
    } catch (e) { toast((e as Error).message, 'bad'); }
  };

  return (
    <>
      <PageHead title="Contacts" sub={data ? `${fmtNum(data[0]?.total)} people` : undefined}
        actions={<>{canAdmin && <Button onClick={exportCsv}>Export CSV</Button>}{canEdit && <Button variant="primary" onClick={() => setOpenId('new')}>Add contact</Button>}</>} />
      <ContactTabs />
      <div className="row" style={{ marginBottom: 14 }}>
        <div style={{ flex: '1 1 260px' }}><Input type="search" placeholder="Search by name or number" aria-label="Search contacts" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div style={{ width: 200 }}>
          <Select aria-label="Filter by tag" value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">All tags</option>
            {tags?.items.map((t) => <option key={t.tag} value={t.tag}>{t.tag} ({t.count})</option>)}
          </Select>
        </div>
      </div>
      {!data ? <Loading /> : rows.length === 0 ? (
        <div className="panel"><Empty title={search || tag ? 'No matches' : 'No contacts yet'} body={search || tag ? 'Try a different search or tag.' : 'Import a spreadsheet or add people one at a time.'}
          action={!search && !tag && canEdit && <Link href="/contacts/import"><Button variant="primary">Import contacts</Button></Link>} /></div>
      ) : (
        <div className="panel flush table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>Phone</th><th>Tags</th><th>Consent</th><th>Added</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => setOpenId(c.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpenId(c.id)}>
                  <td>{c.displayName ?? <span className="subtle">No name</span>}</td>
                  <td className="num">{c.phone}</td>
                  <td><div className="row" style={{ gap: 4 }}>{c.tags.slice(0, 3).map((t) => <span key={t} className="tag">{t}</span>)}</div></td>
                  <td>{c.optedOut ? <Pill tone="bad">Opted out</Pill> : c.consents.some((x) => x.purpose === 'marketing') ? <Pill tone="good">Marketing</Pill> : <Pill>None</Pill>}</td>
                  <td className="subtle">{fmtDate(c.createdAt, false)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {more && <div style={{ marginTop: 14 }}><Button loading={isValidating} onClick={() => setSize(size + 1)}>Load more</Button></div>}
      <ContactDialog id={openId} onClose={() => setOpenId(null)} onChanged={() => mutate()} />
    </>
  );
}
