'use client';

import { useEffect, useRef } from 'react';
import { browserClient } from '@/lib/supabase/browser';

/**
 * Counts active review time on the evidence desk (a tab that is visible and
 * recently used) and reports it every 30 seconds. Idle or hidden time is not
 * counted, so the number reflects effort, not an open tab.
 */
export function ReviewTimer({ studyId }: { studyId: string }) {
  const last = useRef(Date.now());
  const pending = useRef(0);

  useEffect(() => {
    const bump = () => {
      last.current = Date.now();
    };
    const events = ['pointermove', 'keydown', 'scroll', 'click', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const tick = window.setInterval(() => {
      if (document.visibilityState === 'visible' && Date.now() - last.current < 45_000) pending.current += 5;
    }, 5000);
    const flush = window.setInterval(async () => {
      const seconds = pending.current;
      if (seconds <= 0) return;
      pending.current = 0;
      const { error } = await browserClient().rpc('add_review_time', { p_study: studyId, p_seconds: seconds });
      if (error) pending.current += seconds;
    }, 30_000);
    const onHide = () => {
      if (pending.current > 0) {
        const seconds = pending.current;
        pending.current = 0;
        void browserClient().rpc('add_review_time', { p_study: studyId, p_seconds: seconds });
      }
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      window.clearInterval(tick);
      window.clearInterval(flush);
      document.removeEventListener('visibilitychange', onHide);
      onHide();
    };
  }, [studyId]);

  return null;
}
