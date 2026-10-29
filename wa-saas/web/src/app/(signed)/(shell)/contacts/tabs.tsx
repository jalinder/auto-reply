'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
export function ContactTabs() {
  const p = usePathname();
  const t = [{ h: '/contacts', l: 'All contacts' }, { h: '/contacts/import', l: 'Import' }, { h: '/contacts/opt-outs', l: 'Opt-outs' }];
  return <nav className="tabs">{t.map((x) => <Link key={x.h} href={x.h} aria-current={p === x.h ? 'page' : undefined}>{x.l}</Link>)}</nav>;
}
