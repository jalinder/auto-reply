'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useWorkspace } from '@/components/providers';
import { Button, ErrorNote, Field, Input, Loading } from '@/components/ui';
import { api } from '@/lib/api';
import { ROLE_LABEL } from '@/lib/status';

export default function WorkspacesPage() {
  const { me, switchTo, refreshMe } = useWorkspace();
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const open = async (id: string) => { await switchTo(id); router.push('/dashboard'); };
  const create = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { const r = await api('/v1/tenants', { method: 'POST', body: { name } }); refreshMe(); await open(r.tenant.id); }
    catch (err) { setError(err); setBusy(false); }
  };
  if (!me) return <Loading />;
  return (
    <main style={{ maxWidth: 560, margin: '64px auto', padding: '0 16px' }} className="stack">
      <div className="brand"><span className="brand-mark">R</span>Relay</div>
      <h1>Choose a workspace</h1>
      <p className="muted">Signed in as {me.user.email}. Each workspace keeps its own contacts, connections and campaigns.</p>
      <div className="panel flush">
        <table className="table"><tbody>
          {me.memberships.map((m) => (
            <tr key={m.tenant.id} className="clickable" onClick={() => open(m.tenant.id)}>
              <td><strong>{m.tenant.name}</strong><div className="subtle">{ROLE_LABEL[m.role]} · {m.tenant.planId} plan</div></td>
              <td style={{ textAlign: 'right' }}><Button size="sm">Open</Button></td>
            </tr>
          ))}
        </tbody></table>
      </div>
      <form className="panel stack" onSubmit={create}>
        <h2>New workspace</h2>
        <ErrorNote error={error} />
        <Field label="Business name" htmlFor="ws"><Input id="ws" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div><Button variant="primary" type="submit" loading={busy}>Create workspace</Button></div>
      </form>
    </main>
  );
}
