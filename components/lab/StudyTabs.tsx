'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '', label: 'Overview' },
  { href: '/evidence', label: 'Evidence' },
  { href: '/versions', label: 'Versions' },
  { href: '/comparison', label: 'Comparison' },
  { href: '/agents', label: 'Agents' },
  { href: '/data', label: 'Data' },
];

export function StudyTabs({ studyId }: { studyId: string }) {
  const path = usePathname();
  const base = `/lab/studies/${studyId}`;
  return (
    <nav className="tabs-list" aria-label="Study sections">
      {TABS.map((t) => {
        const href = base + t.href;
        const active = t.href === '' ? path === base : path.startsWith(href);
        return (
          <Link key={t.href} href={href} aria-current={active ? 'page' : undefined}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
