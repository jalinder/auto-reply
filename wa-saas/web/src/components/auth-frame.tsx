import { ReactNode } from 'react';

export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="auth-wrap">
      <aside className="auth-side">
        <div className="brand"><span className="brand-mark">R</span>Relay</div>
        <div>
          <h2>Campaigns your customers asked for.</h2>
          <p style={{ marginTop: 16, maxWidth: '40ch', opacity: 0.8 }}>Consent and opt-outs are checked before every send, and reports only say “delivered” when WhatsApp confirms it.</p>
        </div>
        <p style={{ opacity: 0.6, fontSize: '0.85rem' }}>
          <a href="/privacy" style={{ color: 'inherit' }}>Privacy</a> · <a href="/terms" style={{ color: 'inherit' }}>Terms</a>
        </p>
      </aside>
      <main className="auth-form"><div>{children}</div></main>
    </div>
  );
}
