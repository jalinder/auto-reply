'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import useSWR from 'swr';
import { useCan, useToast } from '@/components/providers';
import { Button, Dialog, Empty, ErrorNote, Field, Input, Loading, PageHead, Pill } from '@/components/ui';
import { api, newIdempotencyKey } from '@/lib/api';
import { CONNECTION_STATUS, CONNECTOR_NAMES, relTime } from '@/lib/status';
import type { Connection } from '@/lib/types';

const DESCRIPTIONS: Record<string, string> = {
  browser: 'Link your WhatsApp number by scanning a QR code, like WhatsApp Web. Supports text, images and PDFs, with delivered/read receipts.',
  sandbox: 'Simulated number for testing the full flow. Never messages real people.',
};

export default function ConnectionsPage() {
  const { data } = useSWR<{ items: Connection[] }>('/v1/connections');
  const { data: types } = useSWR<{ items: { type: string }[] }>('/v1/connections/types');
  const canAdmin = useCan('admin');
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('browser');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [idem] = useState(newIdempotencyKey);

  const create = async () => {
    setBusy(true); setError(null);
    try {
      const c = await api<Connection>('/v1/connections', {
        method: 'POST', headers: { 'Idempotency-Key': idem },
        body: { connectorType: type, label: label || CONNECTOR_NAMES[type] },
      });
      toast('Preparing your QR code…');
      router.push(`/connections/${c.id}`);
    } catch (e) { setError(e); setBusy(false); }
  };

  if (!data) return <Loading />;
  return (
    <>
      <PageHead title="WhatsApp numbers" sub="The business numbers your campaigns send from."
        actions={canAdmin && <Button variant="primary" onClick={() => setOpen(true)}>Connect a number</Button>} />
      {data.items.length === 0 ? (
        <div className="panel"><Empty title="No numbers connected" body="Connect your WhatsApp Business number to start sending campaigns." action={canAdmin && <Button variant="primary" onClick={() => setOpen(true)}>Connect a number</Button>} /></div>
      ) : (
        <div className="panel flush table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Account</th><th>Last seen</th></tr></thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => router.push(`/connections/${c.id}`)}>
                  <td><Link href={`/connections/${c.id}`}>{c.label}</Link></td>
                  <td className="muted">{CONNECTOR_NAMES[c.connectorType]}</td>
                  <td><Pill tone={CONNECTION_STATUS[c.status].tone}>{CONNECTION_STATUS[c.status].label}</Pill></td>
                  <td className="num">{c.maskedAccount ?? '—'}</td>
                  <td className="subtle">{relTime(c.lastSeenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} title="Connect a number"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" loading={busy} onClick={create}>Generate QR</Button></>}>
        <div className="choice-grid">
          {(types?.items ?? []).map((t) => (
            <button key={t.type} type="button" className="choice" aria-pressed={type === t.type} onClick={() => setType(t.type)}>
              <strong>{CONNECTOR_NAMES[t.type]}</strong>
              <p className="subtle" style={{ marginTop: 4 }}>{DESCRIPTIONS[t.type]}</p>
            </button>
          ))}
        </div>
        <ErrorNote error={error} />
        <Field label="Name" htmlFor="lbl" hint="Only your team sees this, e.g. “Support line”."><Input id="lbl" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} /></Field>
        <div className="callout">Use a number you control. Linking works like WhatsApp Web: the number stays linked until you remove it here or log it out from your phone. Sending in bulk this way can get a number restricted by WhatsApp, so only message people who opted in.</div>
      </Dialog>
    </>
  );
}
