# FUNLABS: arquitectura y runbook

Esta es la guía técnica de lo que está implementado. La especificación de producto está en [`FUNLABS.md`](../FUNLABS.md).

## Piezas

| Pieza | Dónde | Qué hace |
| --- | --- | --- |
| Juego | `games/gravity-room/a/index.html` | Versión A de Gravity Room. Los niveles y las reglas están en regiones `@funlabs:locked`; solo la presentación es `@funlabs:editable`. Emite eventos por `postMessage`. |
| Comprobaciones fijas | `lib/checks/suite.ts`, `games/gravity-room/route.json` | Estructura, alcance, inicialización, controles, reinicio, peligros, un recorrido conocido que completa las 3 salas y dibujo sin errores. Se fijan (hash) al publicar el estudio. |
| Alcance de intervenciones | `lib/game/regions.ts`, `lib/game/patch.ts` | Un cambio es un conjunto de pares find/replace que debe caer en regiones editables; el resto del archivo debe quedar idéntico. |
| Esquema | `supabase/migrations/*.sql` | 32 tablas con RLS, buckets privados, Realtime, pg_cron + pg_net + Vault. |
| Interfaz | `app/` | Landing, `/lab` (creador), `/t/[token]` (tester), `/jugar`, `/agentes`, `/estado`. |
| API de agentes | `lib/agent/*`, `app/api/agent/[tool]`, `app/api/mcp` | Mismo contrato por REST y por MCP. |
| Trabajos | `lib/jobs.ts`, `app/api/jobs/*`, `scripts/worker.mjs` | Cola en Postgres (`claim_job` con `SKIP LOCKED`), reintentos con espera creciente. |
| Análisis | `lib/analysis/*` | Gemini (API de Files + salida con esquema) y validación estructural de cada fuente. |
| Intervención | `lib/intervention/*` | Claude (salida estructurada, razonamiento adaptativo, caché de prompt, fallback ante rechazo). |

## Identidades y confianza

- **Creadores** inician sesión con Supabase Auth; todo lo que ven pasa por RLS (`study_members`).
- **Testers** no tienen cuenta: su invitación (`flt_...`) es la credencial; solo se guarda su hash.
- **Agentes** usan credenciales de trabajo (`fla_...`) con actor, estudio o producto, capacidades y caducidad. Nunca una clave administrativa.
- **El backend** actúa con una identidad dedicada (`app_metadata.funlabs_role = 'worker'`) a la que RLS le concede lo que necesita el procesamiento. No usa la clave de servicio en producción.
- Las versiones del juego corren en un `iframe` con `sandbox="allow-scripts"` y una CSP sin red, en un origen opaco.

## Flujo de datos

1. El titular publica un estudio: se fijan pregunta, objetivo, protocolo, presupuesto y comprobaciones; se encola una corrida de referencia.
2. La persona abre `/t/<token>`, acepta (permisos separados), graba la pestaña y juega. Los eventos se sellan con el reloj de la grabación.
3. Al entregar se encola `analyze_session`. El trabajo sube el video a Gemini, pide hallazgos con intervalo y fuentes, valida que cada referencia exista y pertenezca a la sesión, guarda y borra el archivo en el proveedor.
4. El titular revisa (confirmar, corregir, rechazar con historial) y elige hallazgos; Claude propone ediciones; `applyScopedEdits` las aplica; se registra una versión inmutable y se encola `run_checks`.
5. La variante pasa a `study_versions` solo si todas las comprobaciones pasan. Se abre la comparación: nombres neutrales y orden alternado.
6. Resultados con denominador, orden, motivos y límites. Predicciones de agentes evaluadas contra las preferencias.
7. Export privado de ejemplos con permiso del titular y de cada participante y hallazgos revisados. Nunca incluye video.

## Cómo correr todo localmente

```bash
npm install
npx supabase start -x edge-runtime,vector,logflare,imgproxy,supavisor   # Docker
npx supabase db reset                                                    # aplica supabase/migrations
# Identidad del backend (una vez): genera una contraseña larga y guárdala en .env.local
psql "$SUPABASE_DB_URL" -c "select private.provision_user('worker@funlabs.local', '<contraseña>', '{\"funlabs_role\":\"worker\"}', 'FUNLABS worker')"
cp .env.example .env.local                                               # completar claves
npm run dev
npm test                  # unitarios
npm run db:test           # RLS e integridad (requiere el stack local)
npx vitest run tests/integration   # API de agentes + MCP (requiere app y stack)
npm run test:e2e          # Playwright: circuito humano y circuito A/B
```

## Variables de entorno

Ver `.env.example`. Las claves de proveedores son opcionales: si falta una, el producto muestra el estado "no configurado" en `/estado` y no inventa datos.

## Despliegue

- **Vercel**: el proyecto `funlabs` se conecta al repositorio. Variables necesarias: las de Supabase, `FUNLABS_WORKER_EMAIL`/`FUNLABS_WORKER_PASSWORD`, `FUNLABS_CRON_SECRET`, y las claves de Gemini y Anthropic (o AI Gateway con OIDC, sin claves).
- **Supabase alojado**: aplicar las migraciones en orden, crear la identidad del backend con `private.provision_user` y guardar en Vault `funlabs_jobs_tick_url` y `funlabs_jobs_tick_secret` (ver `scripts/configure-cron.sql`). Con eso, `pg_net` avisa al backend al encolar un trabajo y `pg_cron` revisa cada minuto como respaldo.

## Decisiones y límites

- Los pagos son de modo prueba; `payments_mode` y `livemode` tienen restricciones en la base que impiden otro valor.
- Las comprobaciones corren en un contexto `vm` de Node dentro de la función del servidor. **No es un límite de seguridad**: por eso las intervenciones solo las hace el agente creador y no hay envío de código por agentes externos. Aislar esas ejecuciones (Vercel Sandbox o Supabase Compute) es el paso previo a abrir esa puerta.
- `scripts/worker.mjs` ejecuta el mismo bucle de trabajos fuera de Vercel. Cada trabajo registra dónde corrió (`runner`). No se anuncia como Supabase Compute: el aprovisionamiento no fue verificado.
- Todo el material de los ensayos viene de bots y está marcado como `is_rehearsal`. Ninguna persona real ha usado el producto todavía.
