'use client';
import { useState } from 'react';
import { AuthFrame } from '@/components/auth-frame';
import { Button, ErrorNote, Field, Input } from '@/components/ui';
import { api } from '@/lib/api';

export default function ForgotPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api('/v1/auth/password-reset/request', { method: 'POST', body: { email } }); setSent(true); }
    catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <AuthFrame>
      {sent ? (
        <div className="stack"><h1>Check your email</h1><p className="muted">If an account exists for {email}, we sent a link to reset your password. It expires in 30 minutes.</p><a href="/login">Back to sign in</a></div>
      ) : (
        <form className="stack" onSubmit={submit}>
          <h1>Reset your password</h1>
          <ErrorNote error={error} />
          <Field label="Work email" htmlFor="e"><Input id="e" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Button variant="primary" type="submit" loading={busy}>Send reset link</Button>
          <a href="/login">Back to sign in</a>
        </form>
      )}
    </AuthFrame>
  );
}
