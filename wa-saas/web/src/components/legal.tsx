import { ReactNode } from 'react';

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 20px 80px', lineHeight: 1.65 }}>
      <a href="/login" className="brand" style={{ marginBottom: 32, display: 'inline-flex' }}><span className="brand-mark">R</span>Relay</a>
      <h1>{title}</h1>
      <p className="subtle" style={{ margin: '8px 0 28px' }}>Last updated {updated}</p>
      <div className="legal">{children}</div>
      <style>{`.legal h2{margin:28px 0 8px}.legal p,.legal li{color:var(--ink-2)}.legal ul{padding-left:20px}`}</style>
    </main>
  );
}
