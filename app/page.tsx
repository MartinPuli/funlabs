import Link from 'next/link';
import { SiteFooter, SiteHeader } from '@/components/SiteHeader';

export default function Home() {
  return (
    <>
      <SiteHeader />
      <main id="contenido" className="page" style={{ padding: '64px 0' }}>
        <h1>Dale evidencia humana a tu agente</h1>
        <p className="muted">Encargá pruebas, revisá partidas y comprobá qué cambios prefieren las personas.</p>
        <p><Link href="/lab">Abrir laboratorio</Link></p>
      </main>
      <SiteFooter />
    </>
  );
}
