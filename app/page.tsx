import Image from 'next/image';
import Link from 'next/link';
import { SiteFooter, SiteHeader } from '@/components/SiteHeader';
import { toolCatalog } from '@/lib/agent/tools';
import { env } from '@/lib/env';

const FINDING_EXAMPLE = `{
  "evidence_id": "example-e01",
  "interval_ms": { "start": 21000, "end": 29000 },
  "observation": "La persona intenta avanzar varias veces.",
  "human_statement": "No sé qué objeto puedo activar.",
  "hypothesis": "La señal de interacción podría ser poco visible.",
  "alternative": "Puede que no haya comprendido la instrucción inicial.",
  "next_test": "Cambiar la señal visual y mantener el puzzle.",
  "sources": [
    { "kind": "recording",  "verified": true },
    { "kind": "feedback",   "verified": true }
  ],
  "review_status": "unreviewed"
}`;

export default function Home() {
  const tools = toolCatalog();
  return (
    <>
      <SiteHeader />
      <main id="contenido">
        <section className="hero page">
          <div className="hero-copy stack" style={{ ['--gap' as string]: 'var(--s-5)' }}>
            <h1 className="hero-title">Dale evidencia humana a tu agente</h1>
            <p className="hero-sub">Encargá pruebas, revisá partidas y comprobá qué cambios prefieren las personas.</p>
            <div className="cluster">
              <Link className="btn btn-primary btn-lg" href="/lab">Abrir laboratorio</Link>
              <Link className="btn btn-lg" href="/jugar">Jugar Gravity Room</Link>
            </div>
          </div>
          <figure className="hero-figure">
            <picture>
              <source srcSet="/screens/evidence-desk-dark.png" media="(prefers-color-scheme: dark)" />
              <Image src="/screens/evidence-desk-light.png" alt="Mesa de evidencia de FUNLABS: la grabación de una partida de Gravity Room, la línea de tiempo y un hallazgo con observación, declaración, hipótesis y fuentes." width={1860} height={1050} priority className="hero-shot" />
            </picture>
            <figcaption className="small muted">Captura real del ensayo técnico del producto. La partida y el comentario son de un bot de prueba, no de una persona.</figcaption>
          </figure>
        </section>

        <section className="section page loop" aria-labelledby="ciclo">
          <h2 id="ciclo" className="section-heading">Una decisión de diseño, de la pregunta al resultado</h2>
          <ol className="loop-list">
            <li>
              <h3>Encargar</h3>
              <p>Tu agente publica una versión y una pregunta, con público, duración, cantidad de personas y un límite de gasto. Si ya hay evidencia del mismo producto y versión, la consulta antes de pedir trabajo nuevo.</p>
            </li>
            <li>
              <h3>Jugar</h3>
              <p>Cada persona recibe un enlace, ve qué se registra y cuánto se paga, y juega en su navegador. Se graba solo la pestaña del juego. Decir que algo es aburrido es una entrega válida.</p>
            </li>
            <li>
              <h3>Revisar</h3>
              <p>Gemini propone hallazgos con intervalo y fuentes. FUNLABS comprueba que cada fuente exista y pertenezca a la sesión. De un hallazgo vas al segundo exacto de la grabación con un clic.</p>
            </li>
            <li>
              <h3>Cambiar</h3>
              <p>Claude modifica una copia del juego. Solo puede tocar la presentación: niveles y reglas quedan idénticos. La variante llega a las personas si pasa comprobaciones fijadas antes del cambio.</p>
            </li>
            <li>
              <h3>Comparar</h3>
              <p>Las personas juegan las dos versiones con nombres neutrales y orden alternado. Pueden elegir cualquiera o ninguna. Ves los resultados con denominador, motivos y límites.</p>
            </li>
          </ol>
        </section>

        <section className="section page" aria-labelledby="trabajos">
          <h2 id="trabajos" className="section-heading">Personas y agentes se evalúan por separado</h2>
          <p className="muted measure">No hay un puntaje único para testers, bots y agentes analistas. Cada trabajo tiene su medida y dice qué no demuestra.</p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th scope="col">Trabajo</th><th scope="col">Cómo se mide</th><th scope="col">Qué no demuestra</th></tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Persona: jugar y explicar</th>
                  <td>Material utilizable, tarea realizada y comentarios sobre la partida. Se paga la entrega válida aunque no le haya gustado.</td>
                  <td>Una pausa o muchos intentos no prueban aburrimiento.</td>
                </tr>
                <tr>
                  <th scope="row">Agente: predecir una preferencia</th>
                  <td>Se registra con fecha antes de ver resultados y se compara con las preferencias humanas. Si ya existen, cuenta como análisis retrospectivo.</td>
                  <td>Un acierto aislado no es juicio general.</td>
                </tr>
                <tr>
                  <th scope="row">Agente: analizar evidencia</th>
                  <td>Cada hallazgo se verifica contra el material: intervalo, comentario y evento citados deben existir. Una cita inventada no se paga.</td>
                  <td>Un informe convincente puede estar mal interpretado.</td>
                </tr>
                <tr>
                  <th scope="row">Agente: proponer una mejora</th>
                  <td>Variante funcional dentro del alcance permitido, y preferencia humana posterior, registrada por separado.</td>
                  <td>Más tiempo jugando no es más diversión.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="section page split-sec" aria-labelledby="evidencia">
          <div className="stack" style={{ ['--gap' as string]: 'var(--s-4)' }}>
            <h2 id="evidencia" className="section-heading">Un hallazgo separa lo que pasó de lo que se supone</h2>
            <p className="muted measure">Observación, declaración de la persona, interpretación y prueba siguiente son campos distintos. La declaración es siempre una copia textual de un comentario real: un modelo no puede escribirla.</p>
            <ul className="plain-list">
              <li>Las fuentes se verifican contra la sesión, no se confían.</li>
              <li>Si no hay fuente, el hallazgo se muestra como hipótesis.</li>
              <li>La persona puede corregir cómo se interpretó su comentario.</li>
              <li>Quedan registrados también los momentos que se disfrutaron, para saber qué conservar.</li>
            </ul>
          </div>
          <div className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
            <pre className="code-block" aria-label="Ejemplo ilustrativo de un hallazgo">{FINDING_EXAMPLE}</pre>
            <p className="small muted">Ejemplo ilustrativo del contrato, no una sesión real.</p>
          </div>
        </section>

        <section className="section page" aria-labelledby="agentes">
          <div className="split-sec">
            <div className="stack" style={{ ['--gap' as string]: 'var(--s-4)' }}>
              <h2 id="agentes" className="section-heading">Tu agente pide evidencia con herramientas, no copiando un resumen</h2>
              <p className="muted measure">El mismo contrato sirve por API y por MCP. Las credenciales limitan actor, estudio, capacidades y caducidad; nunca son una clave administrativa. Publicar trabajo remunerado requiere una política de gasto del titular o su aprobación.</p>
              <div className="cluster">
                <Link className="btn btn-primary" href="/agentes">Ver las {tools.length} herramientas</Link>
              </div>
            </div>
            <div className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
              <pre className="code-block">{`claude mcp add --transport http funlabs \\
  ${env.siteUrl}/api/mcp \\
  --header "Authorization: Bearer fla_..."`}</pre>
              <pre className="code-block">{`> request_evidence({ question:
    "¿Entienden los controles del comienzo?" })
{ "coverage": { "sessions": 3, "recording_minutes": 7.4 },
  "gaps": ["Ningún hallazgo fue revisado..."],
  "findings": [ ... ] }`}</pre>
              <p className="small muted">Si no hay material compatible, la herramienta lo dice y propone un borrador de estudio. No inventa ejemplos.</p>
            </div>
          </div>
        </section>

        <section className="section page" aria-labelledby="datos">
          <h2 id="datos" className="section-heading">Datos para investigar decisiones, con permisos separados</h2>
          <div className="data-grid">
            <div>
              <h3>La unidad</h3>
              <p>Versión A, predicción previa, experiencia humana, diagnóstico, intervención, versión B y preferencias con motivos. Se conservan los empates, los resultados negativos y las abstenciones.</p>
            </div>
            <div>
              <h3>Los permisos</h3>
              <p>Aceptar la grabación no autoriza compartir datos. La investigación y el entrenamiento se aceptan aparte, por cada persona y por el titular del producto, y se pueden retirar.</p>
            </div>
            <div>
              <h3>El export</h3>
              <p>Descarga privada con eventos, comentarios y hallazgos revisados de ejemplos autorizados. No incluye video ni audio. No es un dataset representativo ni un marketplace.</p>
            </div>
          </div>
        </section>

        <section className="section page" aria-labelledby="limites">
          <h2 id="limites" className="section-heading">Lo que todavía no hace</h2>
          <ul className="plain-list measure">
            <li>Los pagos son de modo prueba. Las reservas internas no son un escrow ni una transferencia.</li>
            <li>No hay una red global de testers: participan las personas que invitás.</li>
            <li>Funciona con juegos web que podemos instrumentar. Un sitio externo sin integración aportaría grabación y respuestas, no eventos.</li>
            <li>Con pocas personas, los resultados describen esa prueba y no permiten generalizar.</li>
            <li>Las intervenciones las realiza el agente creador. Abrirlas a agentes externos requiere ejecución aislada.</li>
          </ul>
          <p><Link href="/estado">Ver el estado de cada integración en este entorno</Link></p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
