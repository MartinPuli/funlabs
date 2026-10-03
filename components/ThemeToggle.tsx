'use client';

import { useEffect, useState } from 'react';

type Pref = 'auto' | 'light' | 'dark';
const LABELS: Record<Pref, string> = { auto: 'Tema automático', light: 'Tema claro', dark: 'Tema oscuro' };
const NEXT: Record<Pref, Pref> = { auto: 'light', light: 'dark', dark: 'auto' };

function apply(pref: Pref) {
  const root = document.documentElement;
  if (pref === 'auto') delete root.dataset.theme;
  else root.dataset.theme = pref;
  try {
    if (pref === 'auto') localStorage.removeItem('funlabs-theme');
    else localStorage.setItem('funlabs-theme', pref);
  } catch {
    // Storage can be unavailable (private mode); the choice still applies now.
  }
}

/** Cycles automatic, light and dark. The label always names the current state. */
export function ThemeToggle() {
  const [pref, setPref] = useState<Pref>('auto');
  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setPref(t === 'light' || t === 'dark' ? t : 'auto');
  }, []);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={() => {
        const next = NEXT[pref];
        apply(next);
        setPref(next);
      }}
      aria-label={`${LABELS[pref]}. Cambiar tema`}
      title={`${LABELS[pref]}. Cambiar tema`}
    >
      {pref === 'auto' ? 'Auto' : pref === 'light' ? 'Claro' : 'Oscuro'}
    </button>
  );
}
