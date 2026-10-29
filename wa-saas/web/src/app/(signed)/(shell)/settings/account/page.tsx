'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useToast, useWorkspace } from '@/components/providers';
import { Button, ErrorNote, Field, Input } from '@/components/ui';
import { api } from '@/lib/api';

export default function AccountPage() {
  const { me, refreshMe } = useWorkspace();
  const toast = useToast();
  const router = useRouter();
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const change = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api('/v1/auth/change-password', { method: 'POST', body: pw }); toast('Password changed. Sign in again.'); router.replace('/login'); }
    catch (err) { setError(err); } finally { setBusy(false); }
  };
  const toggle2fa = async () => {
    const enabled = !me?.user.twoFactorEnabled;
    try { await api('/v1/auth/2fa', { method: 'POST', body: { enabled } }); refreshMe(); toast(enabled ? 'Sign-in codes turned on.' : 'Sign-in codes turned off.'); }
    catch (e) { toast((e as Error).message, 'bad'); }
  };
  const logoutAll = async () => {
    await api('/v1/auth/logout-all', { method: 'POST' });
    await fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Requested-With': 'wasaas' } });
    router.replace('/login');
  };
  const deleteAccount = async () => {
    if (!confirm('Delete your account permanently? Your personal details are erased and you lose access to every workspace.')) return;
    try { await api('/v1/me', { method: 'DELETE' }); await fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Requested-With': 'wasaas' } }); router.replace('/login'); }
    catch (e) { toast((e as Error).message, 'bad'); }
  };
  return (
    <div className="stack">
      <div className="panel"><h2>{me?.user.name}</h2><p className="muted">{me?.user.email}</p></div>
      <form className="panel stack" onSubmit={change}>
        <h2>Change password</h2>
        <ErrorNote error={error} />
        <div className="grid-2">
          <Field label="Current password" htmlFor="cp"><Input id="cp" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></Field>
          <Field label="New password" htmlFor="np" hint="At least 10 characters, with a letter and a number."><Input id="np" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></Field>
        </div>
        <div><Button variant="primary" type="submit" loading={busy}>Change password</Button></div>
      </form>
      <div className="panel stack">
        <h2>Two-step sign-in</h2>
        <p className="muted">{me?.user.twoFactorEnabled ? 'On. After your password, we email you a 6-digit code.' : 'Off. Turn it on to require a code from your email each time you sign in.'}</p>
        <div><Button onClick={toggle2fa}>{me?.user.twoFactorEnabled ? 'Turn off' : 'Turn on'}</Button></div>
      </div>
      <div className="panel stack">
        <h2>Sessions</h2>
        <p className="muted">Sign out on every browser and phone where you’re signed in.</p>
        <div><Button onClick={logoutAll}>Sign out everywhere</Button></div>
      </div>
      <div className="panel stack" style={{ borderColor: 'var(--brick)' }}>
        <h2>Delete account</h2>
        <p className="muted">If you own a workspace with no other owners, transfer or delete it first.</p>
        <div><Button variant="danger" onClick={deleteAccount}>Delete my account</Button></div>
      </div>
    </div>
  );
}
