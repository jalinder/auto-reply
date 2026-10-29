'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { useCan, useToast, useWorkspace } from '@/components/providers';
import { Button, ErrorNote, Field, Input, Loading, Pill, Select } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtDate, ROLE_LABEL } from '@/lib/status';

interface Member { userId: string; email: string; name: string; role: string; pending: boolean; joinedAt: string }
const ROLE_HELP: Record<string, string> = {
  admin: 'Manage numbers, team and opt-outs, plus everything editors can do.',
  editor: 'Create and send campaigns, manage contacts.',
  viewer: 'See reports and contacts, no changes.',
};

export default function TeamPage() {
  const { data, mutate } = useSWR<{ items: Member[] }>('/v1/members');
  const { me } = useWorkspace();
  const canAdmin = useCan('admin');
  const isOwner = useCan('owner');
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api('/v1/members', { method: 'POST', body: { email, role } }); setEmail(''); mutate(); toast('Invitation sent.'); }
    catch (err) { setError(err); } finally { setBusy(false); }
  };
  const change = async (userId: string, r: string) => {
    try { await api(`/v1/members/${userId}`, { method: 'PATCH', body: { role: r } }); mutate(); toast('Role updated.'); } catch (e) { toast((e as Error).message, 'bad'); }
  };
  const remove = async (m: Member) => {
    if (!confirm(`Remove ${m.name} from this workspace?`)) return;
    try { await api(`/v1/members/${m.userId}`, { method: 'DELETE' }); mutate(); } catch (e) { toast((e as Error).message, 'bad'); }
  };
  if (!data) return <Loading />;
  return (
    <div className="stack">
      {canAdmin && (
        <form className="panel stack" onSubmit={invite}>
          <h2>Invite a teammate</h2>
          <ErrorNote error={error} />
          <div className="grid-2">
            <Field label="Email" htmlFor="ie"><Input id="ie" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Role" htmlFor="ir" hint={ROLE_HELP[role]}><Select id="ir" value={role} onChange={(e) => setRole(e.target.value)}>{['admin', 'editor', 'viewer'].map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</Select></Field>
          </div>
          <div><Button variant="primary" type="submit" loading={busy}>Send invitation</Button></div>
        </form>
      )}
      <div className="panel flush table-wrap">
        <table className="table">
          <thead><tr><th>Person</th><th>Role</th><th>Joined</th><th /></tr></thead>
          <tbody>
            {data.items.map((m) => {
              const self = m.userId === me?.user.id;
              const editable = canAdmin && !self && (isOwner || m.role !== 'owner');
              return (
                <tr key={m.userId}>
                  <td><strong>{m.name}</strong>{self && <span className="subtle"> (you)</span>}<div className="subtle">{m.email}</div></td>
                  <td>{editable ? (
                    <Select aria-label={`Role for ${m.name}`} value={m.role} onChange={(e) => change(m.userId, e.target.value)}>
                      {(isOwner ? ['owner', 'admin', 'editor', 'viewer'] : ['admin', 'editor', 'viewer']).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </Select>) : ROLE_LABEL[m.role]}</td>
                  <td>{m.pending ? <Pill tone="warn">Invite pending</Pill> : <span className="subtle">{fmtDate(m.joinedAt, false)}</span>}</td>
                  <td style={{ textAlign: 'right' }}>{editable && <Button size="sm" variant="ghost" onClick={() => remove(m)}>Remove</Button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
