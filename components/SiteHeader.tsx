import Link from 'next/link';
import { ThemeToggle } from './ThemeToggle';

export function Wordmark() {
  return (
    <Link href="/" className="wordmark" aria-label="FUNLABS, home">
      <span className="wordmark-mark" aria-hidden="true">F</span>
      FUNLABS
    </Link>
  );
}

type NavItem = { href: string; label: string; optional?: boolean };

export function SiteHeader({ items, current, right }: { items?: NavItem[]; current?: string; right?: React.ReactNode }) {
  const nav: NavItem[] = items ?? [
    { href: '/play', label: 'Play', optional: true },
    { href: '/agents', label: 'For agents', optional: true },
    { href: '/lab', label: 'Lab' },
  ];
  return (
    <header className="topbar">
      <div className="page topbar-inner">
        <Wordmark />
        <nav className="nav" aria-label="Main">
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
        <span>FUNLABS. Payments run in test mode during the MVP.</span>
        <span className="cluster">
          <Link href="/agents">API and MCP</Link>
          <Link href="/status">Integration status</Link>
        </span>
      </div>
    </footer>
  );
}
