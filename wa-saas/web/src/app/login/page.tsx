'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { AuthFrame } from '@/components/auth-frame';
import { Button, ErrorNote, Field, Input } from '@/components/ui';
import { authPost } from '@/lib/api';

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get('next');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const go = () => router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/workspaces');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const r = await authPost('/api/auth/login', { email, password });
      if (r.otpRequired) { setChallenge(r.challengeId); setBusy(false); return; }
      go();
    } catch (err) { setError(err); setBusy(false); }
  };
  const verify = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await authPost('/api/auth/verify-otp', { challengeId: challenge, code }); go(); }
    catch (err) { setError(err); setBusy(false); }
  };
  if (challenge) return (
    <form className="stack" onSubmit={verify}>
      <h1>Check your email</h1>
      <p className="muted">We sent a 6-digit sign-in code to {email}. It expires in 5 minutes.</p>
      <ErrorNote error={error} />
      <Field label="Sign-in code" htmlFor="otp">
        <Input id="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
      </Field>
      <Button variant="primary" type="submit" loading={busy} disabled={code.length !== 6}>Verify and sign in</Button>
      <button type="button" className="btn ghost" onClick={() => { setChallenge(null); setCode(''); setPassword(''); }}>Use a different account</button>
    </form>
  );
  return (
    <form className="stack" onSubmit={submit}>
      <h1>Sign in</h1>
      <ErrorNote error={error} />
      <Field label="Work email" htmlFor="email"><Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="Password" htmlFor="pw"><Input id="pw" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
      <Button variant="primary" type="submit" loading={busy}>Sign in</Button>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <a href="/forgot-password">Forgot password?</a>
        <a href="/register">Create an account</a>
      </div>
    </form>
  );
}

export default function LoginPage() {
  return <AuthFrame><Suspense><LoginForm /></Suspense></AuthFrame>;
}
