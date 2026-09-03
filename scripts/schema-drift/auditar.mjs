#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Auditor de drift de esquema: repositorio ↔ producción
// ════════════════════════════════════════════════════════════════════════════
//
// EL AGUJERO QUE CIERRA. `src/test/rls/rlsHarness.test.ts` afirma por escrito
// que `payment_requests` no tiene policy de SELECT y que anon no lee ni una
// fila. El harness corre contra un esquema construido desde el repositorio, así
// que pasa. Producción tiene
//   payment_requests_select · SELECT · TO public · USING (true)
// que el repositorio no declara en ninguna migración. El test estaba verde y
// mentía — exactamente lo que #825 se propuso que no volviera a pasar.
//
// Ese es el patrón: cuando el repositorio no describe producción, TODA garantía
// que se verifique contra el repositorio deja de significar algo sobre
// producción. El drift no es cosmético: es el mecanismo por el que un CI verde
// deja de ser evidencia.
//
// CÓMO FUNCIONA — TRES VÍAS
//   1. Reconstruye el esquema desde las migraciones del árbol de trabajo (R) y,
//      en un clúster aparte, desde las de la rama base (M).
//   2. Saca la huella normalizada de cada uno (fingerprint.sql, el mismo para
//      los dos: hashear cada lado distinto mediría el auditor, no el esquema).
//   3. Las compara contra `huella-produccion.json` (P), la instantánea del
//      catálogo real de producción.
//   4. Grupo por grupo:
//        M == R              el PR no lo toca      → trinquete estricto vs P
//        P == M, R ≠ M       falta desplegarlo     → CAMBIO PLANIFICADO, pasa
//        R == P, M ≠ P       el PR cierra el drift → DRIFT RESUELTO, pasa
//        P ≠ M ≠ R ≠ P       nadie coincide        → CAMBIO AMBIGUO, falla
//      Las reglas viven en tres-vias.mjs, que es puro y se prueba sin Postgres.
//
// POR QUÉ HACÍA FALTA EL TERCER PUNTO. Con sólo P y R, «alguien tocó producción
// por fuera» y «este PR agrega una migración que todavía no se desplegó» se ven
// exactamente igual. #828 lo dejó a la vista: cerrar la lectura sin autenticar
// de `payment_requests` puso el auditor en rojo por hacer justo lo que había que
// hacer. Un auditor que castiga la corrección enseña a ampliar la baseline —el
// hábito que este auditor existe para impedir.
//
// UN CAMBIO PLANIFICADO NO ES DRIFT Y NO SE DECLARA. No entra en
// `drift-conocido.json`: se reporta como pendiente de despliegue y desaparece
// solo cuando la migración llega a producción y se refresca la instantánea.
//
// LA BASELINE SÓLO PUEDE ENCOGER. Es un trinquete deliberado: si el drift
// resuelto no obligara a podar la lista, la baseline se volvería un `permitir
// todo` de facto — el mismo razonamiento que el `_README` de
// scripts/migraciones-vs-produccion.allowlist.json. La baseline de la rama base
// se compara contra la de HEAD, para que un PR no pueda agrandarla; y un cambio
// planificado pasa SIN tocarla, así que ya no hay incentivo para ampliarla.
//
// NADA DE DATOS, NADA REVERSIBLE. La huella es DDL agregado y hasheado: ni una
// fila, ni un `count(*)` de negocio, ni nada fuera del esquema `public`. Los
// archivos versionados guardan sólo `clave → sha256(64 hex):nº de objetos`, y de
// un SHA-256 no se reconstruye el DDL. Hay un guard en `__tests__` que falla si
// algo con forma de secreto se cuela.

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reconstruir, huella, listarMigraciones, DIR_MIGRACIONES } from './reconstruir.mjs'
import { evaluarTresVias, diffMigraciones, informe } from './tres-vias.mjs'
import { materializarMigraciones, migracionesEnDisco, migracionesEnRef, resolverRefBase } from './base-git.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
export const RUTA_PRODUCCION = join(AQUI, 'huella-produccion.json')
export const RUTA_FINGERPRINT = join(AQUI, 'fingerprint.sql')
export const RUTA_BASELINE = join(AQUI, 'drift-conocido.json')

// ── funciones puras (las prueba __tests__/auditar.test.mjs) ─────────────────

/** Marca de «este grupo no existe de ese lado». */
export const AUSENTE = 'AUSENTE'

/**
 * Una huella de grupo es un SHA-256 completo más el número de objetos.
 * 64 hex, minúsculas, sin truncar: un md5 recortado a 12 hex son 48 bits, y una
 * colisión ahí significa exactamente «drift que el auditor no ve».
 */
export const RE_HUELLA = /^[0-9a-f]{64}$/
export const RE_HUELLA_CON_N = /^[0-9a-f]{64}:\d+$/

/** ¿El valor es una huella válida, o la marca de ausencia? */
export function esHuellaValida(valor) {
  return valor === AUSENTE || RE_HUELLA_CON_N.test(String(valor))
}

/** Texto de huella (`clave\thuella\tn` por línea) → Map clave → {huella, n}. */
export function parsearHuella(texto) {
  const mapa = new Map()
  for (const linea of String(texto).split('\n')) {
    const l = linea.trim()
    if (!l) continue
    const [clave, h, n] = l.split('\t')
    if (!clave || !h) throw new Error(`Línea de huella mal formada: ${l.slice(0, 120)}`)
    if (!RE_HUELLA.test(h)) {
      throw new Error(
        `Huella que no es un SHA-256 de 64 hex en «${clave}»: «${String(h).slice(0, 80)}». ` +
        'Una huella truncada o de otro algoritmo no se compara: se aborta.',
      )
    }
    mapa.set(clave, { huella: h, n: Number(n ?? 0) })
  }
  return mapa
}

/**
 * Grupos que difieren entre dos huellas. Un grupo ausente de un lado cuenta
 * como diferencia (`AUSENTE`), que es como se ve una tabla o una policy que
 * existe sólo en producción.
 */
export function calcularDrift(produccion, repo) {
  const claves = [...new Set([...produccion.keys(), ...repo.keys()])].sort()
  const drift = []
  for (const clave of claves) {
    const p = produccion.get(clave)
    const r = repo.get(clave)
    if (p?.huella === r?.huella) continue
    drift.push({
      clave,
      produccion: p ? `${p.huella}:${p.n}` : AUSENTE,
      repo: r ? `${r.huella}:${r.n}` : AUSENTE,
    })
  }
  return drift
}

/** Claves declaradas en la baseline (las que empiezan por `_` son prosa). */
export function clavesDeBaseline(baseline) {
  return new Set(Object.keys(baseline?.grupos ?? {}))
}

/**
 * Veredicto:
 *   `nuevo`     drift en un grupo que la baseline no declara → romper.
 *   `agravado`  grupo declarado, pero las huellas ya no son las que se midieron
 *               → el drift CAMBIÓ o CRECIÓ dentro de una diferencia conocida →
 *               romper.
 *   `resuelto`  baseline que ya no corresponde a drift → romper, para forzar la
 *               poda en el mismo PR que lo arregla.
 *   `esperado`  lo conocido y sin cambios, que no rompe.
 *
 * POR QUÉ SE FIJAN LAS HUELLAS Y NO SÓLO LA CLAVE. La primera versión declaraba
 * sólo la clave, y la prueba negativa lo delató: inyectar una policy inesperada
 * en `security_logs` no rompía nada, porque `security_logs/policies` ya estaba
 * en la lista. Un grupo baselineado se tragaba cualquier cambio posterior — es
 * decir, la baseline apagaba la alarma justo en las tablas donde más importa.
 * Fijando el par de huellas, la baseline declara *esta* diferencia concreta y no
 * «lo que sea que pase en esta tabla».
 */
export function evaluar(drift, baseline) {
  const grupos = baseline?.grupos ?? {}
  const declaradas = clavesDeBaseline(baseline)
  const actuales = new Set(drift.map(d => d.clave))

  const nuevo = drift.filter(d => !declaradas.has(d.clave))
  const agravado = drift
    .filter(d => declaradas.has(d.clave))
    .filter(d => {
      const e = grupos[d.clave]
      return e.produccion !== d.produccion || e.repo !== d.repo
    })
    .map(d => ({ ...d, esperadoProduccion: grupos[d.clave].produccion, esperadoRepo: grupos[d.clave].repo }))
  const resuelto = [...declaradas].filter(c => !actuales.has(c)).sort()
  const esperado = drift.filter(d => declaradas.has(d.clave) && !agravado.some(a => a.clave === d.clave))

  return {
    nuevo, agravado, resuelto, esperado,
    ok: nuevo.length === 0 && agravado.length === 0 && resuelto.length === 0,
  }
}

/** El trinquete: la baseline nunca puede tener más entradas que la de la base. */
export function verificarTrinquete(baselineActual, baselineBase) {
  const ahora = clavesDeBaseline(baselineActual)
  const antes = clavesDeBaseline(baselineBase)
  const agregadas = [...ahora].filter(c => !antes.has(c)).sort()
  const retiradas = [...antes].filter(c => !ahora.has(c)).sort()
  return { agregadas, retiradas, ok: agregadas.length === 0 }
}

/** Toda entrada de la baseline lleva `motivo`: una lista sin porqués no se poda. */
export function validarBaseline(baseline) {
  const problemas = []
  const grupos = baseline?.grupos
  if (!grupos || typeof grupos !== 'object') return ['`grupos` debe ser un objeto.']
  for (const [clave, entrada] of Object.entries(grupos)) {
    if (!entrada || typeof entrada !== 'object') { problemas.push(`${clave}: la entrada debe ser un objeto.`); continue }
    if (!entrada.motivo || String(entrada.motivo).trim().length < 15) {
      problemas.push(`${clave}: falta \`motivo\` (o es demasiado corto para explicar nada).`)
    }
    if (!entrada.desde) problemas.push(`${clave}: falta \`desde\` (fecha en que se midió).`)
    for (const lado of ['produccion', 'repo']) {
      if (typeof entrada[lado] !== 'string' || !entrada[lado]) {
        problemas.push(`${clave}: falta \`${lado}\` (la huella medida de ese lado).`)
      } else if (!esHuellaValida(entrada[lado])) {
        problemas.push(
          `${clave}: \`${lado}\` no es «<sha256 de 64 hex>:<n>» ni «${AUSENTE}» — vale «${entrada[lado].slice(0, 40)}».`,
        )
      }
    }
  }
  return problemas
}

// ── E/S ─────────────────────────────────────────────────────────────────────

const leerJson = ruta => JSON.parse(readFileSync(ruta, 'utf8'))

/** La huella de producción versionada, en su forma de Map. */
export function huellaProduccionVersionada(ruta = RUTA_PRODUCCION) {
  const doc = leerJson(ruta)
  const mapa = new Map()
  for (const [clave, v] of Object.entries(doc.grupos ?? {})) {
    const [h, n] = String(v).split(':')
    mapa.set(clave, { huella: h, n: Number(n ?? 0) })
  }
  return { mapa, doc }
}

// ── Modo live: refrescar P contra el catálogo real ─────────────────────────
//
// Todo lo de esta sección es PURO y se prueba en vitest. Lo que toca la red
// vive en `sembrarProduccionLive()`, más abajo, y se ejercita en `--prueba-live`
// contra un clúster desechable que hace de producción.

/** Variable de entorno con la cadena de conexión de SOLO LECTURA. */
export const VAR_URL_LIVE = 'SCHEMA_DRIFT_READONLY_URL'

/**
 * Quita de un texto la cadena de conexión y su contraseña.
 *
 * libpq mete el host, el usuario y a veces la URL entera en sus mensajes de
 * error, y esos mensajes se imprimen. Un secreto que llega al log de Actions
 * es un secreto quemado, así que se recorta ANTES de imprimir, no después.
 */
export function sinSecretos(texto, url = '') {
  let salida = String(texto)
  if (url) salida = salida.split(url).join('‹url oculta›')
  // La contraseña, además, por si el mensaje trae la URL troceada.
  const clave = (() => { try { return new URL(url).password } catch { return '' } })()
  if (clave) salida = salida.split(clave).join('‹clave oculta›')
  // Y cualquier `postgres://…@…` que haya quedado suelto.
  return salida.replace(/postgres(?:ql)?:\/\/[^\s'"]*/gi, '‹url oculta›')
}

/**
 * ¿Es uno de los dos hosts oficiales de Supabase? Dos formas, y sólo esas dos:
 *
 *   db.<ref>.supabase.co           conexión directa, el ref va en el host
 *   <región>.pooler.supabase.com   pooler, el ref va en el usuario `<rol>.<ref>`
 *
 * SE COMPRUEBA CONTRA UNA LISTA BLANCA, no por «contiene supabase». Una
 * comprobación laxa acepta `pooler.supabase.com.atacante.net` o
 * `supabase.ejemplo.com`, y los dos los registra cualquiera.
 */
export function esHostOficial(host) {
  const h = (host ?? '').toLowerCase()
  if (/^db\.[a-z0-9]{20}\.supabase\.co$/.test(h)) return true
  // Una etiqueta por delante como mínimo: `pooler.supabase.com` pelado no es
  // un host de conexión, y aceptarlo sólo ampliaría la superficie.
  return /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*\.pooler\.supabase\.com$/.test(h)
}

/** Parámetros que pueden cambiar el DESTINO o la IDENTIDAD de la conexión. */
export const PARAMETROS_PROHIBIDOS = new Set([
  'host', 'hostaddr', 'port', 'dbname', 'user', 'password', 'service', 'servicefile', 'options',
])

/** Los únicos que se aceptan, documentados uno por uno. */
export const PARAMETROS_PERMITIDOS = new Map([
  ['sslmode', 'exigido; require, verify-ca o verify-full'],
  ['sslrootcert', 'el certificado de la CA, necesario para verify-ca y verify-full'],
  ['connect_timeout', 'cuánto esperar antes de rendirse'],
  ['application_name', 'para reconocer la sesión en pg_stat_activity'],
])

const SSLMODE_ACEPTADOS = new Set(['require', 'verify-ca', 'verify-full'])

/**
 * La cadena de conexión, antes de dársela a psql.
 *
 * POR QUÉ NO ALCANZA CON MIRAR EL HOSTNAME. libpq acepta parámetros en la URI,
 * y varios de ellos MANDAN SOBRE EL HOST. `hostaddr` es el peor: si está, libpq
 * se conecta a ESA dirección IP y usa `host` sólo para el SNI y la verificación
 * del certificado. Es decir:
 *
 *     postgresql://u:p@db.<ref>.supabase.co:5432/postgres?hostaddr=203.0.113.9
 *
 * pasa cualquier lista blanca de hostname y habla con otra máquina. `host=` en
 * la query hace lo mismo por la vía directa, y `options=` puede deshacer el
 * `default_transaction_read_only` que `PGOPTIONS` fija — que es justamente el
 * guard que se apoya en el entorno.
 *
 * Por eso la lista blanca es de PARÁMETROS y no sólo de hosts: se acepta lo que
 * está documentado y se rechaza todo lo demás, incluidos los repetidos (libpq
 * se queda con el último, así que `sslmode=verify-full&sslmode=disable` se lee
 * bien y se conecta mal).
 *
 * EL SOCKET LOCAL ES LA ÚNICA EXCEPCIÓN, y no es un bypass: un socket de
 * dominio Unix no puede alcanzar otra máquina, sólo un Postgres del mismo
 * sistema de archivos. Es lo que usa `--prueba-live` contra su clúster
 * desechable. Que eso no termine versionado como producción no lo cuida esta
 * función sino el guard del proyecto: de una URL de socket no se deduce ningún
 * ref, y sin ref el refresco exige `--proyecto` a mano.
 *
 * Devuelve `{ problemas, avisos }`. `problemas` no vacío significa NO CONECTAR.
 * Ningún mensaje incluye la contraseña — hay una prueba que lo fija.
 */
export function validarUrlLive(url) {
  const problemas = [], avisos = []
  const rechazar = (m) => problemas.push(m)

  const m = /^(postgres(?:ql)?):\/\/([\s\S]*)$/i.exec(url ?? '')
  if (!m) {
    rechazar('no es una cadena de conexión de Postgres: tiene que empezar con postgres:// o postgresql://')
    return { problemas, avisos }
  }

  // Se parsea a mano y no con `new URL`: hace falta ver la autoridad EN CRUDO
  // para detectar la lista de varios hosts (`a:5432,b:5432`), que `new URL`
  // rechaza como puerto inválido y confundiría el diagnóstico.
  let resto = m[2]
  const iq = resto.indexOf('?')
  const consulta = iq === -1 ? '' : resto.slice(iq + 1)
  if (iq !== -1) resto = resto.slice(0, iq)
  const ib = resto.indexOf('/')
  const autoridad = ib === -1 ? resto : resto.slice(0, ib)
  const ia = autoridad.lastIndexOf('@')
  const hostspec = ia === -1 ? autoridad : autoridad.slice(ia + 1)

  // ── Los parámetros ────────────────────────────────────────────────────────
  const vistos = new Map()
  for (const trozo of consulta.split('&')) {
    if (trozo === '') continue
    const j = trozo.indexOf('=')
    let clave, valor
    try {
      clave = decodeURIComponent(j === -1 ? trozo : trozo.slice(0, j)).trim().toLowerCase()
      valor = j === -1 ? '' : decodeURIComponent(trozo.slice(j + 1))
    } catch {
      rechazar('la query trae un escape %xx inválido')
      continue
    }
    if (vistos.has(clave)) {
      rechazar(`parámetro repetido «${clave}»: libpq se queda con el ÚLTIMO, así que una URL que ` +
               'se lee bien puede conectarse mal')
    }
    vistos.set(clave, valor)
  }

  // ── ¿Socket local o red? ──────────────────────────────────────────────────
  const socketLocal = hostspec === '' && (vistos.get('host') ?? '').startsWith('/')
  const permitidos = socketLocal
    ? new Set([...PARAMETROS_PERMITIDOS.keys(), 'host', 'port'])
    : new Set(PARAMETROS_PERMITIDOS.keys())

  for (const clave of vistos.keys()) {
    if (permitidos.has(clave)) continue
    if (PARAMETROS_PROHIBIDOS.has(clave)) {
      rechazar(`parámetro «${clave}»: puede cambiar a qué base o con qué identidad se conecta, ` +
               'y entonces la lista blanca del host deja de significar nada')
    } else {
      rechazar(`parámetro «${clave}» no está en la lista documentada ` +
               `(${[...permitidos].sort().join(', ')})`)
    }
  }

  if (socketLocal) {
    if (vistos.has('hostaddr')) rechazar('un socket local no lleva «hostaddr»')
    return { problemas, avisos }
  }

  // ── Red: un único host, y oficial ─────────────────────────────────────────
  if (hostspec.includes(',')) {
    rechazar('la URL declara VARIOS hosts: libpq prueba uno por uno y basta con que el ' +
             'primero no responda para terminar hablando con otro')
    return { problemas, avisos }
  }
  const host = hostspec.replace(/^\[(.*)\]$/, '$1').split(':')[0].toLowerCase()
  if (host === '') {
    rechazar('la URL no declara host')
  } else if (!esHostOficial(host)) {
    rechazar(`el host «${host}» no es ninguno de los dos oficiales de Supabase ` +
             '(db.<ref>.supabase.co o <región>.pooler.supabase.com)')
  }

  // ── TLS ───────────────────────────────────────────────────────────────────
  const sslmode = (vistos.get('sslmode') ?? '').trim().toLowerCase()
  if (!vistos.has('sslmode')) {
    rechazar('falta «sslmode»: sin él libpq negocia y ACEPTA texto plano si el servidor lo ofrece, ' +
             'así que la contraseña y el catálogo viajan sin cifrar ante un intermediario')
  } else if (!SSLMODE_ACEPTADOS.has(sslmode)) {
    rechazar(`sslmode=${sslmode}: sólo se aceptan ${[...SSLMODE_ACEPTADOS].join(', ')}. ` +
             '«disable», «allow» y «prefer» dejan que la conexión caiga a texto plano')
  } else if (sslmode === 'require') {
    // `require` cifra pero NO verifica el certificado: protege del que escucha,
    // no del que se hace pasar por el servidor.
    avisos.push('sslmode=require cifra pero no verifica el certificado del servidor. Si el runner ' +
                'tiene el certificado de la CA de Supabase, usar sslmode=verify-full con ' +
                'sslrootcert=<ruta>: es lo único que impide un intermediario que se haga pasar ' +
                'por la base.')
  }
  if ((sslmode === 'verify-ca' || sslmode === 'verify-full') && !vistos.has('sslrootcert')) {
    avisos.push(`sslmode=${sslmode} sin «sslrootcert»: libpq usará el almacén por defecto ` +
                '(~/.postgresql/root.crt o el del sistema). Conviene apuntarlo al certificado de ' +
                'Supabase de forma explícita.')
  }

  return { problemas, avisos }
}

/**
 * Ref del proyecto Supabase que hay detrás de una URL, o null si no se puede
 * saber.
 *
 *   db.<ref>.supabase.co           el ref va en el host
 *   <región>.pooler.supabase.com   el ref va en el usuario, como `<rol>.<ref>`
 *
 * El host se valida con `esHostOficial`, la misma lista blanca que usa
 * `validarUrlLive`: este ref es lo único que impide que un refresco capture
 * OTRA base y la versione como si fuera producción, así que no se adivina.
 *
 * EL ROL DEL POOLER NO ES SIEMPRE `postgres`. La credencial de este auditor es
 * un rol DEDICADO, así que su usuario en el pooler es `drift_readonly.<ref>`.
 * Reconocer sólo `postgres.<ref>` dejaba sin deducir justo la URL que se va a
 * usar — y el modo live se niega a correr cuando no puede deducir el proyecto,
 * así que habría bloqueado el refresco entero.
 */
export function refDeUrl(url) {
  let u
  try { u = new URL(url) } catch { return null }
  const host = (u.hostname ?? '').toLowerCase()
  if (!esHostOficial(host)) return null

  const directo = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(host)
  if (directo) return directo[1]

  const porUsuario = /^.+\.([a-z0-9]{20})$/i.exec(decodeURIComponent(u.username ?? ''))
  return porUsuario ? porUsuario[1].toLowerCase() : null
}

/**
 * Guards sobre la huella recién leída, ANTES de escribir nada.
 *
 * El peor resultado posible no es un error: es un refresco que se escribe con
 * datos incompletos y queda versionado como verdad. Cada regla de aquí cubre
 * una forma concreta de que eso pase.
 */
export function validarHuellaLive(mapa, previo = null, { tolerancia = 0.2 } = {}) {
  const problemas = []

  if (mapa.size === 0) {
    problemas.push('La huella vino vacía: el catálogo no devolvió un solo grupo.')
    return problemas
  }

  for (const [clave, v] of mapa) {
    if (!RE_HUELLA.test(v.huella)) problemas.push(`«${clave}» no es un SHA-256 de 64 hex.`)
  }

  // EL GUARD QUE IMPORTA. `information_schema.role_table_grants` es relativo al
  // rol: con la credencial de solo lectura devolvía CERO filas, y la huella
  // salía con la cadena vacía en todo /grants sin que nada fallara. Leer del
  // ACL lo arregla (ver regla 7 de fingerprint.sql y `--prueba-acl`), pero el
  // fallo era silencioso y por eso se sigue vigilando en el resultado: si
  // alguna vez vuelve, el refresco se niega en vez de versionar el vacío.
  const grants = [...mapa].filter(([k]) => k.endsWith('/grants'))
  const vacios = grants.filter(([, v]) => v.n === 0)
  if (grants.length === 0) {
    problemas.push('No hay ni un grupo /grants: el catálogo se leyó sin la dimensión de privilegios.')
  } else if (vacios.length === grants.length) {
    problemas.push(
      `Los ${grants.length} grupos /grants vinieron VACÍOS. Es el síntoma exacto de leer los ` +
      'privilegios con un catálogo relativo al rol. No se versiona una huella sin grants.',
    )
  }

  if (previo && previo.size > 0) {
    const cambio = Math.abs(mapa.size - previo.size) / previo.size
    if (cambio > tolerancia) {
      problemas.push(
        `El número de grupos pasó de ${previo.size} a ${mapa.size} (${(cambio * 100).toFixed(1)} %). ` +
        `Por encima del ${(tolerancia * 100).toFixed(0)} % no se refresca solo: o se leyó otra base, ` +
        'o el esquema cambió tanto que merece revisarse a mano.',
      )
    }
  }

  return problemas
}

/** Qué cambia entre la huella versionada y la recién leída. */
export function diffHuellas(previo, nuevo) {
  const claves = [...new Set([...previo.keys(), ...nuevo.keys()])].sort()
  const agregados = [], eliminados = [], cambiados = []
  for (const c of claves) {
    const a = previo.get(c), b = nuevo.get(c)
    if (!a) agregados.push(c)
    else if (!b) eliminados.push(c)
    else if (a.huella !== b.huella || a.n !== b.n) cambiados.push({ clave: c, antes: `${a.huella}:${a.n}`, ahora: `${b.huella}:${b.n}` })
  }
  return { agregados, eliminados, cambiados }
}

export const RUTA_BASELINE_EN_GIT = 'scripts/schema-drift/drift-conocido.json'

/** Ejecuta git y devuelve stdout; lanza si el comando falla. Inyectable para probar. */
const gitReal = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

/**
 * La baseline tal como está en la rama base, o `null` SÓLO si se comprueba que
 * el archivo no existe ahí — el caso del PR que la introduce.
 *
 * POR QUÉ NO ALCANZA CON UN `try/catch` ALREDEDOR DE `git show`. Falla igual
 * cuando el archivo no está, cuando la ref no existe y cuando el checkout está
 * incompleto (clon superficial o parcial, objetos ausentes). Tratar los tres
 * casos como «es la primera vez» DESACTIVA EL TRINQUETE EN SILENCIO: bastaría
 * un `fetch-depth: 1` para que un PR pudiera agrandar la baseline sin que nada
 * lo note. El trinquete que se puede apagar sin querer no es un trinquete.
 *
 * Por eso se separan los tres:
 *   1. `rev-parse --verify` — ¿la ref existe? Si no, es un error de
 *      configuración (nombre equivocado, checkout sin la rama base) y se lanza.
 *   2. `cat-file -e <ref>^{tree}` — ¿los objetos de ese commit están aquí? En
 *      un clon superficial la ref puede resolver y el árbol no estar. Se lanza.
 *   3. `ls-tree` — sólo ahora, la ausencia del archivo es información: el árbol
 *      está completo y el archivo no está en él. Eso, y sólo eso, es `null`.
 */
export function baselineDeLaBase(ref, git = gitReal) {
  try {
    git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
  } catch {
    throw new Error(
      `La referencia base «${ref}» no existe en este repositorio. No se puede verificar el ` +
      'trinquete de la baseline, así que se aborta en vez de dar por bueno el PR. ' +
      'En CI suele significar un checkout sin la rama base: usá `fetch-depth: 0`.',
    )
  }
  try {
    git(['cat-file', '-e', `${ref}^{tree}`])
  } catch {
    throw new Error(
      `La referencia «${ref}» resuelve pero su árbol no está presente: el checkout está incompleto ` +
      '(clon superficial o parcial). Sin el árbol no se puede saber si la baseline existía, y ' +
      'suponer que no existía apagaría el trinquete. Usá `fetch-depth: 0`.',
    )
  }
  // El árbol está completo: ahora la ausencia del archivo sí es información.
  const listado = git(['ls-tree', '--name-only', ref, '--', RUTA_BASELINE_EN_GIT])
  if (listado.trim() === '') return null // ausencia COMPROBADA: es la primera vez
  return JSON.parse(git(['show', `${ref}:${RUTA_BASELINE_EN_GIT}`]))
}

function serializarHuella(mapa) {
  const grupos = {}
  for (const clave of [...mapa.keys()].sort()) {
    const v = mapa.get(clave)
    grupos[clave] = `${v.huella}:${v.n}`
  }
  return grupos
}

// ── la comparación de tres vías ─────────────────────────────────────────────

/**
 * Reconstruye la rama base en su propio clúster y devuelve su huella.
 *
 * `bootstrap.sql` y `fingerprint.sql` salen de HEAD, no de la base: lo que se
 * quiere medir es la diferencia entre dos árboles de MIGRACIONES, y hashear
 * cada lado con una serialización distinta mediría el cambio del auditor.
 */
export function huellaDeLaBase(ref, log = () => {}, inyecciones = []) {
  const dir = mkdtempSync(join(tmpdir(), 'base-migr-'))
  try {
    const nombres = materializarMigraciones(ref, dir)
    log(`· rama base ${ref}: ${nombres.length} migraciones materializadas`)
    const db = reconstruir({ log: m => log(`  ${m}`), dirMigraciones: dir })
    try {
      if (db.fallos.length > 0) {
        const detalle = db.fallos.map(f => `  ${f.migracion}\n    ${f.error}`).join('\n')
        throw new Error(
          `${db.fallos.length} migración(es) de la rama base «${ref}» no aplican sobre una base ` +
          `limpia. Sin M no hay comparación de tres vías:\n${detalle}`,
        )
      }
      for (const sql of inyecciones) db.psql(['-v', 'ON_ERROR_STOP=1', '-q', '-c', sql], { stdio: 'pipe' })
      return parsearHuella(huella(db.psql))
    } finally {
      db.destruir()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Prueba de integración de las tres vías contra un catálogo REAL.
 *
 * Construye M desde las migraciones tal como están y R desde las mismas más UNA
 * migración append-only, y comprueba que el auditor llama a eso cambio
 * planificado y a nada más. Es la contraparte de las pruebas puras: éstas
 * deciden bien sobre mapas inventados, ésta comprueba que los mapas que salen
 * de un Postgres de verdad tienen la forma que las reglas suponen.
 *
 * DOS RECONSTRUCCIONES, NO UNA CON MUTACIONES. Mutar el catálogo con `psql`
 * después de reconstruir probaría el comparador contra un estado que ninguna
 * migración puede producir. Acá la única diferencia entre M y R es un archivo.
 */
async function pruebaTresVias() {
  const TABLA_NUEVA = 'auditor_tres_vias_nueva'
  const TABLA_TOCADA = 'clientes'
  const MIGRACION = '29991231235959_auditor_prueba_tres_vias.sql'
  const SQL = [
    `-- Migración sintética de la prueba de integración. No se versiona.`,
    `CREATE TABLE public.${TABLA_NUEVA} (id uuid PRIMARY KEY, etiqueta text NOT NULL);`,
    `REVOKE ALL ON public.${TABLA_TOCADA} FROM anon;`,
    '',
  ].join('\n')

  const dirBase = mkdtempSync(join(tmpdir(), 'tv-base-'))
  const dirPr = mkdtempSync(join(tmpdir(), 'tv-pr-'))
  try {
    for (const nombre of listarMigraciones(DIR_MIGRACIONES)) {
      const contenido = readFileSync(join(DIR_MIGRACIONES, nombre))
      writeFileSync(join(dirBase, nombre), contenido)
      writeFileSync(join(dirPr, nombre), contenido)
    }
    writeFileSync(join(dirPr, MIGRACION), SQL)
    console.error(`· base: ${listarMigraciones(dirBase).length} migraciones · PR: ${listarMigraciones(dirPr).length}`)

    const sacar = (dir, etiqueta) => {
      const db = reconstruir({ log: m => console.error(`  ${etiqueta} ${m}`), dirMigraciones: dir })
      try {
        if (db.fallos.length > 0) throw new Error(`${etiqueta}: ${db.fallos.length} migración(es) fallaron`)
        return parsearHuella(huella(db.psql))
      } finally { db.destruir() }
    }

    const M = sacar(dirBase, 'M')
    const R = sacar(dirPr, 'R')
    const { mapa: P } = huellaProduccionVersionada()
    const baseline = leerJson(RUTA_BASELINE)

    const migraciones = diffMigraciones(
      new Map(listarMigraciones(dirBase).map(n => [n, 'igual'])),
      new Map(listarMigraciones(dirPr).map(n => [n, n === MIGRACION ? 'nuevo' : 'igual'])),
    )
    if (migraciones.agregadas.length !== 1 || !migraciones.apendiceLimpio) {
      throw new Error('el diff sintético no quedó como un apéndice limpio de una sola migración')
    }

    let fallos = 0
    const comprobar = (cond, texto) => {
      console.error(`${cond ? '✓' : '✗'} ${texto}`)
      if (!cond) fallos++
    }

    // Precondición: el objeto que se va a tocar NO tiene drift hoy. Sin esto,
    // el caso sería «P ≠ M» y la clasificación esperada sería otra.
    const clave = `tabla:${TABLA_TOCADA}/grants`
    const igual = (a, b, c) => a.get(c)?.huella === b.get(c)?.huella
    comprobar(igual(P, M, clave), `precondición: producción y la rama base coinciden en ${clave}`)

    const v = evaluarTresVias({ P, M, R, baseline, migraciones })
    const planificados = v.planificados.map(g => g.clave).sort()

    comprobar(planificados.includes(clave), `${clave} se reporta como CAMBIO PLANIFICADO`)
    const deLaTablaNueva = planificados.filter(c => c.startsWith(`tabla:${TABLA_NUEVA}/`))
    comprobar(deLaTablaNueva.length > 0, `la tabla nueva aparece como CAMBIO PLANIFICADO (${deLaTablaNueva.length} grupos)`)
    comprobar(
      planificados.length === deLaTablaNueva.length + 1,
      `NADA MÁS cambió: ${planificados.length} planificados, ${deLaTablaNueva.length + 1} esperados`,
    )
    for (const g of v.planificados.filter(x => x.clave.startsWith(`tabla:${TABLA_NUEVA}/`))) {
      comprobar(g.p === AUSENTE && g.m === AUSENTE, `${g.clave}: ausente en producción y en la base`)
    }

    // ── El veredicto se mira ACOTADO a la migración sintética ──────────────
    //
    // No se puede exigir `v.ok` global. M sale de las migraciones de ESTA rama,
    // así que una migración que la rama ya trae y producción todavía no tiene
    // está en M y en R por igual: para el auditor es «un objeto que el PR no
    // toca» con P ≠ R, o sea DRIFT NUEVO — y tiene razón, porque dentro de este
    // marco sintético eso es exactamente lo que es.
    //
    // Exigir `v.ok` ataba esta prueba a «la rama no tiene ningún cambio
    // pendiente de desplegar». En #829 y en main era cierto por casualidad; en
    // #828, que existe precisamente para llevar una migración sin desplegar,
    // es falso. La propiedad que esta prueba existe para demostrar es local a
    // la migración sintética, así que se comprueba local.
    const tocados = new Set([clave, ...deLaTablaNueva])
    const enTocados = (lista) => lista.filter(g => tocados.has(g.clave)).map(g => g.clave)

    comprobar(enTocados(v.nuevo).length === 0,
              `ningún DRIFT NUEVO entre los grupos que toca la migración sintética`)
    comprobar(enTocados(v.agravado).length === 0,
              'ningún DRIFT AGRAVADO entre esos grupos')
    comprobar(v.ambiguos.length === 0, 'ningún CAMBIO AMBIGUO en ningún grupo')
    comprobar((migraciones.eliminadas.length + migraciones.modificadas.length +
               migraciones.desordenadas.length) === 0,
              'el apéndice sigue siendo limpio')

    // Y lo que quede fuera se nombra, en vez de esconderse: todo DRIFT NUEVO
    // restante tiene que venir de una migración que la rama ya trae y
    // producción todavía no. Si apareciera en un grupo que la migración
    // sintética SÍ toca, la comprobación de arriba ya habría fallado.
    const ajenos = v.nuevo.filter(g => !tocados.has(g.clave)).map(g => g.clave)
    if (ajenos.length > 0) {
      console.error(`· ${ajenos.length} grupo(s) con drift propio de esta rama, ajenos a la prueba:`)
      for (const c of ajenos) console.error(`    ${c}`)
      console.error('  Son cambios que la rama trae sin desplegar. La auditoría real los')
      console.error('  clasifica con M = la rama base; acá M es la rama misma, y por eso se ven así.')
    }
    const texto = informe(v).join('\n')
    comprobar(texto.includes('CAMBIO PLANIFICADO'), 'el informe lo nombra CAMBIO PLANIFICADO')
    comprobar(texto.includes('NO se agregan a drift-conocido'),
              'el informe dice explícitamente que no se agrega a la baseline')
    comprobar(clavesDeBaseline(baseline).size === clavesDeBaseline(leerJson(RUTA_BASELINE)).size,
              'la baseline en disco no se tocó')

    // El mismo par M/R, pero sin migración nueva: tiene que romper. Es el caso
    // «cambio de SQL sin migración», y no cuesta otra reconstrucción.
    const sinMigracion = evaluarTresVias({
      P, M, R, baseline,
      migraciones: diffMigraciones(new Map([['a.sql', 'x']]), new Map([['a.sql', 'x']])),
    })
    comprobar(!sinMigracion.ok, 'el MISMO cambio sin migración nueva falla')
    comprobar(sinMigracion.cambioSinMigracion.length > 0, 'se reporta como CATÁLOGO CAMBIADO SIN MIGRACIÓN NUEVA')

    // Y con la migración marcada como histórica reescrita: también rompe.
    const reescrita = evaluarTresVias({
      P, M, R, baseline,
      migraciones: diffMigraciones(new Map([['a.sql', 'x']]), new Map([['a.sql', 'REESCRITA']])),
    })
    comprobar(!reescrita.ok, 'una migración histórica modificada falla')

    if (fallos > 0) {
      console.error(`\n\u2717 ${fallos} comprobación(es) de la prueba de tres vías fallaron.`)
      process.exit(1)
    }
    console.error('\n\u2713 Tres vías, contra un catálogo real: un apéndice append-only es un cambio')
    console.error('  planificado; el mismo cambio sin migración, o con una histórica reescrita, rompe.')
  } finally {
    for (const d of [dirBase, dirPr]) rmSync(d, { recursive: true, force: true })
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function bandera(nombre) { return process.argv.includes(nombre) }
function valor(nombre) {
  const i = process.argv.indexOf(nombre)
  return i === -1 ? null : process.argv[i + 1]
}

// ── Modo live: la parte que sí toca la red ─────────────────────────────────

/**
 * psql contra la URL de solo lectura.
 *
 * `PGOPTIONS` fuerza la sesión a solo lectura DESDE LA CONEXIÓN, no con un
 * `SET` posterior: así la garantía no depende de que el rol esté bien
 * configurado ni de que la primera sentencia sea la correcta. Es defensa en
 * profundidad — el rol ya debería no poder escribir, y se comprueba aparte.
 */
function psqlLive(url, args) {
  try {
    return execFileSync('psql', [url, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, PGOPTIONS: '-c default_transaction_read_only=on', PGCONNECT_TIMEOUT: '15' },
    })
  } catch (err) {
    throw new Error(sinSecretos(String(err.stderr || err.message).trim(), url))
  }
}

/**
 * Funciones SECURITY DEFINER que la credencial PUEDE ejecutar sin que el
 * refresco se niegue, con su justificación al lado.
 *
 * POR QUÉ IMPORTAN. Una función SECURITY DEFINER corre con los privilegios de
 * SU DUEÑO. Si la credencial del auditor puede ejecutar una, el «solo lectura»
 * que se mide sobre el rol describe lo que ese rol puede hacer *directamente*,
 * y hay un camino al lado. Por eso la regla mira el privilegio EFECTIVO
 * —`has_function_privilege(current_user, …)`— y no el nombre del esquema ni el
 * de la función.
 *
 * ESTÁ VACÍA A PROPÓSITO, y llenarla no es un trámite. Cada entrada declara
 * «esta función, corriendo como su dueño, no le da a esta credencial nada que
 * no debería tener». Eso es una afirmación de seguridad sobre el CUERPO de la
 * función, no sobre su nombre, y no la puede firmar el auditor: la firma quien
 * revisa el PR que agrega la línea. Hay una prueba que falla si deja de estar
 * vacía, para que agregar una entrada sea un acto visible.
 *
 * QUÉ NO ES ESTA REGLA. No es un juicio sobre los privilegios de `anon` o de
 * `authenticated`: esos roles son otra conversación, función por función, y no
 * se resuelve desde acá. La credencial del auditor es un rol INDEPENDIENTE sin
 * membresías —lo exige la regla MEMBRESÍA—, así que un GRANT explícito a
 * `anon` o a `authenticated` NO la alcanza. Lo que la alcanza es un EXECUTE a
 * PUBLIC, un GRANT directo a ella, o una membresía; y de las tres, el
 * diagnóstico dice cuál.
 */
export const SECDEF_PERMITIDAS = new Map()

/**
 * Lo que hay que medir del OTRO lado antes de leer nada.
 *
 * Se mide, no se declara: la única afirmación aceptable sobre una credencial es
 * la que sale de `pg_roles` y de `has_*_privilege` en la sesión que se va a
 * usar. Devuelve pares `clave → valor`; las listas vienen separadas por \x1e
 * porque una identidad de función lleva comas adentro y `,` sería ambiguo, y
 * los campos dentro de un elemento por \x1d.
 */
const SQL_CREDENCIAL = `WITH no_interno AS (
  -- Todos los esquemas del usuario, no sólo los que publica PostgREST: la
  -- credencial se conecta a POSTGRES, no a la API HTTP. Un esquema propio o
  -- \`extensions\` es tan alcanzable como \`public\` — más, porque nadie lo mira.
  -- Se descartan sólo los internos del motor, cuyas funciones no son de este
  -- proyecto y harían saltar la regla siempre.
  SELECT oid, nspname FROM pg_namespace
   WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'
), rel AS (
  SELECT c.oid, n.nspname||'.'||c.relname AS nombre
    FROM pg_class c JOIN no_interno n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r','p','v','m','f')
), escribibles AS (
  SELECT nombre FROM rel
   WHERE has_table_privilege(oid,'INSERT') OR has_table_privilege(oid,'UPDATE')
      OR has_table_privilege(oid,'DELETE') OR has_table_privilege(oid,'TRUNCATE')
), leibles AS (
  SELECT nombre FROM rel WHERE has_table_privilege(oid,'SELECT')
), leibles_por_columna AS (
  -- SELECT por COLUMNA. \`has_table_privilege\` no lo ve: un GRANT
  -- SELECT(columna) no concede el privilegio a nivel tabla, y sin embargo
  -- alcanza para leer datos. Se pregunta aparte, con has_any_column_privilege.
  SELECT nombre FROM rel
   WHERE has_any_column_privilege(oid,'SELECT') AND NOT has_table_privilege(oid,'SELECT')
), secdef AS (
  -- ALCANZABLE = USAGE sobre el esquema Y EXECUTE efectivo sobre la función.
  -- Las dos condiciones: sin USAGE la función no se puede nombrar, y \`EXECUTE
  -- a PUBLIC\` sobre algo en un esquema cerrado no le sirve a nadie.
  --
  -- Y se registra DE DÓNDE viene el privilegio, porque el remedio depende de
  -- eso: revocarle a PUBLIC no hace nada si el GRANT es directo al auditor, y
  -- revocarle al rol intermedio rompería la aplicación cuando ese rol es
  -- \`authenticated\`. Sale de aclexplode, quedándose con los otorgados que
  -- ALCANZAN a current_user: PUBLIC (grantee 0) o un rol que current_user es.
  SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')'
         ||E'\\x1d'||
         coalesce((SELECT string_agg(DISTINCT coalesce(r.rolname::text,'PUBLIC'), '+')
                     FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                     LEFT JOIN pg_roles r ON r.oid = a.grantee
                    WHERE a.privilege_type = 'EXECUTE'
                      AND (a.grantee = 0 OR pg_has_role(current_user, a.grantee, 'USAGE'))),
                  CASE WHEN p.proowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
                       THEN 'dueño' ELSE '?' END) AS ident
    FROM pg_proc p JOIN no_interno n ON n.oid = p.pronamespace
   WHERE p.prosecdef
     AND has_schema_privilege(current_user, n.oid, 'USAGE')
     AND has_function_privilege(current_user, p.oid, 'EXECUTE')
), yo AS (
  SELECT * FROM pg_roles WHERE rolname = current_user
), lista AS (
  -- Un solo lugar donde se recortan y se pegan las listas.
  SELECT 'escribibles'         AS k, nombre AS v FROM escribibles
  UNION ALL SELECT 'leibles',            nombre FROM leibles
  UNION ALL SELECT 'leibles_columna',    nombre FROM leibles_por_columna
  UNION ALL SELECT 'secdef',             ident  FROM secdef
  UNION ALL SELECT 'crear_esquemas',     nspname FROM no_interno
             WHERE has_schema_privilege(current_user, oid, 'CREATE')
  UNION ALL SELECT 'membresias',         r.rolname FROM pg_roles r
             WHERE r.rolname <> current_user AND pg_has_role(current_user, r.oid, 'MEMBER')
  UNION ALL SELECT 'sin_usage',          n.nspname
             FROM unnest(string_to_array(current_setting('search_path'), ',')) AS x
             -- JOIN contra pg_namespace, no un EXISTS en el WHERE: el nombre se
             -- resuelve a OID y las entradas que no son un esquema real —«$user»,
             -- que además llega escapado como «\\$user»— simplemente no casan.
             -- Con \`has_schema_privilege(nombre)\` en el WHERE, el planificador
             -- puede evaluarlo antes del filtro y reventar con «schema does not
             -- exist»; por OID eso no puede pasar.
             JOIN pg_namespace n ON n.nspname = btrim(x, '\\ "')
             WHERE NOT has_schema_privilege(current_user, n.oid, 'USAGE')
), agregada AS (
  SELECT k, string_agg(v, E'\\x1e' ORDER BY v COLLATE "C") AS items
    FROM lista GROUP BY k
)
SELECT k||E'\\x1f'||v FROM (
            SELECT 'usuario'        AS k, current_user::text AS v
  UNION ALL SELECT 'superusuario',    (SELECT rolsuper::text        FROM yo)
  UNION ALL SELECT 'bypassrls',       (SELECT rolbypassrls::text    FROM yo)
  UNION ALL SELECT 'crear_roles',     (SELECT rolcreaterole::text   FROM yo)
  UNION ALL SELECT 'crear_bases',     (SELECT rolcreatedb::text     FROM yo)
  UNION ALL SELECT 'replicacion',     (SELECT rolreplication::text  FROM yo)
  UNION ALL SELECT 'solo_lectura',    current_setting('transaction_read_only')
  UNION ALL SELECT 'version',         current_setting('server_version')
  UNION ALL SELECT 'search_path',     current_setting('search_path')
  UNION ALL SELECT a.k, a.items FROM agregada a
) AS m(k, v)
WHERE v IS NOT NULL AND v <> ''`

/**
 * El veredicto sobre la credencial: puro, para poder probarlo regla por regla.
 *
 * Devuelve la lista de motivos de RECHAZO. Vacía significa «esta credencial
 * puede leer producción». Cada motivo trae su remedio en SQL, porque el mensaje
 * de un guard que no dice cómo salir del paso se convierte, a la tercera vez,
 * en una excusa para desactivar el guard.
 *
 * Las reglas no son «buenas prácticas»: cada una cierra un camino concreto por
 * el que esta credencial dejaría de ser de solo lectura.
 *
 *   · SELECT sobre tablas y SELECT POR COLUMNA — la huella se saca del
 *     catálogo, no de las tablas. Poder leer datos no le sirve de nada al
 *     auditor y convierte el secreto de `production-db` en una filtración
 *     esperando un log. La variante por columna es la que se olvida: un GRANT
 *     SELECT(email) no aparece en `has_table_privilege` y alcanza igual.
 *   · REPLICATION — un rol con replicación se conecta al stream y se lleva la
 *     base entera, tabla por tabla, sin ejecutar un SELECT.
 *   · CREATE sobre un esquema — crear es escribir. Y con una función propia en
 *     un esquema del `search_path` se secuestra la resolución de nombres.
 *   · Membresías — `has_table_privilege` ya cuenta lo que se hereda, pero un
 *     rol NOINHERIT llega a lo mismo con `SET ROLE`. Para un rol dedicado no
 *     hace falta ninguna, así que cualquiera sobra.
 *   · SECURITY DEFINER ejecutables — ver `SECDEF_PERMITIDAS`.
 *   · La sesión en solo lectura y el USAGE del `search_path` se conservan tal
 *     como estaban; el segundo no es de seguridad sino de corrección, y es el
 *     menos obvio de todos (ver `sembrarProduccionLive`).
 */
export function juzgarCredencial(m, { permitidas = SECDEF_PERMITIDAS } = {}) {
  // `boolean::text` en Postgres da 'true'/'false'; el tipo boolean impreso sin
  // cast da 't'/'f'. Se aceptan LAS DOS grafías a propósito: equivocarse acá no
  // hace fallar nada de forma visible, hace que el guard deje de rechazar —
  // falla ABIERTO—. Y eso ya pasó: la primera versión de esta comprobación
  // comparaba contra 't' mientras el SQL devolvía 'true', así que los controles
  // de superusuario, BYPASSRLS, CREATEROLE y CREATEDB estaban muertos y nadie
  // se enteraba, porque ninguna prueba los ejercitaba con un rol culpable.
  const cierto = (v) => v === 'true' || v === 't' || v === 'on' || v === 'yes'
  const lista = (k) => (m[k] ?? '').split('\x1e').filter(Boolean)
  const muestra = (xs, n = 8) =>
    xs.slice(0, n).join(', ') + (xs.length > n ? `, … y ${xs.length - n} más` : '')
  const usuario = m.usuario || '<rol>'
  const rechazos = []
  const rechazar = (regla, detalle, remedio) => rechazos.push({ regla, detalle, remedio })

  // Antes que nada: que la MEDICIÓN esté completa. Un campo que no llegó se
  // lee como `undefined`, `cierto(undefined)` es falso y la regla que lo mira
  // deja de rechazar — otra vez el fallo abierto. Si falta algo, no se juzga:
  // se rechaza.
  const OBLIGATORIAS = ['usuario', 'superusuario', 'bypassrls', 'crear_roles', 'crear_bases',
                        'replicacion', 'solo_lectura', 'version', 'search_path']
  const faltantes = OBLIGATORIAS.filter(k => !(k in m))
  if (faltantes.length > 0) {
    rechazar('MEDICIÓN INCOMPLETA', `la consulta no devolvió ${faltantes.join(', ')}, así que hay ` +
      'reglas que no se pudieron evaluar',
      'revisar SQL_CREDENCIAL contra la versión de Postgres del otro lado')
    return rechazos
  }

  if (cierto(m.superusuario)) rechazar('SUPERUSUARIO', 'es superusuario', `ALTER ROLE ${usuario} NOSUPERUSER;`)
  if (cierto(m.bypassrls)) rechazar('BYPASSRLS', 'tiene BYPASSRLS', `ALTER ROLE ${usuario} NOBYPASSRLS;`)
  if (cierto(m.crear_roles)) rechazar('CREATEROLE', 'puede crear roles', `ALTER ROLE ${usuario} NOCREATEROLE;`)
  if (cierto(m.crear_bases)) rechazar('CREATEDB', 'puede crear bases', `ALTER ROLE ${usuario} NOCREATEDB;`)
  if (cierto(m.replicacion)) {
    rechazar('REPLICATION', 'tiene REPLICATION: puede llevarse la base por el stream, sin un solo SELECT',
      `ALTER ROLE ${usuario} NOREPLICATION;`)
  }

  const escribibles = lista('escribibles')
  if (escribibles.length > 0) {
    rechazar('ESCRITURA', `puede escribir en ${escribibles.length} tabla(s): ${muestra(escribibles)}`,
      `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM ${usuario};`)
  }

  const leibles = lista('leibles')
  if (leibles.length > 0) {
    rechazar('SELECT DE TABLA', `puede leer ${leibles.length} tabla(s): ${muestra(leibles)} — ` +
      'la huella sale del catálogo, así que leer datos no le sirve y sí lo vuelve peligroso',
      `REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM ${usuario};`)
  }

  const porColumna = lista('leibles_columna')
  if (porColumna.length > 0) {
    rechazar('SELECT POR COLUMNA', `tiene SELECT por columna en ${porColumna.length} tabla(s): ` +
      `${muestra(porColumna)} — no aparece en has_table_privilege y alcanza igual para leer datos`,
      `REVOKE SELECT (…) ON <tabla> FROM ${usuario};   -- por columna, tabla por tabla`)
  }

  const crearEsquemas = lista('crear_esquemas')
  if (crearEsquemas.length > 0) {
    rechazar('CREATE SOBRE ESQUEMA', `puede crear objetos en: ${muestra(crearEsquemas)} — crear es ` +
      'escribir, y una función propia en un esquema del search_path secuestra la resolución de nombres',
      `REVOKE CREATE ON SCHEMA ${crearEsquemas.join(', ')} FROM ${usuario};`)
  }

  const membresias = lista('membresias')
  if (membresias.length > 0) {
    rechazar('MEMBRESÍA', `es miembro de: ${muestra(membresias)} — un rol dedicado no necesita ninguna, ` +
      'y con NOINHERIT una membresía sigue alcanzable con SET ROLE',
      membresias.map(r => `REVOKE ${r} FROM ${usuario};`).join(' '))
  }

  // Cada elemento viene como `identidad\x1dprocedencia`, y la procedencia
  // decide el remedio: revocarle a PUBLIC no hace NADA si el GRANT es directo
  // al auditor, y revocarle al rol intermedio rompería la aplicación cuando ese
  // rol es `authenticated`. Un diagnóstico que propone el REVOKE equivocado se
  // gasta un ciclo y, peor, deja creer que el agujero se cerró.
  const secdef = lista('secdef')
    .map(x => { const [ident, via = '?'] = x.split('\x1d'); return { ident, via } })
    .filter(f => !permitidas.has(f.ident))
  if (secdef.length > 0) {
    const remedio = (f) => {
      const fuentes = f.via.split('+').filter(Boolean)
      if (fuentes.includes('PUBLIC')) return `REVOKE EXECUTE ON FUNCTION ${f.ident} FROM PUBLIC;`
      if (fuentes.includes(usuario)) return `REVOKE EXECUTE ON FUNCTION ${f.ident} FROM ${usuario};`
      if (fuentes.includes('dueño')) {
        return `ALTER FUNCTION ${f.ident} OWNER TO <otro rol>;   -- la ejecuta por ser su dueño`
      }
      // Llega por una membresía. NO se revoca al rol intermedio —puede ser
      // `authenticated`, y romperlo rompe la aplicación—: se quita la
      // membresía, que además ya la rechaza la regla MEMBRESÍA.
      return `REVOKE ${fuentes.join(', ')} FROM ${usuario};   -- llega por membresía, no por un GRANT propio`
    }
    rechazar('SECURITY DEFINER',
      `puede ejecutar ${secdef.length} función(es) SECURITY DEFINER —corren como su dueño, así que ` +
      'el «solo lectura» medido arriba no describe lo que puede hacer—: ' +
      muestra(secdef.map(f => `${f.ident} [vía ${f.via}]`), 12),
      [...new Set(secdef.slice(0, 12).map(remedio))].join('\n      ') +
      '\n      (o declarar la función en SECDEF_PERMITIDAS con su justificación)')
  }

  if (!cierto(m.solo_lectura)) {
    rechazar('SESIÓN DE ESCRITURA', 'la sesión no quedó en solo lectura pese a PGOPTIONS',
      "PGOPTIONS='-c default_transaction_read_only=on'   -- y que el pooler esté en modo session")
  }

  const sinUsage = lista('sin_usage')
  if (sinUsage.length > 0) {
    // EL RECHAZO MENOS OBVIO, y el único que no es de seguridad. Un esquema del
    // `search_path` sobre el que el rol no tiene USAGE no lo vuelve ciego: lo
    // vuelve VERBOSO. `format_type` y `pg_get_expr` cualifican lo que no es
    // visible, así que la misma base serializa distinto según quién lea, y el
    // refresco quedaría versionado con nombres cualificados que el auditor
    // vería como drift para siempre. Medido: exactamente 1 grupo se movía.
    rechazar('SIN USAGE EN EL SEARCH_PATH', `no tiene USAGE sobre ${sinUsage.join(', ')}, que están en ` +
      `el search_path (${m.search_path}) — sin USAGE esos nombres se serializan CUALIFICADOS ` +
      '(`extensions.citext` en vez de `citext`) y la huella deja de coincidir con la del dueño',
      `GRANT USAGE ON SCHEMA ${sinUsage.join(', ')} TO ${usuario};`)
  }

  return rechazos
}

/**
 * Refresca `huella-produccion.json` leyendo el catálogo real.
 *
 * FAIL-CLOSED EN LAS DOS DIRECCIONES. Antes de leer se exige que la credencial
 * sea de solo lectura de verdad —medido, no declarado—, y antes de escribir se
 * exige que la huella tenga sentido. Un refresco que se escribe con datos
 * incompletos es peor que no refrescar: queda versionado como verdad y el
 * auditor deja de ver el drift que esos grupos taparían.
 */
function sembrarProduccionLive({ url, proyectoEsperado, escribir = true }) {
  if (!url) {
    console.error(`✗ Falta ${VAR_URL_LIVE}: sin credencial no hay modo live.`)
    console.error('  Tiene que ser un rol DEDICADO de solo lectura, en el environment `production-db`.')
    console.error('  NO se reutiliza SUPABASE_ACCESS_TOKEN: es de la Management API y puede escribir.')
    return 1
  }

  // ── La cadena de conexión, antes de abrirla ──────────────────────────────
  // El hostname solo no alcanza: `hostaddr`, `host=` en la query y `options=`
  // mandan sobre el destino y sobre la sesión, así que una URL con un host
  // oficial puede hablar con otra máquina. Ver `validarUrlLive`.
  const urlRevisada = validarUrlLive(url)
  if (urlRevisada.problemas.length > 0) {
    console.error(`✗ ${VAR_URL_LIVE} no pasa la revisión de la cadena de conexión:`)
    for (const p of urlRevisada.problemas) console.error(`    · ${sinSecretos(p, url)}`)
    console.error('  No se conecta a nada.')
    return 1
  }
  for (const a of urlRevisada.avisos) console.error(`· aviso: ${sinSecretos(a, url)}`)

  // ── El proyecto, antes que nada ──────────────────────────────────────────
  // Capturar el SANDBOX y versionarlo como producción sería un desastre
  // silencioso: la huella quedaría «verde» describiendo otra base.
  const { mapa: previo, doc } = huellaProduccionVersionada()
  const esperado = proyectoEsperado ?? doc.proyecto
  const refUrl = refDeUrl(url)
  if (refUrl && esperado && refUrl !== esperado) {
    console.error(`✗ La URL apunta al proyecto «${refUrl}» y la instantánea declara «${esperado}».`)
    console.error('  No se refresca: sería versionar otra base como si fuera producción.')
    return 1
  }
  if (!refUrl && !proyectoEsperado) {
    console.error('✗ No se pudo deducir el proyecto desde la URL y no se pasó `--proyecto`.')
    console.error('  Sin saber qué base se está leyendo no se versiona nada.')
    return 1
  }
  console.error(`· proyecto: ${esperado}${refUrl ? ' (confirmado por la URL)' : ' (declarado con --proyecto)'}`)

  // ── La credencial, medida ────────────────────────────────────────────────
  const medidas = Object.fromEntries(
    psqlLive(url, ['-tAq', '-c', SQL_CREDENCIAL]).trim().split('\n')
      .filter(Boolean)
      .map(l => { const i = l.indexOf('\x1f'); return [l.slice(0, i), l.slice(i + 1)] }),
  )

  const rechazos = juzgarCredencial(medidas)
  if (rechazos.length > 0) {
    console.error(`\n✗ La credencial no sirve para leer producción: ${rechazos.length} motivo(s).`)
    console.error('  No se lee nada. El modo live existe para MEDIR producción, no para tener acceso a ella.')
    for (const r of rechazos) {
      console.error(`\n  ✗ ${r.regla}: ${r.detalle}.`)
      console.error(`      ${r.remedio}`)
    }
    return 1
  }
  console.error(`✓ credencial de solo lectura: ${medidas.usuario} — sin superusuario, sin BYPASSRLS, ` +
                'sin REPLICATION, sin permisos de escritura ni de SELECT, sin CREATE ni membresías, ' +
                'sin SECURITY DEFINER al alcance, sesión read-only')
  console.error(`✓ search_path (${medidas.search_path}): el rol tiene USAGE sobre todos sus esquemas`)
  console.error(`· Postgres ${medidas.version}`)

  // ── La huella ────────────────────────────────────────────────────────────
  const texto = psqlLive(url, ['-tAq', '-f', RUTA_FINGERPRINT]).trim()
  let mapa
  try { mapa = parsearHuella(texto) } catch (err) { console.error(`✗ ${sinSecretos(err.message, url)}`); return 1 }
  console.error(`✓ huella leída de producción: ${mapa.size} grupos`)

  const problemas = validarHuellaLive(mapa, previo)
  if (problemas.length > 0) {
    console.error('\n✗ La huella no pasa los controles; NO se escribe nada:')
    for (const p of problemas) console.error(`    ${p}`)
    return 1
  }
  console.error('✓ controles: SHA-256 completos, grants presentes y tamaño coherente')

  // ── Qué cambia ───────────────────────────────────────────────────────────
  const d = diffHuellas(previo, mapa)
  console.error(`\n  grupos: ${previo.size} → ${mapa.size}`)
  console.error(`  agregados: ${d.agregados.length}   eliminados: ${d.eliminados.length}   ` +
                `cambiados: ${d.cambiados.length}`)
  const MUESTRA = 25
  for (const c of d.agregados.slice(0, MUESTRA)) console.error(`    + ${c}`)
  for (const c of d.eliminados.slice(0, MUESTRA)) console.error(`    − ${c}`)
  for (const c of d.cambiados.slice(0, MUESTRA)) {
    console.error(`    ~ ${c.clave}\n        antes = ${c.antes}\n        ahora = ${c.ahora}`)
  }
  const total = d.agregados.length + d.eliminados.length + d.cambiados.length
  if (total > MUESTRA) console.error(`    … y ${total - MUESTRA} más`)
  if (total === 0) console.error('    (la instantánea ya estaba al día)')

  if (!escribir) { console.error('\n· --en-seco: no se escribe el archivo'); return 0 }

  // La prosa (`_README`, `_CANONICO`, `_ADVERTENCIA`) se conserva tal cual:
  // este comando refresca MEDICIONES, no documentación.
  const salida = {
    ...doc,
    capturada: new Date().toISOString().slice(0, 10),
    proyecto: esperado,
    postgres: medidas.version,
    algoritmo: 'sha256',
    grupos: Object.fromEntries([...mapa].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => [k, `${v.huella}:${v.n}`])),
  }

  // ── Temporal, validado, y sólo entonces rename ───────────────────────────
  //
  // POR QUÉ NO SE ESCRIBE EN EL ARCHIVO DIRECTAMENTE. Un `writeFileSync` sobre
  // la ruta versionada trunca primero y escribe después: si el proceso se muere
  // en el medio —OOM, cancelación del job, disco lleno— lo que queda es un JSON
  // cortado que ya no es ni la instantánea vieja ni la nueva, y el paso
  // siguiente lo publicaría como artefacto. `rename(2)` dentro del mismo
  // directorio es atómico: o está la vieja completa, o está la nueva completa.
  //
  // Y ANTES DEL RENAME SE RELEE. Se valida lo que quedó EN DISCO, no el objeto
  // que se acaba de serializar: eso es lo único que prueba que el archivo que
  // se va a publicar se parsea, trae los mismos grupos que se midieron y pasa
  // los mismos controles. Si algo no cuadra, el temporal se borra y la
  // instantánea versionada no se tocó.
  const temporal = `${RUTA_PRODUCCION}.nueva.${process.pid}`
  try {
    writeFileSync(temporal, JSON.stringify(salida, null, 1) + '\n')

    const relectura = huellaProduccionVersionada(temporal)
    const fallas = validarHuellaLive(relectura.mapa, mapa, { tolerancia: 0 })
    const distintos = [...mapa].filter(([k, v]) => {
      const r = relectura.mapa.get(k); return !r || r.huella !== v.huella || r.n !== v.n
    })
    if (distintos.length > 0) {
      fallas.push(`${distintos.length} grupo(s) no sobrevivieron la serialización: ` +
                  distintos.slice(0, 5).map(([k]) => k).join(', '))
    }
    if (relectura.doc.proyecto !== esperado) {
      fallas.push(`el archivo quedó con proyecto «${relectura.doc.proyecto}» y se midió «${esperado}»`)
    }
    if (relectura.doc.capturada !== salida.capturada) {
      fallas.push('la fecha de captura no quedó registrada')
    }
    // El mismo guard que el test de `__tests__`, acá también: lo que se publica
    // no puede llevar una cadena de conexión adentro.
    if (/postgres(?:ql)?:\/\//i.test(readFileSync(temporal, 'utf8'))) {
      fallas.push('el archivo contiene algo con forma de cadena de conexión')
    }
    if (fallas.length > 0) {
      console.error('\n✗ El archivo temporal no pasa la relectura; NO se reemplaza nada:')
      for (const f of fallas) console.error(`    ${f}`)
      return 1
    }

    renameSync(temporal, RUTA_PRODUCCION)
  } finally {
    rmSync(temporal, { force: true })
  }

  console.error(`✓ relectura: ${mapa.size} grupos leídos del archivo nuevo, idénticos a los medidos`)
  console.error(`\n✓ ${RUTA_PRODUCCION} refrescada — ${mapa.size} grupos, capturada ${salida.capturada}`)
  return 0
}

/**
 * El modo live, de punta a punta, contra un clúster desechable que hace de
 * producción — con conexión por URL y un rol distinto, no con `SET ROLE`.
 *
 * Lo que se prueba es el CAMINO COMPLETO: conectar, medir la credencial, leer
 * el catálogo, validar y escribir. Y lo que más importa: que la huella que saca
 * la credencial de solo lectura sea EXACTAMENTE la que saca el dueño. Esa
 * igualdad es lo que hace honesto el refresco, y depende de la regla 7 de
 * fingerprint.sql: con la formulación anterior, todos los /grants salían vacíos.
 */
async function pruebaLive() {
  const comprobar = (cond, etiqueta) => {
    console.error(`${cond ? '✓' : '✗'} ${etiqueta}`)
    if (!cond) process.exitCode = 1
    return cond
  }

  const db = reconstruir({ log: m => console.error(`  ${m}`) })
  const respaldo = readFileSync(RUTA_PRODUCCION, 'utf8')
  const tmp = mkdtempSync(join(tmpdir(), 'live-'))
  try {
    if (db.fallos.length > 0) {
      console.error(`✗ ${db.fallos.length} migración(es) no aplicaron.`); process.exit(1)
    }

    // ── Poner el clúster desechable en el estado que tiene producción ───────
    //
    // Se revoca EXECUTE de PUBLIC sobre TODAS las funciones SECURITY DEFINER.
    //
    // POR QUÉ HACE FALTA ACÁ Y NO EN PRODUCCIÓN. Esto reconstruye el esquema
    // desde las migraciones, y una `CREATE FUNCTION` sin `REVOKE` posterior
    // deja el ACL por defecto, que incluye EXECUTE a PUBLIC. Producción NO está
    // así: una consulta de solo lectura al catálogo real (2026-09-03 17:29 UTC)
    // dio 249 funciones SECURITY DEFINER en `public`, 0 con proacl nulo o por
    // defecto y 0 con EXECUTE efectivo procedente de PUBLIC — los permisos
    // están concedidos explícitamente (1 a `anon`, 118 a `authenticated`), que
    // es otra conversación y no alcanza a un rol sin membresías.
    //
    // Así que este REVOKE no «arregla» nada del test: alinea el clúster con
    // producción en la única dimensión donde la reconstrucción difiere. Que
    // difieran es en sí mismo drift —del que el auditor ya declara 29 grupos de
    // grants de EXECUTE en su baseline—, y no es asunto de esta prueba.
    db.psql(['-v', 'ON_ERROR_STOP=1', '-q', '-c', `
      DO $revocar$
      DECLARE f record;
      BEGIN
        FOR f IN SELECT p.oid::regprocedure AS firma
                   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname NOT LIKE 'pg\\_%' AND n.nspname <> 'information_schema'
                    AND p.prosecdef
        LOOP
          EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', f.firma);
        END LOOP;
      END
      $revocar$;`], { stdio: 'pipe' })

    // La credencial que el modo live va a usar en producción, tal como la
    // prescribe el README: USAGE sobre `public` y ninguna membresía.
    // USAGE sobre `public` Y `extensions`: los dos esquemas del `search_path`.
    // Sin el segundo, `citext` se serializa `extensions.citext` y la huella
    // deja de coincidir con la del dueño — el caso negativo lo comprueba.
    db.psql(['-v', 'ON_ERROR_STOP=1', '-q', '-c',
      'CREATE ROLE drift_lector LOGIN; ' +
      'GRANT USAGE ON SCHEMA public, extensions TO drift_lector;'], { stdio: 'pipe' })
    db.psql(['-v', 'ON_ERROR_STOP=1', '-q', '-c',
      'CREATE ROLE drift_corto LOGIN; GRANT USAGE ON SCHEMA public TO drift_corto;'], { stdio: 'pipe' })

    // ── Un rol por privilegio rechazado ─────────────────────────────────────
    //
    // Uno por regla, con ESE privilegio y nada más, para que el rechazo que se
    // observa sea el de la regla que se está probando y no un efecto colateral.
    // Todos reciben el mismo USAGE que el rol bueno: si les faltara, se los
    // rechazaría por el search_path y la prueba no probaría nada.
    //
    // Las funciones SECURITY DEFINER se crean acá a propósito: el REVOKE de
    // arriba deja el clúster limpio, así que sin volver a abrir alguna a mano
    // los casos negativos no tendrían nada que detectar y pasarían por vacuos.
    //
    // Y se reparten en esquemas PROPIOS, no en `public`, por dos razones. La
    // credencial se conecta a Postgres y no a PostgREST, así que un esquema
    // cualquiera es tan alcanzable como `public` — el guard tiene que mirarlos
    // todos, y acá se prueba que los mira. Y separándolos, el USAGE de cada
    // esquema se le da sólo al rol de su caso: el rol bueno no los ve, y su
    // camino feliz sigue siendo el camino feliz.
    db.psql(['-v', 'ON_ERROR_STOP=1', '-q', '-c', `
      CREATE ROLE drift_grupo NOLOGIN;

      -- a) en public, con GRANT DIRECTO al auditor (sin PUBLIC de por medio)
      CREATE FUNCTION public.drift_sd() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
      REVOKE EXECUTE ON FUNCTION public.drift_sd() FROM PUBLIC;

      -- b) en un esquema PROPIO, alcanzable por EXECUTE a PUBLIC
      CREATE SCHEMA drift_esq_pub;
      CREATE FUNCTION drift_esq_pub.sd() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;

      -- c) en \`extensions\`, con GRANT directo: el esquema no es «expuesto» por
      --    la API y da exactamente igual, porque acá no hay API de por medio
      CREATE FUNCTION extensions.drift_sd_ext() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;
      REVOKE EXECUTE ON FUNCTION extensions.drift_sd_ext() FROM PUBLIC;

      -- d) EXECUTE a PUBLIC pero en un esquema SIN USAGE: no es alcanzable, y
      --    el guard no tiene que inventarse un rechazo
      CREATE SCHEMA drift_esq_cerrado;
      CREATE FUNCTION drift_esq_cerrado.sd() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;`,
    ], { stdio: 'pipe' })
    const NEGATIVOS = [
      // Los cuatro atributos del rol. Estaban «comprobados» desde el primer
      // día y NINGUNO funcionaba: el SQL devolvía 'true' y el JavaScript
      // comparaba contra 't'. Un guard que falla abierto no se nota hasta que
      // alguien lo ejercita con un rol culpable, así que acá está el rol.
      { rol: 'drift_super',      regla: 'SUPERUSUARIO',
        pecado: 'ALTER ROLE drift_super SUPERUSER;' },
      { rol: 'drift_bypass',     regla: 'BYPASSRLS',
        pecado: 'ALTER ROLE drift_bypass BYPASSRLS;' },
      { rol: 'drift_creador_roles', regla: 'CREATEROLE',
        pecado: 'ALTER ROLE drift_creador_roles CREATEROLE;' },
      { rol: 'drift_creador_bases', regla: 'CREATEDB',
        pecado: 'ALTER ROLE drift_creador_bases CREATEDB;' },
      { rol: 'drift_escritor',   regla: 'ESCRITURA',
        pecado: 'GRANT INSERT ON public.clientes TO drift_escritor;' },
      { rol: 'drift_selector',   regla: 'SELECT DE TABLA',
        pecado: 'GRANT SELECT ON public.clientes TO drift_selector;' },
      { rol: 'drift_columnista', regla: 'SELECT POR COLUMNA',
        pecado: 'GRANT SELECT (id) ON public.clientes TO drift_columnista;' },
      { rol: 'drift_replicante', regla: 'REPLICATION',
        pecado: 'ALTER ROLE drift_replicante REPLICATION;' },
      { rol: 'drift_creador',    regla: 'CREATE SOBRE ESQUEMA',
        pecado: 'GRANT CREATE ON SCHEMA public TO drift_creador;' },
      { rol: 'drift_miembro',    regla: 'MEMBRESÍA',
        pecado: 'GRANT drift_grupo TO drift_miembro;' },
      // Las cuatro formas de alcanzar —o no— una SECURITY DEFINER.
      { rol: 'drift_secdef',     regla: 'SECURITY DEFINER', via: 'drift_secdef',
        que: 'un GRANT EXECUTE directo al auditor, en public',
        pecado: 'GRANT EXECUTE ON FUNCTION public.drift_sd() TO drift_secdef;' },
      { rol: 'drift_sd_publico', regla: 'SECURITY DEFINER', via: 'PUBLIC',
        que: 'EXECUTE a PUBLIC en un esquema propio con USAGE',
        pecado: 'GRANT USAGE ON SCHEMA drift_esq_pub TO drift_sd_publico;' },
      { rol: 'drift_sd_ext',     regla: 'SECURITY DEFINER', via: 'drift_sd_ext',
        que: 'un GRANT directo sobre una función de `extensions`',
        pecado: 'GRANT EXECUTE ON FUNCTION extensions.drift_sd_ext() TO drift_sd_ext;' },
    ]
    for (const n of NEGATIVOS) {
      db.psql(['-v', 'ON_ERROR_STOP=1', '-q', '-c',
        `CREATE ROLE ${n.rol} LOGIN; GRANT USAGE ON SCHEMA public, extensions TO ${n.rol}; ${n.pecado}`,
      ], { stdio: 'pipe' })
    }

    const urlDe = (rol) =>
      `postgresql://${rol}@/postgres?host=${db.entorno.PGHOST}&port=${db.entorno.PGPORT}`

    // `spawnSync`, no `execFileSync`: hace falta stderr TAMBIÉN cuando el
    // comando sale 0 —ahí es donde el modo live escribe todo lo que informa— y
    // execFileSync sólo lo devuelve dentro del error.
    const correr = (args, entorno = {}) => {
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], {
        encoding: 'utf8', env: { ...process.env, ...entorno },
      })
      return { codigo: r.status ?? 1, salida: `${r.stdout ?? ''}${r.stderr ?? ''}` }
    }

    // ── 1 · sin credencial, no se hace nada ────────────────────────────────
    const sinUrl = correr(['--sembrar-produccion'], { [VAR_URL_LIVE]: '' })
    comprobar(sinUrl.codigo !== 0, 'sin la variable de entorno, el modo live se niega a correr')
    comprobar(/SUPABASE_ACCESS_TOKEN/.test(sinUrl.salida),
      'y dice explícitamente que no se reutiliza el token administrativo')

    // ── 2 · un privilegio de más, un rechazo ───────────────────────────────
    //
    // Uno por regla, contra un rol REAL con ese privilegio, por URL. Se exige
    // que salga distinto de cero Y que el motivo sea el de la regla que se
    // probaba: un guard que rechaza por la razón equivocada deja de rechazar el
    // día que la razón equivocada desaparece.
    //
    // Y ADEMÁS se exige que NO se haya leído el catálogo. Es la mitad que se
    // olvida: rechazar después de haber leído no sirve de nada si lo que
    // importaba era no darle a esa credencial acceso a producción.
    for (const n of NEGATIVOS) {
      const r = correr(['--sembrar-produccion', '--proyecto', 'prueba'],
        { [VAR_URL_LIVE]: urlDe(n.rol) })
      comprobar(r.codigo !== 0 && new RegExp(`✗ ${n.regla}:`).test(r.salida),
        `${n.rol}: se rechaza por ${n.regla}${n.que ? ` — ${n.que}` : ''}`)
      comprobar(!/huella leída de producción/.test(r.salida),
        `${n.rol}: y se rechaza ANTES de leer el catálogo`)
      // Cuando la regla depende de POR DÓNDE llega el privilegio, se exige que
      // el diagnóstico lo diga: el remedio no es el mismo, y proponer el REVOKE
      // equivocado deja creer que el agujero se cerró.
      if (n.via) {
        comprobar(new RegExp(`vía ${n.via}\\]`).test(r.salida),
          `${n.rol}: y el diagnóstico dice que llega vía ${n.via}`)
        const remedio = n.via === 'PUBLIC' ? 'FROM PUBLIC;' : `FROM ${n.rol};`
        comprobar(r.salida.includes(remedio),
          `${n.rol}: y propone revocarle a quien corresponde (${remedio})`)
      }
    }

    // ── 2 bis · lo que NO es alcanzable no se rechaza ───────────────────────
    //
    // La otra mitad de la regla, y la que evita que se vuelva ruido: hay una
    // SECURITY DEFINER con EXECUTE a PUBLIC en `drift_esq_cerrado`, y este rol
    // no tiene USAGE sobre ese esquema. `has_function_privilege` dice que sí
    // puede ejecutarla; sin USAGE no puede ni nombrarla. Un guard que rechazara
    // por eso obligaría a limpiar funciones que nadie alcanza, y a la tercera
    // vez alguien lo apaga.
    const cerrado = correr(['--sembrar-produccion', '--proyecto', 'prueba', '--en-seco'],
      { [VAR_URL_LIVE]: urlDe('drift_lector') })
    comprobar(cerrado.codigo === 0 && !/✗ SECURITY DEFINER/.test(cerrado.salida),
      'una SECURITY DEFINER con EXECUTE a PUBLIC en un esquema SIN USAGE no es alcanzable, y no se rechaza')

    // ── 2 ter · la cadena de conexión, antes de abrirla ────────────────────
    //
    // El guard vive en `validarUrlLive` y se prueba exhaustivamente en vitest;
    // acá se comprueba que está CONECTADO al camino real. `options=` es el caso
    // que más importa: deshace por URL el `default_transaction_read_only` que
    // `PGOPTIONS` fija por entorno.
    const conOptions = correr(['--sembrar-produccion', '--proyecto', 'prueba'],
      { [VAR_URL_LIVE]: `${urlDe('drift_lector')}&options=-c%20default_transaction_read_only%3Doff` })
    comprobar(conOptions.codigo !== 0 && /«options»/.test(conOptions.salida),
      'una URL con `options=` se rechaza antes de conectarse')
    comprobar(!/credencial de solo lectura/.test(conOptions.salida),
      'y se rechaza sin haber abierto la conexión')
    // El mensaje del caso de escritura sigue diciendo en cuántas tablas, que es
    // lo que hace accionable el rechazo.
    const escritor = correr(['--sembrar-produccion', '--proyecto', 'prueba'],
      { [VAR_URL_LIVE]: urlDe('drift_escritor') })
    comprobar(/puede escribir en \d+ tabla/.test(escritor.salida),
      'y el motivo dice en cuántas tablas puede escribir')

    // ── 3 · sin saber qué proyecto es, tampoco ─────────────────────────────
    const sinProyecto = correr(['--sembrar-produccion'], { [VAR_URL_LIVE]: urlDe('drift_lector') })
    comprobar(sinProyecto.codigo !== 0 && /--proyecto/.test(sinProyecto.salida),
      'sin poder deducir el proyecto y sin --proyecto, no se versiona nada')

    // ── 3 bis · sin USAGE sobre un esquema del search_path, se niega ───────
    // Es el fallo que más caro sale: no rompe nada, sólo serializa nombres
    // cualificados, y el refresco quedaría versionado con drift permanente.
    const corto = correr(['--sembrar-produccion', '--proyecto', 'prueba'],
      { [VAR_URL_LIVE]: urlDe('drift_corto') })
    comprobar(corto.codigo !== 0, 'un rol sin USAGE sobre un esquema del search_path se rechaza')
    comprobar(/extensions/.test(corto.salida) && /GRANT USAGE ON SCHEMA/.test(corto.salida),
      'y el mensaje nombra el esquema que falta y el GRANT que lo arregla')

    // ── 4 · el camino feliz, en seco ───────────────────────────────────────
    const seco = correr(['--sembrar-produccion', '--proyecto', 'prueba', '--en-seco'],
      { [VAR_URL_LIVE]: urlDe('drift_lector') })
    comprobar(seco.codigo === 0, '--en-seco corre entero y sale 0')
    comprobar(/sin superusuario, sin BYPASSRLS/.test(seco.salida), 'la credencial se mide, no se declara')
    comprobar(readFileSync(RUTA_PRODUCCION, 'utf8') === respaldo, '--en-seco NO tocó el archivo versionado')

    // ── 5 · y escribiendo de verdad ────────────────────────────────────────
    const real = correr(['--sembrar-produccion', '--proyecto', 'prueba'],
      { [VAR_URL_LIVE]: urlDe('drift_lector') })
    comprobar(real.codigo === 0, 'el refresco corre y sale 0')

    // El archivo no se escribe en su sitio: se escribe aparte, SE RELEE y sólo
    // entonces se reemplaza con `rename(2)`. Lo que se valida es lo que quedó
    // en disco —no el objeto que se serializó—, porque el archivo es lo único
    // que el paso siguiente va a publicar.
    comprobar(/relectura: \d+ grupos leídos del archivo nuevo/.test(real.salida),
      'el archivo se relee del disco antes de reemplazar la instantánea')
    const sobrantes = readdirSync(AQUI).filter(f => f.startsWith('huella-produccion.json.'))
    comprobar(sobrantes.length === 0,
      `no queda ningún archivo temporal a medio escribir (${sobrantes.join(', ') || 'ninguno'})`)

    const escrita = huellaProduccionVersionada(RUTA_PRODUCCION).mapa
    const delDueno = parsearHuella(huella(db.psql))

    // LA PROPIEDAD CENTRAL: lo que lee la credencial de solo lectura es
    // exactamente lo que hay. Con la formulación anterior de los grants, los
    // 563 grupos /grants habrían salido vacíos y esto fallaría.
    const distintos = [...delDueno].filter(([k, v]) => {
      const e = escrita.get(k); return !e || e.huella !== v.huella || e.n !== v.n
    })
    comprobar(escrita.size === delDueno.size && distintos.length === 0,
      `la huella del rol de solo lectura es idéntica a la del dueño (${delDueno.size} grupos)`)
    if (distintos.length > 0) {
      for (const [k] of distintos.slice(0, 5)) console.error(`    difiere: ${k}`)
    }

    const grants = [...escrita].filter(([k]) => k.endsWith('/grants'))
    comprobar(grants.length > 0 && grants.every(([, v]) => v.n > 0),
      `los ${grants.length} grupos /grants quedaron con contenido, ninguno vacío`)

    // ── 6 · metadatos y ausencia de secretos ───────────────────────────────
    const docNuevo = leerJson(RUTA_PRODUCCION)
    comprobar(docNuevo.proyecto === 'prueba', 'el proyecto queda registrado')
    comprobar(/^\d{4}-\d{2}-\d{2}$/.test(docNuevo.capturada), 'la fecha de captura queda registrada')
    comprobar(typeof docNuevo.postgres === 'string' && docNuevo.postgres.length > 0,
      `la versión de Postgres queda registrada (${docNuevo.postgres})`)
    const docPrevio = JSON.parse(respaldo)
    comprobar(!!docPrevio._README && docNuevo._README === docPrevio._README &&
              docNuevo._CANONICO === docPrevio._CANONICO && docNuevo._ADVERTENCIA === docPrevio._ADVERTENCIA,
      'la prosa del archivo se conserva: este comando refresca mediciones, no documentación')

    const crudo = readFileSync(RUTA_PRODUCCION, 'utf8')
    comprobar(!/postgres(ql)?:\/\//i.test(crudo), 'el archivo no contiene ninguna cadena de conexión')
    comprobar(!crudo.includes(db.entorno.PGHOST), 'ni el host de la base')
    comprobar(!/drift_lector/.test(crudo), 'ni el nombre del rol')

    // ── 7 · el guard de la huella incompleta ───────────────────────────────
    // Se comprueba sobre la función pura, con el resultado real: si todos los
    // /grants vinieran vacíos, el refresco tiene que negarse.
    const mutilada = new Map([...escrita].map(([k, v]) =>
      [k, k.endsWith('/grants') ? { huella: v.huella, n: 0 } : v]))
    const quejas = validarHuellaLive(mutilada, escrita)
    comprobar(quejas.some(q => /VAC/i.test(q)),
      'una huella con todos los /grants vacíos se rechaza antes de escribirse')

    console.error('\n✓ Modo live: credencial medida, huella idéntica a la del dueño, ' +
                  'guards activos y nada escrito cuando algo no cuadra.')
  } finally {
    writeFileSync(RUTA_PRODUCCION, respaldo)
    rmSync(tmp, { recursive: true, force: true })
    db.destruir()
  }
}

async function principal() {
  const soloBaseline = bandera('--solo-baseline')
  const sembrarProduccion = bandera('--sembrar-produccion')
  const sembrarBaseline = bandera('--sembrar-baseline')
  const pruebaNegativa = bandera('--prueba-negativa')
  const verificarHuella = bandera('--verificar-huella')
  const pruebaEspacios = bandera('--prueba-espacios')
  const pruebaAcl = bandera('--prueba-acl')
  // `--trinquete-contra` sigue aceptándose: es el nombre que usaba #827 cuando
  // la comparación era de dos vías, y ahora esa misma ref es además M.
  const refBase = valor('--base') ?? valor('--trinquete-contra') ?? 'origin/main'

  if (bandera('--prueba-tres-vias')) return pruebaTresVias()
  if (bandera('--prueba-live')) return pruebaLive()

  // El modo live no reconstruye nada: lee producción. Va antes de todo lo
  // demás para no levantar un Postgres que no hace falta.
  if (sembrarProduccion) {
    process.exitCode = sembrarProduccionLive({
      url: process.env[VAR_URL_LIVE] ?? '',
      proyectoEsperado: valor('--proyecto'),
      escribir: !bandera('--en-seco'),
    })
    return
  }

  const baseline = leerJson(RUTA_BASELINE)
  // Al sembrar todavía no hay huellas fijadas: validar aquí sería exigirle al
  // archivo lo que esta misma corrida va a escribir.
  const problemas = (sembrarBaseline || verificarHuella || pruebaEspacios || pruebaAcl) ? [] : validarBaseline(baseline)
  if (problemas.length > 0) {
    console.error('✗ drift-conocido.json no es válido:')
    for (const p of problemas) console.error(`    ${p}`)
    process.exit(1)
  }
  console.error(`✓ baseline válida — ${clavesDeBaseline(baseline).size} grupo(s) de drift declarados`)

  // `--verificar-huella` y `--prueba-espacios` sólo ejercitan la serialización
  // contra un catálogo real: no comparan contra nada versionado y por eso no
  // piden rama base. Exigirles una haría que fallaran por el checkout.
  const sinRamaBase = verificarHuella || pruebaEspacios || pruebaAcl

  if (!sinRamaBase) {
    const base = baselineDeLaBase(refBase)
    if (base === null) {
      console.error(`· sin baseline en ${refBase}: es la primera vez, no hay trinquete que verificar`)
    } else {
      const t = verificarTrinquete(baseline, base)
      for (const c of t.retiradas) console.error(`✓ drift retirado de la baseline: ${c}`)
      if (!t.ok) {
        console.error(`\n✗ La baseline CRECIÓ respecto de ${refBase}. Sólo puede encoger.`)
        for (const c of t.agregadas) console.error(`    + ${c}`)
        console.error('\n  Un drift nuevo se arregla con una migración forward-only, no ampliando la lista.')
        process.exit(1)
      }
    }
  }

  // ── El diff de migraciones ────────────────────────────────────────────────
  // Es barato y decide solo casi todo: una migración histórica reescrita o
  // borrada rompe sin necesidad de levantar un Postgres.
  const migraciones = sinRamaBase
    ? null
    : diffMigraciones(migracionesEnRef(refBase), migracionesEnDisco(DIR_MIGRACIONES))
  if (migraciones) {
    console.error(
      `✓ migraciones: ${migraciones.agregadas.length} nueva(s), ` +
      `${migraciones.modificadas.length} modificada(s), ${migraciones.eliminadas.length} eliminada(s)`,
    )
  }

  if (soloBaseline) { console.error('✓ sólo se pidió validar la baseline'); return }

  const db = reconstruir({ log: m => console.error(m) })
  try {
    if (db.fallos.length > 0) {
      console.error(`\n✗ ${db.fallos.length} migración(es) no aplicaron sobre una base limpia:`)
      for (const f of db.fallos) console.error(`  ${f.migracion}\n    ${f.error}`)
      process.exit(1)
    }
    console.error(`✓ ${db.migraciones.length} migraciones aplicadas sobre una base vacía`)

    if (verificarHuella) {
      // ── Propiedades de la huella, contra un catálogo real ──────────────
      // Se prueban aquí y no en vitest porque lo que puede fallar es la
      // SERIALIZACIÓN EN SQL, no el JavaScript. Probar una reimplementación en
      // JS sería probar el doble, no la cosa.
      const a = huella(db.psql)
      const b = huella(db.psql)
      if (a !== b) { console.error('✗ DETERMINISMO: dos corridas seguidas dieron huellas distintas.'); process.exit(1) }
      console.error('✓ determinismo: dos corridas consecutivas, huella byte a byte idéntica')

      // Entradas equivalentes: el mismo catálogo leído con otro plan de
      // ejecución. Si el orden del agregado dependiera del plan y no del
      // `ORDER BY ... COLLATE "C"`, esto lo delataría.
      db.psql(['-q','-c','SET enable_seqscan=off;','-c','SET enable_indexscan=off;'], { stdio: 'pipe' })
      const c = db.psql(['-tAq','-c','SET enable_seqscan=off; SET enable_hashagg=off;','-f', RUTA_FINGERPRINT], { stdio: 'pipe' }).trim()
      if (c !== a) { console.error('✗ EQUIVALENCIA: el mismo catálogo con otro plan dio otra huella.'); process.exit(1) }
      console.error('✓ equivalencia: mismo catálogo, otro plan de ejecución, misma huella')

      const antes = parsearHuella(a)
      for (const [clave, v] of antes) {
        if (!RE_HUELLA.test(v.huella)) { console.error(`✗ FORMATO: ${clave} no es SHA-256 de 64 hex.`); process.exit(1) }
      }
      console.error(`✓ formato: ${antes.size}/${antes.size} grupos con SHA-256 de 64 hex`)

      // Un cambio normalizado relevante TIENE que mover la huella. Se elige el
      // más pequeño que existe: quitar un NOT NULL. No cambia nombres, ni
      // tipos, ni conteos — sólo un booleano dentro de la serialización.
      db.psql(['-v','ON_ERROR_STOP=1','-q','-c',
        'ALTER TABLE public.clientes ALTER COLUMN nombre DROP NOT NULL;'], { stdio: 'pipe' })
      const despues = parsearHuella(huella(db.psql))
      const movidos = [...antes.keys()].filter(k => antes.get(k).huella !== despues.get(k)?.huella)
      if (movidos.length !== 1 || movidos[0] !== 'tabla:clientes/columnas') {
        console.error(`✗ SENSIBILIDAD: quitar un NOT NULL movió ${movidos.length} grupo(s): ${movidos.join(', ') || '(ninguno)'}`)
        console.error('  Se esperaba exactamente tabla:clientes/columnas.')
        process.exit(1)
      }
      if (antes.get(movidos[0]).n !== despues.get(movidos[0]).n) {
        console.error('✗ SENSIBILIDAD: el conteo cambió; el cambio no era sólo del NOT NULL.'); process.exit(1)
      }
      console.error('✓ sensibilidad: quitar un NOT NULL mueve exactamente 1 grupo, sin tocar el conteo')
      console.error('\n✓ La huella es determinista, estable ante entradas equivalentes y sensible al cambio.')
      return
    }

    if (pruebaEspacios) {
      // ── El espaciado dentro del CONTENIDO tiene que mover la huella ─────
      //
      // Una versión anterior colapsaba espacios con `regexp_replace('\s+',' ')`
      // sobre `prosrc` y sobre las definiciones de vista. Eso no distingue la
      // sangría del contenido: borraba diferencias reales dentro de literales
      // SQL, cuerpos dollar-quoted y vistas. Estas cuatro pruebas fallarían con
      // aquella versión, y por eso existen.
      const casos = [
        {
          nombre: 'literal en el cuerpo de una función: \'a  b\' vs \'a b\'',
          grupo: 'funcion:esp_literal()',
          crear: "CREATE FUNCTION public.esp_literal() RETURNS text LANGUAGE sql AS $$ SELECT 'a  b' $$;",
          mutar: "CREATE OR REPLACE FUNCTION public.esp_literal() RETURNS text LANGUAGE sql AS $$ SELECT 'a b' $$;",
        },
        {
          nombre: "default ' ' vs ''",
          grupo: 'tabla:esp_tabla/columnas',
          crear: "CREATE TABLE public.esp_tabla (c text DEFAULT ' ');",
          mutar: "ALTER TABLE public.esp_tabla ALTER COLUMN c SET DEFAULT '';",
        },
        {
          nombre: "policy comparando contra 'a  b' vs 'a b'",
          grupo: 'tabla:esp_tabla/policies',
          crear: "ALTER TABLE public.esp_tabla ENABLE ROW LEVEL SECURITY; " +
                 "CREATE POLICY esp_pol ON public.esp_tabla FOR SELECT USING (c = 'a  b');",
          mutar: "DROP POLICY esp_pol ON public.esp_tabla; " +
                 "CREATE POLICY esp_pol ON public.esp_tabla FOR SELECT USING (c = 'a b');",
        },
        {
          nombre: 'cuerpo dollar-quoted con whitespace semántico (salto de línea dentro de la cadena)',
          grupo: 'funcion:esp_dollar()',
          crear: "CREATE FUNCTION public.esp_dollar() RETURNS text LANGUAGE plpgsql AS $cuerpo$\nBEGIN\n  RETURN 'linea1\nlinea2';\nEND\n$cuerpo$;",
          mutar: "CREATE OR REPLACE FUNCTION public.esp_dollar() RETURNS text LANGUAGE plpgsql AS $cuerpo$\nBEGIN\n  RETURN 'linea1 linea2';\nEND\n$cuerpo$;",
        },
      ]

      let fallos = 0
      for (const caso of casos) {
        db.psql(['-v', 'ON_ERROR_STOP=1', '-q', '-c', caso.crear], { stdio: 'pipe' })
        const antes = parsearHuella(huella(db.psql)).get(caso.grupo)
        db.psql(['-v', 'ON_ERROR_STOP=1', '-q', '-c', caso.mutar], { stdio: 'pipe' })
        const despues = parsearHuella(huella(db.psql)).get(caso.grupo)

        if (!antes || !despues) {
          console.error(`✗ ${caso.nombre}\n    el grupo ${caso.grupo} no apareció en la huella`)
          fallos++
        } else if (antes.huella === despues.huella) {
          console.error(`✗ ${caso.nombre}\n    la huella NO cambió (${antes.huella.slice(0, 16)}…): ` +
                        'el espaciado del contenido se está normalizando. Es un falso negativo.')
          fallos++
        } else {
          console.error(`✓ ${caso.nombre}`)
        }
      }

      if (fallos > 0) {
        console.error(`\n✗ ${fallos}/${casos.length} caso(s): la huella ignora espaciado que sí es contenido.`)
        process.exit(1)
      }
      console.error(`\n✓ Los ${casos.length} casos mueven la huella: no hay normalización de espacios que borre contenido.`)
      return
    }

    if (pruebaAcl) {
      // ── Los grants salen del ACL, no de information_schema (regla 7) ────
      //
      // Dos propiedades, y hacen falta las dos:
      //
      //   A. EQUIVALENCIA — leer el ACL da byte a byte lo mismo que
      //      information_schema para un rol privilegiado. Sin esto,
      //      `huella-produccion.json` —capturada con la formulación
      //      anterior— dejaría de ser comparable y aparecerían ~563 grupos
      //      de drift falso de golpe.
      //
      //   B. ALCANZABILIDAD — un rol DEDICADO DE SOLO LECTURA saca la MISMA
      //      huella. Es la credencial que el modo live va a usar, y por
      //      information_schema no podía: esos catálogos son relativos al
      //      rol y le habrían devuelto cero grants, hasheando la cadena
      //      vacía sin que nada fallara. Ese es el falso negativo que esta
      //      prueba existe para impedir.

      // El rol tal como lo prescribe el README: USAGE sobre `public` y nada
      // más. Sin membresía en anon/authenticated/service_role — justamente
      // la que lo volvería capaz de leer datos.
      db.psql(['-v', 'ON_ERROR_STOP=1', '-q', '-c',
        'CREATE ROLE drift_solo_lectura NOLOGIN; GRANT USAGE ON SCHEMA public TO drift_solo_lectura;',
      ], { stdio: 'pipe' })

      // A · equivalencia contra la formulación anterior, objeto por objeto.
      const SQL_EQUIVALENCIA = `
        WITH t AS (
          SELECT c.oid, c.relname, c.relacl, c.relowner
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
        ),
        t_viejo AS (
          SELECT t.relname AS clave,
                 coalesce(string_agg(rg.grantee||E'\\x1f'||rg.privilege_type,
                          E'\\x1e' ORDER BY rg.grantee COLLATE "C", rg.privilege_type COLLATE "C"),'') AS linea
          FROM t LEFT JOIN information_schema.role_table_grants rg
            ON rg.table_schema = 'public' AND rg.table_name = t.relname
          GROUP BY 1
        ),
        t_nuevo AS (
          SELECT t.relname AS clave,
                 coalesce(string_agg(rg.grantee||E'\\x1f'||rg.privilege_type,
                          E'\\x1e' ORDER BY rg.grantee COLLATE "C", rg.privilege_type COLLATE "C"),'') AS linea
          FROM t LEFT JOIN LATERAL (
            SELECT coalesce(r.rolname::text,'PUBLIC') AS grantee, a.privilege_type::text AS privilege_type
            FROM aclexplode(coalesce(t.relacl, acldefault('r', t.relowner))) a
            LEFT JOIN pg_roles r ON r.oid = a.grantee
            WHERE a.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
          ) rg ON true
          GROUP BY 1
        ),
        f AS (
          SELECT p.oid, p.proname, p.proacl, p.proowner
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
        ),
        f_viejo AS (
          SELECT f.oid AS clave,
                 coalesce((SELECT string_agg(grantee||E'\\x1f'||privilege_type, E'\\x1e'
                             ORDER BY grantee COLLATE "C", privilege_type COLLATE "C")
                           FROM information_schema.role_routine_grants rr
                           WHERE rr.specific_schema = 'public'
                             AND rr.specific_name = f.proname||'_'||f.oid),'') AS linea
          FROM f
        ),
        f_nuevo AS (
          SELECT f.oid AS clave,
                 coalesce((SELECT string_agg(coalesce(r.rolname::text,'PUBLIC')||E'\\x1f'||a.privilege_type::text, E'\\x1e'
                             ORDER BY coalesce(r.rolname::text,'PUBLIC') COLLATE "C", a.privilege_type::text COLLATE "C")
                           FROM aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a
                           LEFT JOIN pg_roles r ON r.oid = a.grantee
                           WHERE a.privilege_type = 'EXECUTE'),'') AS linea
          FROM f
        )
        SELECT (SELECT count(*) FROM t_viejo)                                                    ||'|'||
               (SELECT count(*) FROM t_viejo v JOIN t_nuevo x USING (clave)
                 WHERE v.linea IS DISTINCT FROM x.linea)                                         ||'|'||
               (SELECT count(*) FROM t_viejo WHERE linea <> '')                                  ||'|'||
               (SELECT count(*) FROM f_viejo)                                                    ||'|'||
               (SELECT count(*) FROM f_viejo v JOIN f_nuevo x USING (clave)
                 WHERE v.linea IS DISTINCT FROM x.linea)                                         ||'|'||
               (SELECT count(*) FROM f_viejo WHERE linea <> '')`
      const [nT, difT, llenasT, nF, difF, llenasF] =
        db.psql(['-tAq', '-c', SQL_EQUIVALENCIA], { stdio: 'pipe' }).trim().split('|').map(Number)

      // Una comparación entre dos conjuntos vacíos coincide siempre. Si el
      // catálogo no trajera objetos, o si ninguno tuviera grants, la prueba
      // pasaría sin haber comparado nada.
      if (nT === 0 || nF === 0 || llenasT === 0 || llenasF === 0) {
        console.error(`✗ PRUEBA VACUA: ${nT} tabla(s), ${nF} función(es), ` +
                      `${llenasT} y ${llenasF} con grants no vacíos. No se comparó nada real.`)
        process.exit(1)
      }
      if (difT !== 0 || difF !== 0) {
        console.error(`✗ EQUIVALENCIA: ${difT} tabla(s) y ${difF} función(es) serializan distinto ` +
                      'leyendo el ACL que leyendo information_schema.')
        console.error('  huella-produccion.json se capturó con la formulación anterior: si la ' +
                      'serialización cambia, hay que regenerarla o todo /grants es drift falso.')
        process.exit(1)
      }
      console.error(`✓ equivalencia: ${nT} tablas y ${nF} funciones serializan IGUAL por ACL que por ` +
                    `information_schema (${llenasT} y ${llenasF} con grants no vacíos)`)

      // B · la misma huella, leída por el rol de solo lectura.
      const soloGrants = (texto) =>
        [...parsearHuella(texto)].filter(([k]) => k.endsWith('/grants'))
                                 .map(([k, v]) => `${k}\t${v.huella}\t${v.n}`).join('\n')

      const dueno = soloGrants(huella(db.psql))
      const lector = soloGrants(
        db.psql(['-tAq', '-c', 'SET ROLE drift_solo_lectura;', '-f', RUTA_FINGERPRINT], { stdio: 'pipe' }).trim())

      if (dueno !== lector) {
        const a = dueno.split('\n'); const b = lector.split('\n')
        const distintas = a.filter((l, i) => l !== b[i]).slice(0, 5)
        console.error(`✗ ALCANZABILIDAD: el rol de solo lectura saca otra huella en ${
          a.filter((l, i) => l !== b[i]).length} grupo(s) /grants.`)
        for (const l of distintas) console.error(`    dueño : ${l}`)
        console.error('  La credencial del modo live no puede reproducir la huella: se estaría ' +
                      'refrescando huella-produccion.json con grants incompletos.')
        process.exit(1)
      }
      console.error(`✓ alcanzabilidad: un rol de solo lectura (USAGE sobre public, sin membresías) ` +
                    `saca los mismos ${dueno.split('\n').length} grupos /grants que el dueño`)

      // Y la contraprueba de por qué hizo falta el cambio: por
      // information_schema, ese mismo rol no ve NADA. Si algún día volviera a
      // leerse de ahí, la propiedad B se rompería en silencio — la huella
      // saldría con la cadena vacía en todo /grants y nada fallaría.
      const visiblesParaElLector = Number(db.psql(['-tAq', '-c',
        "SET ROLE drift_solo_lectura; SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema='public';",
      ], { stdio: 'pipe' }).trim())
      const visiblesParaElDueno = Number(db.psql(['-tAq', '-c',
        "SELECT count(*) FROM information_schema.role_table_grants WHERE table_schema='public';",
      ], { stdio: 'pipe' }).trim())
      if (visiblesParaElLector !== 0 || visiblesParaElDueno === 0) {
        console.error(`✗ La contraprueba no se sostiene: el lector ve ${visiblesParaElLector} filas en ` +
                      `information_schema y el dueño ${visiblesParaElDueno}. Se esperaba 0 y >0.`)
        process.exit(1)
      }
      console.error(`✓ contraprueba: por information_schema ese mismo rol ve 0 de las ` +
                    `${visiblesParaElDueno} concesiones que ve el dueño — por eso no se lee de ahí`)

      // Sensibilidad: si la lectura por ACL devolviera algo constante, todo lo
      // anterior seguiría pasando. Revocar UN privilegio tiene que mover
      // exactamente UN grupo y bajar su conteo en uno.
      const antesRevoke = parsearHuella(huella(db.psql))
      db.psql(['-v', 'ON_ERROR_STOP=1', '-q', '-c',
        'REVOKE SELECT ON public.clientes FROM anon;'], { stdio: 'pipe' })
      const despuesRevoke = parsearHuella(huella(db.psql))
      const movidos = [...antesRevoke.keys()].filter(k => antesRevoke.get(k).huella !== despuesRevoke.get(k)?.huella)
      if (movidos.length !== 1 || movidos[0] !== 'tabla:clientes/grants') {
        console.error(`✗ SENSIBILIDAD: revocar un SELECT movió ${movidos.length} grupo(s): ${movidos.join(', ') || '(ninguno)'}`)
        console.error('  Se esperaba exactamente tabla:clientes/grants.')
        process.exit(1)
      }
      if (despuesRevoke.get(movidos[0]).n !== antesRevoke.get(movidos[0]).n - 1) {
        console.error(`✗ SENSIBILIDAD: el conteo pasó de ${antesRevoke.get(movidos[0]).n} a ` +
                      `${despuesRevoke.get(movidos[0]).n}; se esperaba uno menos.`)
        process.exit(1)
      }
      console.error('✓ sensibilidad: revocar un SELECT mueve exactamente 1 grupo y baja su conteo en 1')

      // ── C · la marca de WITH GRANT OPTION (regla 8) ──────────────────────
      //
      // `aclexplode` devuelve UNA fila por privilegio con `is_grantable` al
      // lado, no dos filas cuando el privilegio se tiene con grant option. La
      // formulación anterior descartaba esa columna: `authenticated=r/postgres`
      // y `authenticated=r*/postgres` serializaban IGUAL, así que conceder la
      // facultad de re-conceder un privilegio —el paso previo a que un rol
      // reparta acceso por su cuenta— era invisible para el auditor.
      //
      // La marca se AGREGA sólo cuando `is_grantable` es cierto. Por eso el
      // conteo no cambia y por eso `huella-produccion.json`, capturada sin la
      // marca, sigue siendo comparable: hoy no hay ni un aclitem con grant
      // option, y se comprueba acá antes de nada.
      const conGrantOption = Number(db.psql(['-tAq', '-c', `
        SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace,
                     aclexplode(c.relacl) a WHERE n.nspname = 'public' AND a.is_grantable)
             + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
                     aclexplode(p.proacl) a WHERE n.nspname = 'public' AND a.is_grantable)`,
      ], { stdio: 'pipe' }).trim())
      if (conGrantOption !== 0) {
        console.error(`✗ COMPATIBILIDAD: ${conGrantOption} aclitem(s) ya traen grant option. La marca ` +
                      'movería grupos que huella-produccion.json capturó sin ella.')
        process.exit(1)
      }
      console.error('✓ compatibilidad: 0 aclitems con grant option en el catálogo, así que la marca ' +
                    'no puede mover ninguna huella ya capturada')

      // Dos objetos nuevos y propios, con UN grant cada uno. Objetos nuevos y
      // no una tabla existente a propósito: así el privilegio de partida es
      // conocido y «conceder lo que ya tenía, pero con grant option» no puede
      // confundirse con «conceder algo que no tenía» —que sí cambiaría el
      // conteo, y entonces la propiedad que se quiere probar no se probaría.
      db.psql(['-v', 'ON_ERROR_STOP=1', '-q', '-c',
        'CREATE TABLE public.acl_go (c int); ' +
        'GRANT SELECT ON public.acl_go TO drift_solo_lectura; ' +
        'CREATE FUNCTION public.acl_go_f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$; ' +
        'REVOKE EXECUTE ON FUNCTION public.acl_go_f() FROM PUBLIC; ' +
        'GRANT EXECUTE ON FUNCTION public.acl_go_f() TO drift_solo_lectura;'], { stdio: 'pipe' })

      const casosGo = [
        { grupo: 'tabla:acl_go/grants', que: 'GRANT SELECT … WITH GRANT OPTION mueve el grupo de la tabla',
          poner: 'GRANT SELECT ON public.acl_go TO drift_solo_lectura WITH GRANT OPTION;',
          quitar: 'REVOKE GRANT OPTION FOR SELECT ON public.acl_go FROM drift_solo_lectura CASCADE;' },
        { grupo: 'funcion:acl_go_f()/grants', que: 'GRANT EXECUTE … WITH GRANT OPTION mueve el grupo de la función',
          poner: 'GRANT EXECUTE ON FUNCTION public.acl_go_f() TO drift_solo_lectura WITH GRANT OPTION;',
          quitar: 'REVOKE GRANT OPTION FOR EXECUTE ON FUNCTION public.acl_go_f() FROM drift_solo_lectura CASCADE;' },
      ]

      for (const caso of casosGo) {
        const antesGo = parsearHuella(huella(db.psql))
        db.psql(['-v', 'ON_ERROR_STOP=1', '-q', '-c', caso.poner], { stdio: 'pipe' })
        const conGo = parsearHuella(huella(db.psql))

        const movidosGo = [...antesGo.keys()].filter(k => antesGo.get(k).huella !== conGo.get(k)?.huella)
        if (movidosGo.length !== 1 || movidosGo[0] !== caso.grupo) {
          console.error(`✗ GRANT OPTION: ${caso.que} — movió ${movidosGo.length} grupo(s): ` +
                        `${movidosGo.join(', ') || '(ninguno)'}. Se esperaba exactamente ${caso.grupo}.`)
          process.exit(1)
        }
        if (conGo.get(caso.grupo).n !== antesGo.get(caso.grupo).n) {
          console.error(`✗ GRANT OPTION: el conteo de ${caso.grupo} pasó de ${antesGo.get(caso.grupo).n} a ` +
                        `${conGo.get(caso.grupo).n}. La marca se AGREGA a un privilegio que ya estaba: ` +
                        'si el conteo se mueve, se está contando dos veces.')
          process.exit(1)
        }
        console.error(`✓ ${caso.que}, y el conteo no cambia (${antesGo.get(caso.grupo).n})`)

        // Y la vuelta: sin grant option, la serialización es EXACTAMENTE la de
        // antes. Es la mitad que hace compatible la instantánea ya capturada —
        // si la marca se colara también cuando `is_grantable` es falso, las
        // ~563 dimensiones /grants aparecerían como drift falso de golpe.
        db.psql(['-v', 'ON_ERROR_STOP=1', '-q', '-c', caso.quitar], { stdio: 'pipe' })
        const vuelta = parsearHuella(huella(db.psql)).get(caso.grupo)
        if (vuelta.huella !== antesGo.get(caso.grupo).huella || vuelta.n !== antesGo.get(caso.grupo).n) {
          console.error(`✗ GRANT OPTION: al quitarla, ${caso.grupo} NO volvió a su huella anterior ` +
                        `(${antesGo.get(caso.grupo).huella.slice(0, 16)}… → ${vuelta.huella.slice(0, 16)}…). ` +
                        'Un ACL sin grant option tiene que serializar como antes de la regla 8.')
          process.exit(1)
        }
        console.error('✓ y al quitarla vuelve byte a byte a la serialización anterior')
      }

      console.error('\n✓ Los grants se leen del ACL: misma serialización que antes, alcanzable con ' +
                    'una credencial de solo lectura, y con la facultad de re-conceder a la vista.')
      return
    }

    // ── La inyección de la prueba negativa ───────────────────────────────
    //
    // Va a los DOS clústeres, M y R, a propósito. Inyectarla sólo en R la
    // haría indistinguible de un cambio planificado —R construye el esquema
    // desde los archivos, así que todo lo que está en R y no en M viene por
    // definición de una migración— y la prueba dejaría de probar lo que dice.
    // Inyectada en ambos, M == R y el objeto queda como «uno que el PR no
    // toca»: exactamente el caso donde el trinquete estricto tiene que romper.
    const INYECCIONES = [
      'ALTER TABLE public.clientes ADD COLUMN auditor_columna_inesperada text;',
      'CREATE POLICY auditor_policy_inesperada ON public.security_logs FOR SELECT TO anon USING (true);',
    ]
    if (pruebaNegativa) {
      for (const sql of INYECCIONES) db.psql(['-v', 'ON_ERROR_STOP=1', '-q', '-c', sql], { stdio: 'pipe' })
      console.error('· prueba negativa: inyectadas clientes.auditor_columna_inesperada y ' +
                    'security_logs/auditor_policy_inesperada en AMBOS clústeres (M y R)')
    }

    const R = parsearHuella(huella(db.psql))
    console.error(`\u2713 huella del HEAD (R): ${R.size} grupos`)

    const { mapa: P, doc } = huellaProduccionVersionada()
    console.error(`\u2713 huella de producción versionada (P): ${P.size} grupos (capturada ${doc.capturada})`)

    if (sembrarBaseline) {
      const drift = calcularDrift(P, R)
      const grupos = {}
      for (const d of drift) {
        const previo = baseline.grupos?.[d.clave]
        grupos[d.clave] = {
          motivo: previo?.motivo ?? 'PENDIENTE: escribir por qué difiere y qué lado es el correcto.',
          desde: previo?.desde ?? new Date().toISOString().slice(0, 10),
          produccion: d.produccion,
          repo: d.repo,
        }
      }
      writeFileSync(RUTA_BASELINE, JSON.stringify({ ...baseline, grupos }, null, 2) + '\n')
      console.error(`\n\u2713 baseline sembrada con ${drift.length} grupos. Escribí un \`motivo\` en cada uno.`)
      return
    }

    // ── M: la reconstrucción de la rama base ─────────────────────────────
    const M = huellaDeLaBase(refBase, m => console.error(m), pruebaNegativa ? INYECCIONES : [])
    console.error(`\u2713 huella de la rama base ${refBase} (M): ${M.size} grupos`)

    // Dos clústeres independientes. Si las migraciones son las mismas y las
    // huellas NO coinciden, algo del clúster —un OID, una marca de tiempo— se
    // está colando en la serialización, y toda comparación posterior mentiría.
    // La verificación de determinismo corre dos veces sobre el MISMO clúster y
    // no puede ver eso; ésta sí.
    if (migraciones.agregadas.length === 0 && migraciones.modificadas.length === 0 &&
        migraciones.eliminadas.length === 0) {
      const distintos = [...new Set([...M.keys(), ...R.keys()])]
        .filter(c => (M.get(c)?.huella ?? null) !== (R.get(c)?.huella ?? null))
      if (distintos.length > 0) {
        console.error(`\n\u2717 Mismas migraciones, clústeres distintos, ${distintos.length} grupo(s) con huella distinta:`)
        for (const c of distintos.slice(0, 10)) console.error(`    ${c}`)
        console.error('\n  La huella depende de algo del clúster y no del esquema. No se compara nada más.')
        process.exit(1)
      }
      console.error('\u2713 sin cambios de migraciones: M y R coinciden grupo a grupo en clústeres independientes')
    }

    const v = evaluarTresVias({ P, M, R, baseline, migraciones })

    const universo = new Set([...P.keys(), ...M.keys(), ...R.keys()]).size
    console.error(`\n  grupos comparados          : ${universo}`)
    console.error(`  el PR no los toca (M == R) : ${v.grupos.filter(g => g.clase === 'sin-cambio').length}`)
    console.error(`  cambios planificados       : ${v.planificados.length}`)
    console.error(`  drift resuelto             : ${v.resueltos.length}`)
    console.error(`  ambiguos                   : ${v.ambiguos.length}`)

    for (const linea of informe(v)) console.error(linea)

    if (!v.ok) process.exit(1)
  } finally {
    db.destruir()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal().catch(err => { console.error(`✗ ${err.message}`); process.exit(1) })
}
