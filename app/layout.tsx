import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, DM_Sans, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

const bricolage = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-bricolage', display: 'swap', weight: ['500', '700', '800'] });
const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-dm-sans', display: 'swap', weight: ['400', '500', '600', '700'] });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], variable: '--font-plex-mono', display: 'swap', weight: ['400', '500', '600'] });

export const metadata: Metadata = {
  title: { default: 'FUNLABS', template: '%s · FUNLABS' },
  description: 'Request playtests, review recorded sessions and check which changes people prefer.',
  applicationName: 'FUNLABS',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f6f2' },
    { media: '(prefers-color-scheme: dark)', color: '#141c18' },
  ],
};

// Applies the saved theme before the first paint (no flash, no hydration error).
const themeScript = `try{var t=localStorage.getItem('funlabs-theme');if(t==='light'||t==='dark'){document.documentElement.dataset.theme=t}}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} ${dmSans.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <a className="skip-link" href="#content">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
