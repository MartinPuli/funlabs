'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserClient } from '@/lib/supabase/browser';

const TABLES = ['studies', 'jobs', 'sessions', 'recordings', 'deliveries', 'evidence', 'evidence_reviews', 'checks', 'interventions', 'comparisons', 'agent_submissions', 'agent_tool_calls', 'dataset_exports'];

/**
 * Subscribes to Supabase Realtime changes for one study (RLS applies) and
 * refreshes the server-rendered page when material, jobs or results change.
 */
export function LiveRefresh({ studyId }: { studyId: string }) {
  const router = useRouter();
  const timer = useRef<number | null>(null);
  const [state, setState] = useState<'connecting' | 'live' | 'offline'>('connecting');

  useEffect(() => {
    const supabase = browserClient();
    const channel = supabase.channel(`study-${studyId}`);
    for (const table of TABLES) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: table === 'studies' ? `id=eq.${studyId}` : `study_id=eq.${studyId}` },
        () => {
          if (timer.current) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => router.refresh(), 600);
        },
      );
    }
    channel.subscribe((status: string) => setState(status === 'SUBSCRIBED' ? 'live' : status === 'CLOSED' || status === 'CHANNEL_ERROR' ? 'offline' : 'connecting'));
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
      void supabase.removeChannel(channel);
    };
  }, [studyId, router]);

  return (
    <span className="small muted" aria-live="polite">
      {state === 'live' ? 'Actualización en vivo' : state === 'connecting' ? 'Conectando…' : 'Sin actualización en vivo: recargá para ver cambios'}
    </span>
  );
}
