import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { env } from '../env.ts';

/** Supabase client acting as the signed-in person (RLS applies). */
export async function createUserClient() {
  const store = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(list) {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component: the proxy refreshes the session.
        }
      },
    },
  });
}

export async function currentUser() {
  const supabase = await createUserClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, user: data.user };
}
