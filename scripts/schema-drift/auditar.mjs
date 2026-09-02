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
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
 * Ref del proyecto Supabase que hay detrás de una URL, o null si no se puede
 * saber. Dos formas: conexión directa (`db.<ref>.supabase.co`) y pooler, que
 * lleva el ref en el usuario, como `<rol>.<ref>`.
 *
 * EL ROL DEL POOLER NO ES SIEMPRE `postgres`. La credencial de este auditor es
 * un rol DEDICADO, así que su usuario en el pooler es `drift_readonly.<ref>`.
 * Reconocer sólo `postgres.<ref>` dejaba sin deducir justo la URL que se va a
 * usar — y el modo live se niega a correr cuando no puede deducir el proyecto,
 * así que habría bloqueado el refresco entero.
 *
 * Sirve para un guard concreto: que un refresco no capture el SANDBOX y lo
 * versione como si fuera producción. Si no se puede determinar, no se adivina.
 */
export function refDeUrl(url) {
  let u
  try { u = new URL(url) } catch { return null }
  const host = u.hostname ?? ''
  const directo = /^db\.([a-z0-9]{20})\.supabase\.(co|com)$/i.exec(host)
  if (directo) return directo[1]
  // `<rol>.<ref>`: el ref es el último segmento, y el rol puede ser cualquiera.
  const porUsuario = /^.+\.([a-z0-9]{20})$/i.exec(decodeURIComponent(u.username ?? ''))
  if (porUsuario && /supabase/i.test(host)) return porUsuario[1]
  return null
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
 * Lo que hay que comprobar del OTRO lado antes de leer nada.
 *
 * El último campo es el menos obvio y el más peligroso: los esquemas del
 * `search_path` sobre los que el rol NO tiene USAGE. `format_type` y
 * `pg_get_expr` cualifican un nombre cuando el objeto no es VISIBLE, y la
 * visibilidad depende del privilegio, no sólo del `search_path`. Un rol sin
 * USAGE sobre `extensions` serializa `extensions.citext` donde el dueño escribe
 * `citext` — misma base, otra huella. Medido: exactamente 1 grupo se movía por
 * eso, y habría quedado versionado como drift permanente.
 */
const SQL_CREDENCIAL = `SELECT
  current_user                                          ||'|'||
  (SELECT rolsuper     FROM pg_roles WHERE rolname = current_user)::text ||'|'||
  (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user)::text ||'|'||
  (SELECT rolcreaterole FROM pg_roles WHERE rolname = current_user)::text ||'|'||
  (SELECT rolcreatedb  FROM pg_roles WHERE rolname = current_user)::text ||'|'||
  current_setting('transaction_read_only')              ||'|'||
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
       AND (has_table_privilege(c.oid,'INSERT') OR has_table_privilege(c.oid,'UPDATE')
            OR has_table_privilege(c.oid,'DELETE') OR has_table_privilege(c.oid,'TRUNCATE')))::text ||'|'||
  current_setting('server_version')                     ||'|'||
  current_setting('search_path')                        ||'|'||
  coalesce((SELECT string_agg(n.nspname, ',' ORDER BY n.nspname)
            FROM unnest(string_to_array(current_setting('search_path'), ',')) AS x
            -- JOIN contra pg_namespace, no un EXISTS en el WHERE: el nombre se
            -- resuelve a OID y las entradas que no son un esquema real —«$user»,
            -- que además llega escapado como «\\$user»— simplemente no casan.
            -- Con \`has_schema_privilege(nombre)\` en el WHERE, el planificador
            -- puede evaluarlo antes del filtro y reventar con «schema does not
            -- exist»; por OID eso no puede pasar.
            JOIN pg_namespace n ON n.nspname = btrim(x, '\\ "')
            WHERE NOT has_schema_privilege(current_user, n.oid, 'USAGE')), '')`

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
  if (!/^postgres(ql)?:\/\//i.test(url)) {
    console.error(`✗ ${VAR_URL_LIVE} no parece una cadena de conexión de Postgres.`)
    return 1
  }

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
  const [usuario, superusuario, bypassrls, crearRoles, crearBases, soloLectura, escribibles,
         version, searchPath, sinUsage] =
    psqlLive(url, ['-tAq', '-c', SQL_CREDENCIAL]).trim().split('|')

  const pecados = []
  if (superusuario === 't') pecados.push('es superusuario')
  if (bypassrls === 't') pecados.push('tiene BYPASSRLS')
  if (crearRoles === 't') pecados.push('puede crear roles')
  if (crearBases === 't') pecados.push('puede crear bases')
  if (Number(escribibles) > 0) pecados.push(`puede escribir en ${escribibles} tabla(s) de public`)
  if (pecados.length > 0) {
    console.error(`✗ La credencial no es de solo lectura: ${pecados.join(', ')}.`)
    console.error('  El modo live lee producción; una credencial que puede escribir no se usa aquí.')
    return 1
  }
  if (soloLectura !== 'on') {
    console.error('✗ La sesión no quedó en solo lectura pese a PGOPTIONS. Se aborta.')
    return 1
  }
  console.error(`✓ credencial de solo lectura: ${usuario} — sin superusuario, sin BYPASSRLS, ` +
                'sin permisos de escritura, sesión read-only')

  // EL GUARD MENOS OBVIO. Un esquema del `search_path` sobre el que el rol no
  // tiene USAGE no lo vuelve ciego: lo vuelve VERBOSO. `format_type` y
  // `pg_get_expr` cualifican lo que no es visible, así que la misma base
  // serializa distinto según quién lea, y el refresco quedaría versionado con
  // nombres cualificados que el auditor vería como drift para siempre.
  if (sinUsage) {
    console.error(`✗ El rol no tiene USAGE sobre: ${sinUsage} — y esos esquemas están en el ` +
                  `search_path (${searchPath}).`)
    console.error('  Sin USAGE, los nombres de esos esquemas se serializan CUALIFICADOS y la huella')
    console.error('  deja de coincidir con la del dueño. No se lee: se corregiría con')
    console.error(`  GRANT USAGE ON SCHEMA ${sinUsage.split(',').join(', ')} TO ${usuario};`)
    return 1
  }
  console.error(`✓ search_path (${searchPath}): el rol tiene USAGE sobre todos sus esquemas`)
  console.error(`· Postgres ${version}`)

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
    postgres: version,
    algoritmo: 'sha256',
    grupos: Object.fromEntries([...mapa].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => [k, `${v.huella}:${v.n}`])),
  }
  writeFileSync(RUTA_PRODUCCION, JSON.stringify(salida, null, 1) + '\n')
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
    // Y una que sí puede escribir, para comprobar que el guard la rechaza.
    db.psql(['-v', 'ON_ERROR_STOP=1', '-q', '-c',
      "CREATE ROLE drift_escritor LOGIN; GRANT USAGE ON SCHEMA public TO drift_escritor; " +
      'GRANT INSERT ON public.clientes TO drift_escritor;'], { stdio: 'pipe' })

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

    // ── 2 · una credencial que puede escribir se rechaza ───────────────────
    const escritor = correr(['--sembrar-produccion', '--proyecto', 'prueba'],
      { [VAR_URL_LIVE]: urlDe('drift_escritor') })
    comprobar(escritor.codigo !== 0, 'una credencial con permiso de escritura se rechaza')
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

      console.error('\n✓ Los grants se leen del ACL: misma serialización que antes, y alcanzable ' +
                    'con una credencial de solo lectura.')
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
