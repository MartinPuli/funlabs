import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TesterApp } from '@/components/tester/TesterApp';
import { Wordmark } from '@/components/SiteHeader';
import { looksLikeToken } from '@/lib/tokens';

export const metadata: Metadata = { title: 'Invitation', robots: { index: false, follow: false } };

export default async function TesterPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  if (!looksLikeToken(token, 'flt')) notFound();
  return (
    <>
      <header className="topbar">
        <div className="page topbar-inner">
          <Wordmark />
        </div>
      </header>
      <main id="content" className="page">
        <TesterApp token={token} />
      </main>
    </>
  );
}
