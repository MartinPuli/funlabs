import Link from 'next/link';
import { ThemeToggle } from './ThemeToggle';

export function Wordmark() {
  return (
    <Link href="/" className="wordmark" aria-label="FUNLABS, inicio">
      <span className="wordmark-mark" aria-hidden="true">F</span>
      FUNLABS
    </Link>
  );
}

type NavItem = { href: string; label: string; optional?: boolean };

export function SiteHeader({ items, current, right }: { items?: NavItem[]; current?: string; right?: React.ReactNode }) {
  const nav: NavItem[] = items ?? [
    { href: '/jugar', label: 'Jugar', optional: true },
    { href: '/agentes', label: 'Para agentes', optional: true },
    { href: '/lab', label: 'Laboratorio' },
  ];
  return (
    <header className="topbar">
      <div className="page topbar-inner">
        <Wordmark />
        <nav className="nav" aria-label="Principal">
          {nav.map((item) => (
            <Link key={item.href} href={item.href} className={item.optional ? 'nav-optional' : undefined} aria-current={current === item.href ? 'page' : undefined}>
              {item.label}
            </Link>
          ))}
          {right}
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="footer">
      <div className="page split">
        <span>FUNLABS. Pagos en modo prueba durante el MVP.</span>
        <span className="cluster">
          <Link href="/agentes">API y MCP</Link>
          <Link href="/estado">Estado de integraciones</Link>
        </span>
      </div>
    </footer>
  );
}
