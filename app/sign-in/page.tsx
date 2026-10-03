import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { SignInForm } from '@/components/lab/SignInForm';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SignInPage(props: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await props.searchParams;
  const next = sp.next?.startsWith('/') ? sp.next : '/lab';
  return (
    <>
      <SiteHeader />
      <main id="content" className="page" style={{ padding: '48px 0 96px', maxWidth: 520 }}>
        <div className="stack" style={{ ['--gap' as string]: 'var(--s-5)' }}>
          <div className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
            <h1>Sign in to the lab</h1>
            <p className="muted">People who playtest don't need an account: they join with their invite.</p>
          </div>
          {sp.error && <p className="callout callout-error" role="alert">{sp.error}</p>}
          <SignInForm next={next} />
        </div>
      </main>
    </>
  );
}
