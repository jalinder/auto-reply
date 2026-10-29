'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AuthFrame } from '@/components/auth-frame';
import { Button, ErrorNote, Field, Input } from '@/components/ui';
import { authPost } from '@/lib/api';

export default function RegisterPage() {
  const router = useRouter();
  const [f, setF] = useState({ name: '', email: '', password: '', workspaceName: '' });
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await authPost('/api/auth/register', f); router.replace('/workspaces'); }
    catch (err) { setError(err); setBusy(false); }
  };
  return (
    <AuthFrame>
      <form className="stack" onSubmit={submit}>
        <h1>Create your account</h1>
        <ErrorNote error={error} />
        <Field label="Your name" htmlFor="n"><Input id="n" autoComplete="name" required value={f.name} onChange={set('name')} /></Field>
        <Field label="Work email" htmlFor="e"><Input id="e" type="email" autoComplete="email" required value={f.email} onChange={set('email')} /></Field>
        <Field label="Password" htmlFor="p" hint="At least 10 characters, with a letter and a number.">
          <Input id="p" type="password" autoComplete="new-password" required minLength={10} value={f.password} onChange={set('password')} />
        </Field>
        <Field label="Business name" htmlFor="w" hint="This becomes your first workspace. You can add more later.">
          <Input id="w" required value={f.workspaceName} onChange={set('workspaceName')} />
        </Field>
        <label className="check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span className="muted">I agree to the <a href="/terms">Terms</a> and <a href="/privacy">Privacy notice</a>, and I’ll only message people who agreed to hear from my business.</span></label>
        <Button variant="primary" type="submit" loading={busy} disabled={!agree}>Create account</Button>
        <p className="muted">Already have an account? <a href="/login">Sign in</a></p>
      </form>
    </AuthFrame>
  );
}
