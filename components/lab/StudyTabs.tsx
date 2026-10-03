'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '', label: 'Resumen' },
  { href: '/evidencia', label: 'Evidencia' },
  { href: '/versiones', label: 'Versiones' },
  { href: '/comparacion', label: 'Comparación' },
  { href: '/agentes', label: 'Agentes' },
  { href: '/datos', label: 'Datos' },
];

export function StudyTabs({ studyId }: { studyId: string }) {
  const path = usePathname();
  const base = `/lab/estudios/${studyId}`;
  return (
    <nav className="tabs-list" aria-label="Secciones del estudio">
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
