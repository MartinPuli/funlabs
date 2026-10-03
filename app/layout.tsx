import type { Metadata, Viewport } from 'next';
import { Figtree, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

const figtree = Figtree({ subsets: ['latin'], variable: '--font-figtree', display: 'swap', weight: ['400', '500', '600', '700', '800'] });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], variable: '--font-plex-mono', display: 'swap', weight: ['400', '500', '600'] });

export const metadata: Metadata = {
  title: { default: 'FUNLABS', template: '%s · FUNLABS' },
  description: 'Request playtests, review recorded sessions and check which changes people prefer.',
  applicationName: 'FUNLABS',
};

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#0a1018',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${figtree.variable} ${plexMono.variable}`}>
      <body>
        <a className="skip-link" href="#content">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
