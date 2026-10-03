import { redirect } from 'next/navigation';
import { SiteFooter, SiteHeader } from '@/components/SiteHeader';
import { currentUser } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function LabLayout({ children }: { children: React.ReactNode }) {
  const { user } = await currentUser();
  if (!user) redirect('/sign-in');
  return (
    <>
      <SiteHeader
        items={[
          { href: '/lab', label: 'Studies' },
          { href: '/agents', label: 'For agents', optional: true },
        ]}
        right={
          <form action="/auth/sign-out" method="post">
            <button type="submit" className="btn btn-ghost btn-sm" title={user.email ?? undefined}>
              Sign out
            </button>
          </form>
        }
      />
      <main id="content" className="page" style={{ paddingTop: 32, paddingBottom: 32 }}>
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
