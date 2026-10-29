'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PageHead } from '@/components/ui';

const TABS = [['/settings', 'Workspace'], ['/settings/team', 'Team'], ['/settings/billing', 'Plan & billing'], ['/settings/audit', 'Activity log'], ['/settings/account', 'Your account']];
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const p = usePathname();
  return (
    <>
      <PageHead title="Settings" />
      <nav className="tabs">{TABS.map(([h, l]) => <Link key={h} href={h} aria-current={p === h ? 'page' : undefined}>{l}</Link>)}</nav>
      {children}
    </>
  );
}
