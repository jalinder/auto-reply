'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AuthFrame } from '@/components/auth-frame';
import { Button, ErrorNote, Field, Input } from '@/components/ui';
import { api } from '@/lib/api';

function ResetForm() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api('/v1/auth/password-reset/confirm', { method: 'POST', body: { token, password } }); setDone(true); }
    catch (err) { setError(err); } finally { setBusy(false); }
  };
  if (done) return <div className="stack"><h1>Password updated</h1><p className="muted">You’ve been signed out everywhere else. Sign in with your new password.</p><a href="/login">Sign in</a></div>;
  return (
    <form className="stack" onSubmit={submit}>
      <h1>Choose a new password</h1>
      <ErrorNote error={error} />
      <Field label="New password" htmlFor="p" hint="At least 10 characters, with a letter and a number.">
        <Input id="p" type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <Button variant="primary" type="submit" loading={busy} disabled={!token}>Save password</Button>
    </form>
  );
}
export default function ResetPage() { return <AuthFrame><Suspense><ResetForm /></Suspense></AuthFrame>; }
