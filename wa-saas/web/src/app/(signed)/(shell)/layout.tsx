'use client';
import { BarChart3, Building2, Contact, LogOut, Menu, Megaphone, Settings, Smartphone, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useWorkspace } from '@/components/providers';
import { Loading } from '@/components/ui';
import { ROLE_LABEL } from '@/lib/status';

const NAV = [
  { href: '/dashboard', label: 'Overview', icon: BarChart3 },
  { href: '/campaigns', label: 'Campaigns', icon: Megaphone },
  { href: '/contacts', label: 'Contacts', icon: Contact },
  { href: '/connections', label: 'WhatsApp numbers', icon: Smartphone },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  const { me, current } = useWorkspace();
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => { if (me && !current && me.memberships.length !== 1) router.replace('/workspaces'); }, [me, current, router]);

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', headers: { 'X-Requested-With': 'wasaas' } });
    router.replace('/login');
  };
  if (!me || !current) return <Loading />;
  return (
    <div className="shell">
      <div className="mobile-bar">
        <div className="brand"><span className="brand-mark">R</span>Relay</div>
        <button className="btn ghost icon-btn" aria-label="Open menu" onClick={() => setOpen(true)}><Menu size={20} /></button>
      </div>
      <aside className={`rail ${open ? 'open' : ''}`} aria-label="Main">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="brand"><span className="brand-mark">R</span>Relay</div>
          {open && <button className="btn ghost icon-btn" aria-label="Close menu" onClick={() => setOpen(false)}><X size={20} /></button>}
        </div>
        <button className="ws-switch" onClick={() => router.push('/workspaces')}>
          <span className="row" style={{ gap: 8 }}><Building2 size={16} /><strong>{current.tenant.name}</strong></span>
          <small>{ROLE_LABEL[current.role]} · switch workspace</small>
        </button>
        <nav className="nav">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} aria-current={path.startsWith(href) ? 'page' : undefined}><Icon size={18} />{label}</Link>
          ))}
        </nav>
        <div className="rail-foot stack" style={{ gap: 8 }}>
          <div><strong>{me.user.name}</strong><div className="subtle">{me.user.email}</div></div>
          <button className="btn ghost sm" style={{ justifyContent: 'flex-start' }} onClick={logout}><LogOut size={16} />Sign out</button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
