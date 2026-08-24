#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// ¿Sirven las credenciales que voy a guardar como secretos E2E?
// ════════════════════════════════════════════════════════════════════════════
// EL AGUJERO QUE ESTO TAPA. Las cuatro credenciales de los E2E
// (E2E_LOGIN_EMAIL/PASSWORD, E2E_RESTRICTED_EMAIL/PASSWORD) se guardan a ciegas
// en GitHub y la primera señal de que una está mal llega ~15 minutos después,
// como trece pruebas de Playwright cayendo en un timeout de 20 s que sólo dice
// "el formulario sigue visible". Así pasó en el run 32753812314: el Supabase
// del Preview era el correcto, el bypass funcionaba, y las cuatro credenciales
// estaban mal — Supabase respondía 400 invalid_credentials a cada intento, algo
// que se ve en dos segundos si alguien lo pregunta directamente.
//
// Esto lo pregunta directamente, ANTES de guardar nada:
//
//   VITE_SUPABASE_URL=https://<ref>.supabase.co \
//   VITE_SUPABASE_ANON_KEY=<anon> \
//   E2E_LOGIN_EMAIL=… E2E_LOGIN_PASSWORD=… \
//   E2E_RESTRICTED_EMAIL=… E2E_RESTRICTED_PASSWORD=… \
//   node scripts/verificar-credenciales-e2e.mjs
//
// Usa la ANON key —la misma que el navegador— así que comprueba exactamente lo
// que hará Playwright. La service_role no hace falta y no se acepta.
//
// NUNCA imprime una contraseña: los mensajes nombran la VARIABLE, no su valor.
// El email sí se imprime: sin él no se puede saber cuál de las dos cuentas
// falla, y no es un secreto (es una cuenta de juguete en @sandbox.invalid).
// ════════════════════════════════════════════════════════════════════════════

/** Las dos parejas que la suite necesita, con lo que cada una representa. */
export const PAREJAS = [
  {
    email: 'E2E_LOGIN_EMAIL',
    password: 'E2E_LOGIN_PASSWORD',
    papel: 'usuario principal (entra al shell autenticado y recorre agua/condominios/contabilidad)',
  },
  {
    email: 'E2E_RESTRICTED_EMAIL',
    password: 'E2E_RESTRICTED_PASSWORD',
    papel: 'usuario RESTRINGIDO (viewer/operator: debe ver "Acceso Denegado" en /superadmin, /empresa y /admin-dashboard)',
  },
]

/**
 * Traduce la respuesta de /auth/v1/token a un veredicto accionable.
 * Pura: recibe lo que ya se descargó, para poder probarla sin red.
 *
 * @param {number} status
 * @param {any} cuerpo  el JSON de Supabase (o null si no era JSON)
 * @returns {{ ok: boolean, motivo: string }}
 */
export function interpretar(status, cuerpo) {
  if (status === 200 && cuerpo?.access_token) {
    return { ok: true, motivo: 'login correcto' }
  }

  const codigo = cuerpo?.error_code || cuerpo?.error || ''
  const descripcion = cuerpo?.msg || cuerpo?.error_description || cuerpo?.message || ''

  if (codigo === 'invalid_credentials' || /invalid login credentials/i.test(descripcion)) {
    return {
      ok: false,
      motivo:
        'Supabase respondió "Invalid login credentials". O el usuario no existe en ESTE ' +
        'proyecto, o la contraseña no es la vigente. Si las cuentas vienen de ' +
        'scripts/seed-rls-sandbox.mjs, recordá que CADA corrida del seed las rota: sirve ' +
        'la contraseña de la ÚLTIMA corrida, y hay que actualizar también los secretos RLS_*.',
    }
  }
  if (codigo === 'email_not_confirmed' || /email not confirmed/i.test(descripcion)) {
    return { ok: false, motivo: 'El usuario existe pero tiene el email SIN confirmar: no puede iniciar sesión.' }
  }
  if (status === 400 && /password/i.test(descripcion)) {
    return { ok: false, motivo: `Supabase rechazó la petición: ${descripcion}` }
  }
  if (status === 401 || status === 403) {
    // Un 401/403 de Supabase SIEMPRE trae cuerpo JSON con su error. Uno sin
    // cuerpo reconocible no vino de Supabase: lo puso algo en el camino — un
    // proxy corporativo, un firewall, un portal cautivo. Decir "tu anon key
    // está mal" ahí manda a corregir lo que no está roto (me pasó: el sandbox
    // desde el que se escribió esto tiene *.supabase.co bloqueado y el
    // gateway contesta 403 al CONNECT).
    if (!codigo && !descripcion) {
      return {
        ok: false,
        motivo:
          `HTTP ${status} SIN cuerpo de error de Supabase: lo más probable es que la ` +
          'petición no haya llegado a Supabase (proxy, firewall o VPN cortando ' +
          `${'*.supabase.co'}). Comprobalo con: curl -sS -o /dev/null -w '%{http_code}\\n' ` +
          '"$VITE_SUPABASE_URL/auth/v1/health" — si eso tampoco responde 200, es la red.',
      }
    }
    return {
      ok: false,
      motivo:
        `HTTP ${status} (${codigo || descripcion}). La ANON key no corresponde a este ` +
        'proyecto, o está vencida. Copiala de Supabase → Settings → API → anon/public ' +
        'del MISMO proyecto que la URL.',
    }
  }
  if (status === 429) {
    return { ok: false, motivo: 'HTTP 429: Supabase está limitando los intentos. Esperá un minuto y repetí.' }
  }
  return {
    ok: false,
    motivo: `HTTP ${status}${codigo ? ` (${codigo})` : ''}${descripcion ? `: ${descripcion}` : ''}`,
  }
}

/** El ref del proyecto sale del hostname: <ref>.supabase.co */
export function refDeUrl(url) {
  try {
    const h = new URL(url).hostname
    return h.endsWith('.supabase.co') ? h.slice(0, -'.supabase.co'.length) : null
  } catch {
    return null
  }
}

/** Qué falta para poder siquiera intentarlo. */
export function faltantes(env) {
  const necesarias = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']
  for (const p of PAREJAS) necesarias.push(p.email, p.password)
  return necesarias.filter((n) => !env[n])
}

async function probar({ url, anon, email, password, fetchImpl }) {
  let r
  try {
    r = await fetchImpl(new URL('/auth/v1/token?grant_type=password', url), {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
      headers: { apikey: anon, authorization: `Bearer ${anon}`, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
  } catch (e) {
    const causa = e?.cause?.code || e?.cause?.message
    return { ok: false, motivo: `no se pudo contactar a Supabase: ${e?.message}${causa ? ` — ${causa}` : ''}` }
  }
  const cuerpo = await r.json().catch(() => null)
  return interpretar(r.status, cuerpo)
}

export async function main(env = process.env, fetchImpl = fetch, log = console.log, err = console.error) {
  const falta = faltantes(env)
  if (falta.length > 0) {
    err(`Faltan variables: ${falta.join(', ')}.`)
    err('Ver el encabezado de este archivo para el comando completo.')
    return 1
  }

  const url = env.VITE_SUPABASE_URL
  const ref = refDeUrl(url)
  log(`Proyecto Supabase: ${ref ?? url}`)
  if (env.E2E_EXPECTED_SUPABASE_REF && ref && env.E2E_EXPECTED_SUPABASE_REF !== ref) {
    err(
      `⚠️  E2E_EXPECTED_SUPABASE_REF dice "${env.E2E_EXPECTED_SUPABASE_REF}" pero la URL apunta a ` +
        `"${ref}". El preflight del job rechazará el despliegue por esa discrepancia.`,
    )
  }

  let malas = 0
  for (const pareja of PAREJAS) {
    const email = env[pareja.email]
    const veredicto = await probar({
      url,
      anon: env.VITE_SUPABASE_ANON_KEY,
      email,
      password: env[pareja.password],
      fetchImpl,
    })
    if (veredicto.ok) {
      log(`✅ ${pareja.email}=${email} — ${veredicto.motivo}`)
    } else {
      malas += 1
      err(`❌ ${pareja.email}=${email} (${pareja.password}) — ${veredicto.motivo}`)
      err(`   Este par es el ${pareja.papel}.`)
    }
  }

  if (malas > 0) {
    err(`\n${malas} de ${PAREJAS.length} pares NO sirven. Corregilos ANTES de guardarlos como secretos.`)
    return 1
  }

  log(
    '\nLos dos pares inician sesión. Queda una condición que esto NO comprueba: ambos ' +
      'usuarios tienen que pertenecer a la MISMA empresa, y el restringido NO puede ser ' +
      'admin ni company_owner — si lo fuera, vería las secciones de administración y los ' +
      'specs de "Acceso Denegado" fallarían.',
  )
  return 0
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main())
}
