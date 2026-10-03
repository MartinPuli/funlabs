'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserClient } from '@/lib/supabase/browser';

type Mode = 'password' | 'signup' | 'magic';

export function SignInForm({ next }: { next: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const supabase = browserClient();
    const redirect = `${window.location.origin}/auth/confirm?next=${encodeURIComponent(next)}`;
    try {
      if (mode === 'password') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace(next);
        router.refresh();
        return;
      }
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirect } });
        if (error) throw error;
        if (data.session) {
          router.replace(next);
          router.refresh();
          return;
        }
        setNotice('Te enviamos un correo para confirmar la cuenta. Abrí el enlace desde este navegador.');
        return;
      }
      const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect, shouldCreateUser: true } });
      if (error) throw error;
      setNotice('Te enviamos un enlace para entrar. Revisá tu correo.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo entrar';
      setError(/invalid login/i.test(msg) ? 'Correo o contraseña incorrectos.' : /rate limit/i.test(msg) ? 'Se enviaron demasiados correos. Esperá unos minutos o entrá con contraseña.' : msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel stack" onSubmit={submit} noValidate>
      <div className="tabs-list" role="tablist" aria-label="Forma de entrar">
        {(
          [
            ['password', 'Contraseña'],
            ['signup', 'Crear cuenta'],
            ['magic', 'Enlace por correo'],
          ] as const
        ).map(([m, label]) => (
          <button key={m} type="button" role="tab" aria-selected={mode === m} data-state={mode === m ? 'active' : 'inactive'} onClick={() => setMode(m)}>
            {label}
          </button>
        ))}
      </div>
      <div className="field">
        <label htmlFor="email">Correo</label>
        <input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {mode !== 'magic' && (
        <div className="field">
          <label htmlFor="password">Contraseña</label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            minLength={8}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby="pw-help"
          />
          <span id="pw-help" className="field-help">
            {mode === 'signup' ? 'Mínimo 8 caracteres.' : '¿Sin contraseña? Usá el enlace por correo.'}
          </span>
        </div>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="callout callout-success" role="status">{notice}</p>}
      <div>
        <button className="btn btn-primary" type="submit" disabled={busy || !email || (mode !== 'magic' && password.length < 8)}>
          {busy ? 'Un momento…' : mode === 'password' ? 'Entrar' : mode === 'signup' ? 'Crear cuenta' : 'Enviar enlace'}
        </button>
      </div>
    </form>
  );
}
