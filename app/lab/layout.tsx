import { redirect } from 'next/navigation';
import { SiteFooter, SiteHeader } from '@/components/SiteHeader';
import { currentUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function LabLayout({ children }: { children: React.ReactNode }) {
  const { user } = await currentUser();
  if (!user) redirect('/entrar');
  return (
    <>
      <SiteHeader
        items={[
          { href: '/lab', label: 'Estudios' },
          { href: '/agentes', label: 'Para agentes', optional: true },
        ]}
        right={
          <form action="/auth/salir" method="post">
            <button type="submit" className="btn btn-ghost btn-sm" title={user.email ?? undefined}>
              Salir
            </button>
          </form>
        }
      />
      <main id="contenido" className="page" style={{ paddingTop: 32, paddingBottom: 32 }}>
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
