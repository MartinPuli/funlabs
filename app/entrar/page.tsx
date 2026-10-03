import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { SignInForm } from '@/components/lab/SignInForm';

export const metadata: Metadata = { title: 'Entrar' };

export default async function SignInPage(props: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await props.searchParams;
  const next = sp.next?.startsWith('/') ? sp.next : '/lab';
  return (
    <>
      <SiteHeader />
      <main id="contenido" className="page" style={{ padding: '48px 0 96px', maxWidth: 520 }}>
        <div className="stack" style={{ ['--gap' as string]: 'var(--s-5)' }}>
          <div className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
            <h1>Entrar al laboratorio</h1>
            <p className="muted">Para crear estudios, revisar evidencia y aprobar gasto. Las personas que prueban no necesitan cuenta: entran con su invitación.</p>
          </div>
          {sp.error && <p className="callout callout-error" role="alert">{sp.error}</p>}
          <SignInForm next={next} />
        </div>
      </main>
    </>
  );
}
