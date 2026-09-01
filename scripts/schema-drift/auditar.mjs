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
// CÓMO FUNCIONA
//   1. Reconstruye el esquema desde las 449 migraciones (reconstruir.mjs).
//   2. Saca la huella normalizada (fingerprint.sql).
//   3. La compara contra `huella-produccion.json`, la instantánea del catálogo
//      real de producción.
//   4. El conjunto de grupos que difieren tiene que estar contenido en
//      `drift-conocido.json`. Uno nuevo → falla. Uno que ya no difiere → falla
//      pidiendo que se retire de la baseline.
//
// LA BASELINE SÓLO PUEDE ENCOGER. Es un trinquete deliberado: si el drift
// resuelto no obligara a podar la lista, la baseline se volvería un `permitir
// todo` de facto — el mismo razonamiento que el `_README` de
// scripts/migraciones-vs-produccion.allowlist.json. `--verificar-trinquete`
// compara además contra la baseline de la rama base, para que un PR no pueda
// agrandarla.
//
// NADA DE DATOS, NADA REVERSIBLE. La huella es DDL agregado y hasheado: ni una
// fila, ni un `count(*)` de negocio, ni nada fuera del esquema `public`. Los
// archivos versionados guardan sólo `clave → sha256(64 hex):nº de objetos`, y de
// un SHA-256 no se reconstruye el DDL. Hay un guard en `__tests__` que falla si
// algo con forma de secreto se cuela.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reconstruir, huella } from './reconstruir.mjs'

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

// ── CLI ─────────────────────────────────────────────────────────────────────

function bandera(nombre) { return process.argv.includes(nombre) }

async function principal() {
  const soloBaseline = bandera('--solo-baseline')
  const sembrarProduccion = bandera('--sembrar-produccion')
  const sembrarBaseline = bandera('--sembrar-baseline')
  const pruebaNegativa = bandera('--prueba-negativa')
  const verificarHuella = bandera('--verificar-huella')
  const pruebaEspacios = bandera('--prueba-espacios')
  const refBase = process.argv.includes('--trinquete-contra')
    ? process.argv[process.argv.indexOf('--trinquete-contra') + 1]
    : null

  const baseline = leerJson(RUTA_BASELINE)
  // Al sembrar todavía no hay huellas fijadas: validar aquí sería exigirle al
  // archivo lo que esta misma corrida va a escribir.
  const problemas = (sembrarBaseline || verificarHuella || pruebaEspacios) ? [] : validarBaseline(baseline)
  if (problemas.length > 0) {
    console.error('✗ drift-conocido.json no es válido:')
    for (const p of problemas) console.error(`    ${p}`)
    process.exit(1)
  }
  console.error(`✓ baseline válida — ${clavesDeBaseline(baseline).size} grupo(s) de drift declarados`)

  if (refBase) {
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

    if (pruebaNegativa) {
      // Prueba negativa REAL contra el catálogo: se inyecta una columna y una
      // policy que ninguna migración declara. Si el auditor no las ve, la huella
      // no sirve y todo lo demás es teatro.
      db.psql(['-v', 'ON_ERROR_STOP=1', '-q', '-c',
        'ALTER TABLE public.clientes ADD COLUMN auditor_columna_inesperada text;'], { stdio: 'pipe' })
      db.psql(['-v', 'ON_ERROR_STOP=1', '-q', '-c',
        'CREATE POLICY auditor_policy_inesperada ON public.security_logs FOR SELECT TO anon USING (true);'], { stdio: 'pipe' })
      console.error('· prueba negativa: inyectadas clientes.auditor_columna_inesperada y security_logs/auditor_policy_inesperada')
    }

    const actual = parsearHuella(huella(db.psql))
    console.error(`✓ huella del repositorio: ${actual.size} grupos`)

    if (sembrarProduccion) {
      console.error('✗ --sembrar-produccion sólo tiene sentido en modo live (ver README: el wiring live está bloqueado).')
      process.exit(1)
    }

    const { mapa: prod, doc } = huellaProduccionVersionada()
    console.error(`✓ huella de producción versionada: ${prod.size} grupos (capturada ${doc.capturada})`)

    const drift = calcularDrift(prod, actual)
    console.error(`\n  grupos comparados : ${new Set([...prod.keys(), ...actual.keys()]).size}`)
    console.error(`  coinciden         : ${new Set([...prod.keys(), ...actual.keys()]).size - drift.length}`)
    console.error(`  difieren          : ${drift.length}`)

    if (sembrarBaseline) {
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
      console.error(`\n✓ baseline sembrada con ${drift.length} grupos. Escribí un \`motivo\` en cada uno.`)
      return
    }

    const v = evaluar(drift, baseline)

    if (v.esperado.length > 0) {
      console.error(`\n  ${v.esperado.length} diferencia(s) declaradas en la baseline (no rompen).`)
    }
    if (v.agravado.length > 0) {
      console.error(`\n✗ DRIFT AGRAVADO — ${v.agravado.length} grupo(s) conocidos cuyas huellas cambiaron:`)
      for (const d of v.agravado) {
        console.error(`    ${d.clave}`)
        console.error(`        esperado: producción=${d.esperadoProduccion}  repo=${d.esperadoRepo}`)
        console.error(`        ahora   : producción=${d.produccion}  repo=${d.repo}`)
      }
      console.error('\n  La baseline declara UNA diferencia concreta, no barra libre en esa tabla.')
    }
    if (v.resuelto.length > 0) {
      console.error(`\n✗ ${v.resuelto.length} entrada(s) de la baseline YA NO corresponden a drift:`)
      for (const c of v.resuelto) console.error(`    ${c}`)
      console.error('\n  Se arregló: retiralas de drift-conocido.json en este mismo PR.')
    }
    if (v.nuevo.length > 0) {
      console.error(`\n✗ DRIFT NUEVO — ${v.nuevo.length} grupo(s) que la baseline no declara:`)
      for (const d of v.nuevo) console.error(`    ${d.clave}\n        producción=${d.produccion}  repo=${d.repo}`)
      console.error('\n  Producción y el repositorio dejaron de describir lo mismo. Se cierra con una')
      console.error('  migración forward-only, no ampliando la baseline.')
    }

    if (!v.ok) process.exit(1)
    console.error('\n✓ Sin drift nuevo. La baseline describe exactamente las diferencias que hay.')
  } finally {
    db.destruir()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal().catch(err => { console.error(`✗ ${err.message}`); process.exit(1) })
}
