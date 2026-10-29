'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useCan, useToast, useWorkspace } from '@/components/providers';
import { Button, Dialog, Field, Input } from '@/components/ui';
import { api } from '@/lib/api';

export default function WorkspaceSettings() {
  const { current, refreshMe } = useWorkspace();
  const canAdmin = useCan('admin');
  const isOwner = useCan('owner');
  const toast = useToast();
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(false);
  const [typed, setTyped] = useState('');
  useEffect(() => setName(current?.tenant.name ?? ''), [current]);

  const save = async () => {
    setBusy(true);
    try { await api('/v1/tenants/current', { method: 'PATCH', body: { name } }); refreshMe(); toast('Workspace renamed.'); }
    catch (e) { toast((e as Error).message, 'bad'); } finally { setBusy(false); }
  };
  const remove = async () => {
    try { await api('/v1/tenants/current', { method: 'DELETE' }); toast('Workspace deleted.'); refreshMe(); router.replace('/workspaces'); }
    catch (e) { toast((e as Error).message, 'bad'); }
  };
  return (
    <div className="stack">
      <div className="panel stack">
        <h2>Workspace name</h2>
        <Field label="Name" htmlFor="wn"><Input id="wn" value={name} disabled={!canAdmin} onChange={(e) => setName(e.target.value)} /></Field>
        {canAdmin && <div><Button variant="primary" loading={busy} disabled={!name.trim() || name === current?.tenant.name} onClick={save}>Save name</Button></div>}
      </div>
      <div className="panel stack">
        <h2>Data retention</h2>
        <p className="muted">Uploaded import files are deleted after 7 days. Campaign media is kept for 180 days unless an active campaign uses it. Deleted contacts are anonymized immediately.</p>
      </div>
      {isOwner && (
        <div className="panel stack" style={{ borderColor: 'var(--brick)' }}>
          <h2>Delete workspace</h2>
          <p className="muted">Stops all campaigns, removes every connection and schedules all contacts, media and reports for deletion. This can’t be undone.</p>
          <div><Button variant="danger" onClick={() => { setTyped(''); setDel(true); }}>Delete workspace</Button></div>
        </div>
      )}
      <Dialog open={del} onClose={() => setDel(false)} title="Delete this workspace?"
        footer={<><Button variant="ghost" onClick={() => setDel(false)}>Keep workspace</Button><Button variant="danger" disabled={typed !== current?.tenant.name} onClick={remove}>Delete workspace</Button></>}>
        <Field label={`Type “${current?.tenant.name}” to confirm`} htmlFor="dt"><Input id="dt" value={typed} onChange={(e) => setTyped(e.target.value)} /></Field>
      </Dialog>
    </div>
  );
}
