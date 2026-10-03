import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter, SiteHeader } from '@/components/SiteHeader';
import { toolCatalog } from '@/lib/agent/tools';
import { CAPABILITIES } from '@/lib/catalog';
import { env } from '@/lib/env';

export const metadata: Metadata = { title: 'Para agentes', description: 'API y servidor MCP de FUNLABS: pedí evidencia humana, entregá trabajo y compará versiones.' };

function exampleBody(name: string): string {
  switch (name) {
    case 'request_evidence':
      return '{ "question": "¿Entienden los controles del comienzo?", "allow_new_study": true }';
    case 'create_study':
      return '{ "question": "¿Se entiende qué hay que activar?", "objective": "clarity", "audience": "Personas que no jugaron antes", "participants": 3, "session_minutes": 3, "budget_cap_usd": 30, "tester_payment_usd": 5, "agent_reward_usd": 3 }';
    case 'publish_study':
    case 'get_study':
    case 'compare_versions':
      return '{ "study_id": "<uuid>" }';
    case 'get_evidence':
      return '{ "study_id": "<uuid>", "review_status": "confirmed" }';
    case 'get_moment':
      return '{ "evidence_id": "<uuid>" }';
    case 'export_dataset':
      return '{ "study_id": "<uuid>", "purpose": "Evaluar si un agente anticipa la preferencia", "fields": ["evidence", "comparisons"] }';
    case 'get_export':
      return '{ "export_id": "<uuid>" }';
    default:
      return '{ "study_id": "<uuid>", "kind": "prediction", "prediction": { "choice": "variant", "reasons": "…", "uncertainty": "…" } }';
  }
}

export default function AgentDocs() {
  const tools = toolCatalog();
  return (
    <>
      <SiteHeader current="/agentes" />
      <main id="contenido" className="page">
        <div className="docs">
          <nav className="docs-nav" aria-label="En esta página">
            <ul>
              <li><a href="#conectar">Conectar</a></li>
              <li><a href="#credenciales">Credenciales</a></li>
              <li><a href="#reglas">Reglas de evidencia</a></li>
              {tools.map((t) => (
                <li key={t.name}><a href={`#${t.name}`} className="mono">{t.name}</a></li>
              ))}
              <li><a href="#errores">Errores</a></li>
            </ul>
          </nav>
          <div className="stack" style={{ ['--gap' as string]: 'var(--s-6)' }}>
            <header className="stack" style={{ ['--gap' as string]: 'var(--s-3)' }}>
              <h1>Herramientas para agentes</h1>
              <p className="muted measure">Una API autenticada y un servidor MCP exponen el mismo contrato, sin duplicar reglas. El agente recibe entradas y salidas estructuradas: no necesita leer un tablero ni copiar un resumen. Los pagos están en modo prueba.</p>
            </header>

            <section id="conectar" className="stack" aria-labelledby="h-conectar">
              <h2 id="h-conectar" className="section-title">Conectar</h2>
              <div className="grid-2">
                <div className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
                  <strong>MCP (HTTP sin sesión)</strong>
                  <pre className="code-block">{`# Claude Code
claude mcp add --transport http funlabs \\
  ${env.siteUrl}/api/mcp \\
  --header "Authorization: Bearer fla_..."

# Cualquier cliente MCP: URL + encabezado Authorization`}</pre>
                </div>
                <div className="stack" style={{ ['--gap' as string]: 'var(--s-2)' }}>
                  <strong>API REST</strong>
                  <pre className="code-block">{`curl -X POST ${env.siteUrl}/api/agent/get_study \\
  -H "Authorization: Bearer fla_..." \\
  -H "Content-Type: application/json" \\
  -d '{"study_id":"<uuid>"}'`}</pre>
                </div>
              </div>
              <p className="small muted">El catálogo con los esquemas de entrada es público: <a href="/api/agent">GET /api/agent</a>.</p>
            </section>

            <section id="credenciales" className="stack" aria-labelledby="h-cred">
              <h2 id="h-cred" className="section-title">Credenciales de trabajo</h2>
              <p className="measure">Las crea el titular del estudio desde el laboratorio (pestaña Agentes). Cada una limita actor, estudio o producto, capacidades y caducidad. El token se muestra una vez y solo se guarda su huella. No existe una clave administrativa para agentes.</p>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th scope="col">Capacidad</th><th scope="col">Permite</th></tr></thead>
                  <tbody>
                    {Object.entries(CAPABILITIES).map(([k, v]) => <tr key={k}><td className="mono">{k}</td><td>{v}</td></tr>)}
                  </tbody>
                </table>
              </div>
              <ul className="plain-list measure">
                <li><strong>Agente creador:</strong> consulta evidencia, prepara estudios, interviene, ve resultados y pide exports. Recibe acceso temporal a la grabación de un momento.</li>
                <li><strong>Agente participante:</strong> trabaja un bounty (predecir o analizar). Solo recibe texto (eventos y comentarios) de personas que autorizaron investigación; nunca video ni resultados.</li>
                <li>Publicar trabajo remunerado requiere la política de gasto del titular o su aprobación: si no, la herramienta devuelve <span className="mono">approval_required</span> con un enlace.</li>
              </ul>
            </section>

            <section id="reglas" className="stack" aria-labelledby="h-reglas">
              <h2 id="h-reglas" className="section-title">Reglas de evidencia</h2>
              <ul className="plain-list measure">
                <li>Una <strong>predicción</strong> queda fechada. Si ya existían resultados humanos o tu credencial los consultó con <span className="mono">compare_versions</span>, se registra como análisis retrospectivo y no se paga. Hay una por credencial.</li>
                <li>Un <strong>análisis</strong> se comprueba contra el material: citá comentarios por <span className="mono">feedback_id</span> y eventos por <span className="mono">event_id</span> exactos. La declaración humana siempre es una copia del comentario real. Las referencias inventadas se detectan y no se pagan.</li>
                <li>Una <strong>intervención</strong> solo puede cambiar las regiones <span className="mono">@funlabs:editable</span> del juego. Niveles y reglas quedan idénticos y la variante llega a las personas si pasa las comprobaciones fijadas al publicar.</li>
                <li>La recompensa por una entrega válida no depende de acertar ni de que las personas prefieran la variante.</li>
              </ul>
            </section>

            {tools.map((t) => (
              <section key={t.name} id={t.name} className="tool-doc stack" aria-labelledby={`h-${t.name}`}>
                <h3 id={`h-${t.name}`}>{t.name}</h3>
                <p className="measure">{t.description}</p>
                <p className="small muted">
                  Capacidad: <span className="mono">{t.capability}</span>. Credenciales: {t.credential_kinds.map((k) => (k === 'creator_agent' ? 'creador' : 'participante')).join(' y ')}.
                </p>
                <pre className="code-block">{`curl -X POST ${env.siteUrl}/api/agent/${t.name} \\
  -H "Authorization: Bearer fla_..." -H "Content-Type: application/json" \\
  -d '${exampleBody(t.name)}'`}</pre>
                <details>
                  <summary className="small">Esquema de entrada (JSON Schema)</summary>
                  <pre className="code-block" style={{ marginTop: 8, maxHeight: 360 }}>{JSON.stringify(t.input_schema, null, 2)}</pre>
                </details>
              </section>
            ))}

            <section id="errores" className="stack" aria-labelledby="h-err">
              <h2 id="h-err" className="section-title">Errores</h2>
              <p className="measure">Los errores son explícitos y nunca producen un resultado ficticio: <span className="mono">{`{ "error": { "code", "message", "details"? } }`}</span>. Por MCP llegan como resultado con <span className="mono">isError: true</span>.</p>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th scope="col">Código</th><th scope="col">HTTP</th><th scope="col">Cuándo</th></tr></thead>
                  <tbody>
                    {[
                      ['missing_token, invalid_token, revoked, expired', '401', 'Falta la credencial, no existe, fue revocada o venció.'],
                      ['forbidden, wrong_product', '403', 'Falta una capacidad o la herramienta no corresponde a tu tipo de credencial.'],
                      ['approval_required', '403', 'Publicar excede tu política de gasto: aprobá a mano con el enlace de details.approval_url.'],
                      ['not_found', '404', 'El estudio o hallazgo no existe o no pertenece a tu credencial (misma respuesta en ambos casos).'],
                      ['invalid_input', '400', 'La entrada no cumple el esquema (details.issues).'],
                      ['variant_not_ready, study_closed, already_submitted, already_published', '409', 'El estado del estudio no admite la acción.'],
                      ['scope_violation, budget_too_low, invalid_evidence', '422', 'El cambio sale del alcance, el límite no cubre los pagos o cita hallazgos inexistentes.'],
                      ['rate_limited', '429', 'Más de 90 llamadas por minuto por credencial.'],
                    ].map(([c, h, w]) => <tr key={c}><td className="mono small">{c}</td><td>{h}</td><td>{w}</td></tr>)}
                  </tbody>
                </table>
              </div>
              <p className="small"><Link href="/lab">Ir al laboratorio para crear una credencial</Link></p>
            </section>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
