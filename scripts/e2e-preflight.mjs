#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Preflight FAIL-CLOSED del job "E2E (caminos de dinero/auth)".
// ════════════════════════════════════════════════════════════════════════════
// Decide, ANTES de instalar dependencias o abrir un navegador, si la suite
// Playwright puede correr y CONTRA QUÉ. Tres desenlaces, y sólo UNO deja el
// check en verde:
//
//   run       — están las SEIS variables obligatorias y algún candidato de
//               URL pasó la validación POSITIVA: su /e2e-meta.json declara
//               environment=e2e-sandbox, el supabase_project_ref esperado y el
//               MISMO commit que este job está probando. Exit 0, publicando la
//               URL elegida como output `url`.
//   bloqueado — GitHub no entrega los Actions secrets por diseño (PR de fork o
//               de dependabot[bot]). Exit 1: el check queda ROJO.
//   fail      — TODO lo demás: falta una variable, ningún candidato validó, o
//               el único disponible es de producción / http / SHA viejo.
//
// VALIDACIÓN POSITIVA, DENYLIST COMO SEGUNDA DEFENSA. Una denylist sólo veta lo
// que alguien pensó en vetar: un alias nuevo de producción pasaría. Por eso el
// contrato es al revés: el despliegue tiene que DEMOSTRAR que es el entorno de
// pruebas, publicando en /e2e-meta.json (scripts/generar-e2e-meta.mjs, colgado
// del build) el marcador `environment=e2e-sandbox` —que sólo lleva un build con
// VITE_E2E_ENVIRONMENT=e2e-sandbox—, el ref de Supabase al que apunta, y el
// commit del que se construyó. Producción no puede pasar esa prueba aunque
// nadie la haya listado. La denylist de HOSTS_PRODUCCION (los hosts que declara
// vercel.json) se conserva delante: a un host de producción no se le hace ni el
// fetch.
//
// EL SHA CIERRA LA VENTANA DEL DESPLIEGUE VIEJO. Sin él, una URL estable
// validaría el commit de la semana pasada y lo llamaría "este PR". El preflight
// exige meta.commit_sha === SHA_ESPERADO (en pull_request es el HEAD del PR, no
// el merge commit — lo fija el workflow). Los candidatos se RESUELVEN por ese
// mismo SHA vía la API de Deployments de GitHub (los deploys de Vercel quedan
// registrados ahí con su environment_url), y E2E_BASE_URL —ahora OPCIONAL— es
// sólo un candidato más, sometido a las mismas comprobaciones.
//
// SIN service_role. Este job no la recibe, no la valida y no la necesita: el
// despliegue de pruebas usa la anon key de su sandbox, como cualquier cliente.
//
// VERCEL DEPLOYMENT PROTECTION, FAIL-CLOSED. Un Preview protegido devuelve 401
// a cualquier visitante sin sesión de Vercel — el fetch de /e2e-meta.json y el
// navegador de Playwright incluidos. El bypass oficial (Protection Bypass for
// Automation) es un token que viaja en el header x-vercel-protection-bypass;
// x-vercel-set-bypass-cookie: true hace que Vercel siembre además la cookie,
// para que las navegaciones y assets subsecuentes pasen sin repetir el header.
// E2E_VERCEL_BYPASS_TOKEN es OBLIGATORIO (sin él, la suite contra un Preview
// protegido fallaría con un 401 indistinguible de un bug) y NUNCA se imprime:
// ni en logs, ni en motivos de rechazo, ni en el step summary.
//
// Vive en Node y no inline en el YAML para poder probarlo:
// `scripts/__tests__/e2e-preflight.test.mjs` cubre la tabla de decisión.
// ════════════════════════════════════════════════════════════════════════════

import { appendFileSync } from 'node:fs'

import { motivoSinSecretos } from './rls-preflight.mjs'

/**
 * Las SEIS obligatorias. Sus NOMBRES no son secretos.
 *
 * E2E_BASE_URL ya no está entre ellas: la URL puede resolverse del despliegue
 * del propio SHA. E2E_EXPECTED_SUPABASE_REF sí lo está, y por la misma razón
 * que RLS_EXPECTED_PROJECT_REF en el harness: es la DECLARACIÓN de contra qué
 * proyecto se opera; sin ella, cambiar un secreto bastaría para apuntar la
 * suite a otro proyecto sin que nada lo note.
 *
 * E2E_VERCEL_BYPASS_TOKEN es el Protection Bypass for Automation de Vercel:
 * sin él, un Preview protegido devuelve 401 al preflight y al navegador, y el
 * fallo sería indistinguible de un bug de la app. Su VALOR jamás se imprime.
 */
export const VARIABLES_OBLIGATORIAS = [
  'E2E_LOGIN_EMAIL',
  'E2E_LOGIN_PASSWORD',
  'E2E_RESTRICTED_EMAIL',
  'E2E_RESTRICTED_PASSWORD',
  'E2E_EXPECTED_SUPABASE_REF',
  'E2E_VERCEL_BYPASS_TOKEN',
]

/**
 * Las DOS condicionales, con su razón estructural — no son "opcionales porque
 * nadie las puso":
 *
 *   · E2E_INVITE_TOKEN: un token de invitación es FRESCO y de un solo uso; el
 *     spec lo consume al aceptarla. No puede vivir como secreto estático del
 *     repo — estaría vencido en la segunda corrida.
 *   · E2E_FISCAL_SANDBOX_READY: declara que el despliegue de pruebas tiene PAC
 *     sandbox y configuración fiscal cargada. Depende de credenciales de un
 *     tercero, no de este repo.
 *
 * Si están ausentes, scripts/e2e-verificar.mjs exige que su spec haya quedado
 * como "omitido declarado"; si están PRESENTES y su spec no corrió, el job
 * falla.
 */
export const VARIABLES_CONDICIONALES = ['E2E_INVITE_TOKEN', 'E2E_FISCAL_SANDBOX_READY']

/**
 * SEGUNDA defensa: hosts de PRODUCCIÓN a los que ni siquiera se les hace el
 * fetch de metadata. La lista replica los hosts que vercel.json declara como
 * producción; un guard de las pruebas de contrato exige que no diverjan. La
 * PRIMERA defensa es la validación positiva de arriba.
 */
export const HOSTS_PRODUCCION = [
  'administratodo.app',
  'www.administratodo.app',
  'administratodo.com',
  'www.administratodo.com',
  'prestadoradeserviciosbasicos.com',
  'www.prestadoradeserviciosbasicos.com',
  'control-consumo-agua.vercel.app',
  'control-consumo-agua-prestadora-de-servicios-projects.vercel.app',
  'control-consumo-agua-git-main-prestadora-de-servicios-projects.vercel.app',
]

/**
 * Valida la FORMA de un candidato antes de tocarlo: URL bien formada, https
 * (salvo localhost) y fuera de la denylist de producción.
 *
 * @returns {{ ok: boolean, motivo?: string }}
 */
export function validarBaseUrl(url) {
  let u
  try {
    u = new URL(url)
  } catch {
    return { ok: false, motivo: `no es una URL válida: "${url}".` }
  }

  const host = u.hostname.toLowerCase()
  const esLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1'

  if (HOSTS_PRODUCCION.includes(host)) {
    return {
      ok: false,
      motivo:
        `apunta a PRODUCCIÓN (${host}). La suite escribe datos (lecturas, facturas, ` +
        'pagos, invitaciones): ni siquiera se le consulta la metadata.',
    }
  }

  const raicesProhibidas = ['administratodo.app', 'administratodo.com', 'prestadoradeserviciosbasicos.com']
  if (raicesProhibidas.some((r) => host === r || host.endsWith(`.${r}`))) {
    return { ok: false, motivo: `apunta a un subdominio de producción (${host}).` }
  }

  if (u.protocol !== 'https:' && !esLocal) {
    return {
      ok: false,
      motivo: `usa ${u.protocol}// hacia un host remoto (${host}): las credenciales de prueba viajarían en claro.`,
    }
  }

  return { ok: true }
}

/**
 * Validación POSITIVA de la metadata que publica el despliegue.
 *
 * @param {object|null} meta  lo que devolvió /e2e-meta.json (null = no se pudo leer)
 * @param {{ sha: string, ref: string }} esperado
 * @returns {{ ok: boolean, motivo?: string }}
 */
export function validarMetadata(meta, { sha, ref }) {
  if (!meta || typeof meta !== 'object') {
    return {
      ok: false,
      motivo:
        'no publica /e2e-meta.json. Sin metadata no hay validación positiva: el build ' +
        'tiene que salir de `npm run build` (que la genera) — un despliegue anterior a ' +
        'este PR, u otro sitio, no puede demostrarlo.',
    }
  }
  if (meta.environment !== 'e2e-sandbox') {
    return {
      ok: false,
      motivo:
        `no se declara entorno de pruebas (environment=${JSON.stringify(meta.environment ?? null)}). ` +
        'Sólo un build con VITE_E2E_ENVIRONMENT=e2e-sandbox lleva el marcador: producción ' +
        'y cualquier alias desconocido fallan aquí aunque no estén en ninguna denylist.',
    }
  }
  if (!meta.supabase_project_ref || meta.supabase_project_ref !== ref) {
    return {
      ok: false,
      motivo:
        `apunta al proyecto Supabase ${JSON.stringify(meta.supabase_project_ref ?? null)} y el ` +
        `declarado en E2E_EXPECTED_SUPABASE_REF es "${ref}". La suite escribe: no se corre ` +
        'contra un proyecto distinto del declarado.',
    }
  }
  if (!meta.commit_sha || meta.commit_sha !== sha) {
    return {
      ok: false,
      motivo:
        `corre el commit ${JSON.stringify(meta.commit_sha ?? null)} y este job prueba ${sha}. ` +
        'Un despliegue viejo validaría código que ya no es el del PR: redeployá esta rama ' +
        '(o esperá a que Vercel termine su deploy) y relanzá el job.',
    }
  }
  return { ok: true }
}

/**
 * Elige el destino entre candidatos ya consultados. Pura para poder probarla:
 * cada candidato llega como { url, meta, errorFetch? }.
 *
 * @returns {{ ok: true, url: string } | { ok: false, motivos: string[] }}
 */
export function decidirDestino(candidatos, esperado) {
  const motivos = []
  for (const { url, meta, errorFetch } of candidatos) {
    const forma = validarBaseUrl(url)
    if (!forma.ok) {
      motivos.push(`${url} → ${forma.motivo}`)
      continue
    }
    if (errorFetch) {
      motivos.push(`${url} → no respondió /e2e-meta.json (${errorFetch}).`)
      continue
    }
    const positiva = validarMetadata(meta, esperado)
    if (!positiva.ok) {
      motivos.push(`${url} → ${positiva.motivo}`)
      continue
    }
    return { ok: true, url }
  }
  if (candidatos.length === 0) {
    motivos.push(
      'no hay ningún candidato de URL: la API de Deployments no registró NINGÚN despliegue ' +
        'con status success para este SHA dentro de la ventana de espera, y E2E_BASE_URL no ' +
        'está configurada. Revisá en Vercel si el build de este commit falló o quedó en cola ' +
        'más tiempo del que el preflight espera.',
    )
  }
  return { ok: false, motivos }
}

/** Cómo desbloquear un PR que no puede recibir secretos. Sin esto, "rojo" es un callejón. */
const COMO_DESBLOQUEAR = [
  'Cómo desbloquear este PR (en este orden):',
  '1. Reproducí el cambio en una rama INTERNA del repositorio (`git checkout -b … && git cherry-pick …`',
  '   o `gh pr checkout` y push a una rama del propio repo). Ahí los Actions secrets sí llegan.',
  '2. Comprobá que el job `E2E (caminos de dinero/auth)` pasa en verde sobre ESE commit,',
  '   con pruebas ejecutadas > 0 (lo exige scripts/e2e-verificar.mjs).',
  '3. Fusioná esa rama interna. El PR original se puede cerrar como duplicado.',
  '',
  'Lo que NO cuenta como verificación: fusionar y esperar al push a `main`. Para cuando',
  'ese job falle, el cambio ya está en main — eso es detección, no prevención.',
]

/**
 * Primera fase de la decisión: variables y contexto. Pura.
 *
 * @returns {{ decision: 'candidatos'|'bloqueado'|'fail', faltan: string[],
 *             motivo: object|null, mensaje: string }}
 */
export function decidirPreflight(env = {}) {
  const faltan = VARIABLES_OBLIGATORIAS.filter((v) => !env[v])

  if (faltan.length > 0) {
    const motivo = motivoSinSecretos({
      esFork: env.ES_FORK,
      actor: env.GITHUB_ACTOR,
      evento: env.GITHUB_EVENT_NAME,
    })

    if (motivo) {
      return {
        decision: 'bloqueado',
        faltan,
        motivo,
        mensaje:
          `Suite E2E NO ejecutada (${motivo.titulo}). ${motivo.detalle} ` +
          'El check queda en rojo a propósito: un verde aquí autorizaría a fusionar ' +
          'un cambio cuyos caminos de dinero/auth nadie verificó.',
      }
    }

    return {
      decision: 'fail',
      faltan,
      motivo: null,
      mensaje:
        `Faltan ${faltan.length} de ${VARIABLES_OBLIGATORIAS.length} variables E2E obligatorias (${faltan.join(' ')}). ` +
        'El job falla en vez de quedar verde: un verde sin ejecutar se contabiliza ' +
        'como cobertura que no existe. Configuralas en Settings → Secrets and ' +
        'variables → Actions. Ver e2e/README.md.',
    }
  }

  if (!env.SHA_ESPERADO) {
    return {
      decision: 'fail',
      faltan,
      motivo: null,
      mensaje:
        'SHA_ESPERADO no llegó al preflight: sin él no se puede exigir que el despliegue ' +
        'corra ESTE commit. Es un bug del workflow, no de los secretos.',
    }
  }

  return { decision: 'candidatos', faltan, motivo: null, mensaje: '' }
}

/**
 * Resuelve las URLs de despliegue registradas para el SHA vía la API de
 * Deployments de GitHub (los deploys de Vercel aparecen ahí con su
 * environment_url en el status "success").
 */
export async function resolverUrlsPorSha({ repo, sha, token, fetchImpl = fetch }) {
  if (!repo || !token) return []
  const cab = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'user-agent': 'e2e-preflight',
  }
  const urls = []
  try {
    const rDeps = await fetchImpl(`https://api.github.com/repos/${repo}/deployments?sha=${sha}&per_page=20`, { headers: cab })
    if (!rDeps.ok) return []
    const deps = await rDeps.json()
    for (const d of deps) {
      const rSt = await fetchImpl(`https://api.github.com/repos/${repo}/deployments/${d.id}/statuses?per_page=10`, { headers: cab })
      if (!rSt.ok) continue
      const sts = await rSt.json()
      const exito = sts.find((s) => s.state === 'success' && s.environment_url)
      if (exito) urls.push(exito.environment_url)
    }
  } catch {
    return urls
  }
  return [...new Set(urls)]
}

/**
 * Cuánto espera el preflight a que Vercel registre el despliegue del SHA.
 * El workflow arranca con el `pull_request` del push, y Vercel tarda ~1 min en
 * construir: consultar la API UNA sola vez pierde esa carrera SIEMPRE (el job
 * fallaba a los 40 s con "no hay ningún candidato" mientras el Preview quedaba
 * Ready segundos después). Esperar no afloja el fail-closed: al agotarse la
 * ventana el job sigue rojo — sólo deja de confundir "todavía no está" con
 * "no existe".
 */
export const ESPERA_DESPLIEGUE_MS = 900_000
export const INTERVALO_SONDEO_MS = 15_000

/**
 * Sondea `resolverUrlsPorSha` hasta que aparezca un despliegue con status
 * success para el SHA, o hasta agotar `tiempoMaxMs` (entonces devuelve []).
 * El reloj, la espera y el log entran por parámetro para poder probarla sin
 * dormir de verdad.
 */
export async function esperarUrlsPorSha({
  repo,
  sha,
  token,
  fetchImpl = fetch,
  tiempoMaxMs = ESPERA_DESPLIEGUE_MS,
  intervaloMs = INTERVALO_SONDEO_MS,
  dormir = (ms) => new Promise((r) => setTimeout(r, ms)),
  ahora = () => Date.now(),
  registrar = console.log,
}) {
  // Sin repo o sin token `resolverUrlsPorSha` no puede consultar nada: sondear
  // sería quemar la ventana entera para obtener el mismo [] del primer intento.
  if (!repo || !token) return []

  const inicio = ahora()
  const seg = (ms) => Math.round(ms / 1000)
  for (let intento = 1; ; intento += 1) {
    const urls = await resolverUrlsPorSha({ repo, sha, token, fetchImpl })
    if (urls.length > 0) {
      if (intento > 1) {
        registrar(`✅ Despliegue registrado para ${sha.slice(0, 8)} tras ${seg(ahora() - inicio)}s de espera.`)
      }
      return urls
    }
    const transcurrido = ahora() - inicio
    if (transcurrido + intervaloMs > tiempoMaxMs) return []
    registrar(
      `⏳ Todavía no hay despliegue con status success para ${sha.slice(0, 8)} ` +
        `(${seg(transcurrido)}s de ${seg(tiempoMaxMs)}s). Reintento en ${seg(intervaloMs)}s.`,
    )
    await dormir(intervaloMs)
  }
}

/**
 * Descarga /e2e-meta.json del candidato. Si hay bypass de Vercel, viaja como
 * header (x-vercel-protection-bypass) — el VALOR del token no aparece en
 * ningún mensaje: un 401/403 se reporta como "la protección rechazó el
 * acceso", nombrando la VARIABLE, nunca su contenido.
 */
export const HEADER_BYPASS = 'x-vercel-protection-bypass'
export const HEADER_SIEMBRA_COOKIE = 'x-vercel-set-bypass-cookie'

const esRedirect = (status) => typeof status === 'number' && status >= 300 && status < 400

/**
 * Origen + ruta del Location, SIN query: la pantalla de autenticación de Vercel
 * devuelve un `_vercel_share=<token>` en la URL y ese token no tiene por qué
 * quedar escrito en el log del job.
 */
function destinoDeRedirect(r) {
  const bruto = r?.headers?.get?.('location') || ''
  if (!bruto) return 'sin Location'
  try {
    const u = new URL(bruto)
    return `${u.origin}${u.pathname}`
  } catch {
    return bruto.split('?')[0]
  }
}

/** Mismo diagnóstico para 3xx y 401/403: el bypass no se aplicó. */
function motivoProteccion(prefijo) {
  return (
    `${prefijo} — la Deployment Protection de Vercel no dejó pasar la petición. ` +
    'El header x-vercel-protection-bypass SE ENVIÓ, así que el token no fue aceptado: ' +
    'E2E_VERCEL_BYPASS_TOKEN está mal copiado, vencido, o no es el secreto de ' +
    '"Protection Bypass for Automation" de ESTE proyecto. Regeneralo en Vercel → ' +
    'Settings → Deployment Protection y actualizá el secreto en GitHub Actions.'
  )
}

export async function leerMeta(url, fetchImpl = fetch, bypassToken = '') {
  const headers = { accept: 'application/json' }
  if (bypassToken) {
    headers[HEADER_BYPASS] = bypassToken
    headers[HEADER_SIEMBRA_COOKIE] = 'true'
  }
  try {
    const r = await fetchImpl(new URL('/e2e-meta.json', url), {
      signal: AbortSignal.timeout(15_000),
      // MANUAL a propósito: si el bypass no se aplica, Vercel responde 3xx
      // hacia su pantalla de autenticación. Siguiendo el redirect el fallo
      // llegaba como un "fetch failed" opaco (o un JSON inválido) y el
      // operador no tenía forma de saber que el problema era el token.
      redirect: 'manual',
      headers,
    })
    if (esRedirect(r.status)) {
      return { meta: null, errorFetch: motivoProteccion(`HTTP ${r.status} → ${destinoDeRedirect(r)}`) }
    }
    if (r.status === 401 || r.status === 403) {
      return { meta: null, errorFetch: motivoProteccion(`HTTP ${r.status}`) }
    }
    if (!r.ok) return { meta: null, errorFetch: `HTTP ${r.status}` }
    return { meta: await r.json(), errorFetch: null }
  } catch (e) {
    // undici envuelve TODO fallo de transporte como "fetch failed" y deja el
    // motivo real (ENOTFOUND, ECONNREFUSED, redirect count exceeded…) en
    // `cause`. Sin esto el log no distingue un DNS caído de una protección.
    const causa = e?.cause?.code || e?.cause?.message
    return { meta: null, errorFetch: `${e?.message ?? 'fetch falló'}${causa ? ` — causa: ${causa}` : ''}` }
  }
}

function resumen(titulo, cuerpo) {
  if (!process.env.GITHUB_STEP_SUMMARY) return
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${titulo}\n\n${cuerpo}\n`)
}

export async function main(env = process.env, fetchImpl = fetch) {
  const r = decidirPreflight(env)

  if (r.decision === 'bloqueado') {
    console.error(`::error title=E2E bloqueado (${r.motivo.titulo})::${r.mensaje}`)
    resumen(`🚫 E2E bloqueado — ${r.motivo.titulo}`, `${r.mensaje}\n\n${COMO_DESBLOQUEAR.join('\n')}`)
    return 1
  }
  if (r.decision === 'fail') {
    console.error(`::error title=E2E sin configurar::${r.mensaje}`)
    resumen('❌ E2E no ejecutado', r.mensaje)
    return 1
  }

  // Candidatos: primero los despliegues registrados para ESTE sha, después la
  // URL estática si existe — sometida exactamente a las mismas comprobaciones.
  const esperado = { sha: env.SHA_ESPERADO, ref: env.E2E_EXPECTED_SUPABASE_REF }
  const resueltas = await esperarUrlsPorSha({
    repo: env.GITHUB_REPOSITORY,
    sha: env.SHA_ESPERADO,
    token: env.GITHUB_TOKEN,
    fetchImpl,
    // Con E2E_BASE_URL explícita ya hay un candidato que evaluar: una sola
    // consulta y adelante, sin quemar la ventana esperando a Vercel.
    tiempoMaxMs: env.E2E_BASE_URL ? 0 : ESPERA_DESPLIEGUE_MS,
  })
  const urls = [...resueltas]
  if (env.E2E_BASE_URL && !urls.includes(env.E2E_BASE_URL)) urls.push(env.E2E_BASE_URL)

  const candidatos = []
  for (const url of urls) {
    if (!validarBaseUrl(url).ok) {
      candidatos.push({ url, meta: null, errorFetch: null })
      continue
    }
    const { meta, errorFetch } = await leerMeta(url, fetchImpl, env.E2E_VERCEL_BYPASS_TOKEN)
    candidatos.push({ url, meta, errorFetch })
  }

  const destino = decidirDestino(candidatos, esperado)
  if (!destino.ok) {
    const detalle = destino.motivos.map((m) => `  · ${m}`).join('\n')
    console.error(
      `::error title=E2E sin destino válido::Ningún candidato pasó la validación positiva ` +
        `(sha=${esperado.sha.slice(0, 8)}, ref esperado=${esperado.ref}).`,
    )
    console.error(detalle)
    resumen('❌ E2E sin destino válido', `Candidatos evaluados:\n\n${detalle}\n\nVer e2e/README.md.`)
    return 1
  }

  console.log(
    `✅ Destino E2E validado: ${destino.url} — environment=e2e-sandbox, ` +
      `ref=${esperado.ref}, commit=${esperado.sha.slice(0, 8)} (el de este job).`,
  )
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `url=${destino.url}\n`)
  return 0
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code))
}
