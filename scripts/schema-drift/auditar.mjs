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
// NADA DE DATOS. La huella es DDL agregado y hasheado: ni una fila, ni un
// `count(*)`, ni nada fuera del esquema `public`. Los archivos versionados
// guardan sólo `clave → md5(12) → nº de objetos`. Hay un guard en
// `__tests__` que falla si algo con forma de secreto se cuela.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reconstruir, huella } from './reconstruir.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
export const RUTA_PRODUCCION = join(AQUI, 'huella-produccion.json')
export const RUTA_BASELINE = join(AQUI, 'drift-conocido.json')

// ── funciones puras (las prueba __tests__/auditar.test.mjs) ─────────────────

/** Texto de huella (`clave\thuella\tn` por línea) → Map clave → {huella, n}. */
export function parsearHuella(texto) {
  const mapa = new Map()
  for (const linea of String(texto).split('\n')) {
    const l = linea.trim()
    if (!l) continue
    const [clave, h, n] = l.split('\t')
    if (!clave || !h) throw new Error(`Línea de huella mal formada: ${l.slice(0, 120)}`)
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
      produccion: p ? `${p.huella} (${p.n})` : 'AUSENTE',
      repo: r ? `${r.huella} (${r.n})` : 'AUSENTE',
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

function baselineDeLaBase(ref) {
  try {
    return JSON.parse(execFileSync('git', ['show', `${ref}:scripts/schema-drift/drift-conocido.json`], { encoding: 'utf8' }))
  } catch {
    return null
  }
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
  const refBase = process.argv.includes('--trinquete-contra')
    ? process.argv[process.argv.indexOf('--trinquete-contra') + 1]
    : null

  const baseline = leerJson(RUTA_BASELINE)
  // Al sembrar todavía no hay huellas fijadas: validar aquí sería exigirle al
  // archivo lo que esta misma corrida va a escribir.
  const problemas = sembrarBaseline ? [] : validarBaseline(baseline)
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
