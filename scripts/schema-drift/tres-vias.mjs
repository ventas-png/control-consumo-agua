#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Comparación de tres vías: producción ↔ rama base ↔ HEAD del PR
// ════════════════════════════════════════════════════════════════════════════
//
// EL PROBLEMA QUE RESUELVE. El auditor de #827 compara dos cosas: la huella
// versionada de producción (P) y la reconstrucción del árbol de trabajo (R).
// Con dos puntos no se puede distinguir estos dos casos, que son opuestos:
//
//   a) Alguien tocó producción por fuera y el repositorio no lo declara.
//      → drift no autorizado. Tiene que romper.
//   b) El PR agrega una migración forward-only que todavía no se desplegó.
//      → cambio planificado. Tiene que pasar, y quedar dicho que está pendiente.
//
// Los dos se ven idénticos desde P≠R. #828 lo dejó a la vista: cerrar la
// lectura sin autenticar de `payment_requests` puso el auditor en rojo por
// hacer exactamente lo que había que hacer. Un auditor que castiga la
// corrección entrena a la gente a ampliar la baseline, que es justo el hábito
// que #827 existe para impedir.
//
// EL TERCER PUNTO. M = la reconstrucción de la rama base. Con P, M y R el caso
// se decide sin ambigüedad, porque M dice qué describía el repositorio ANTES
// del PR:
//
//   M == R            el PR no toca ese objeto      → trinquete estricto vs P
//   P == M  y  R ≠ M  el PR lo cambia, producción     → CAMBIO PLANIFICADO
//                     coincidía con la base
//   R == P  y  M ≠ P  el PR converge hacia producción → DRIFT RESUELTO
//   P ≠ M ≠ R ≠ P     nadie coincide con nadie        → CAMBIO AMBIGUO, falla
//
// POR QUÉ EL AMBIGUO FALLA EN VEZ DE ELEGIR. Si producción, la base y el PR
// dicen tres cosas distintas sobre el mismo objeto, el auditor no tiene con qué
// decidir si el PR arregla el drift o lo empeora. Adivinar en la dirección
// permisiva es exactamente el fallo que se está tratando de evitar; se cierra
// en falso y que lo mire una persona.
//
// LO QUE NO CAMBIA. La baseline sigue sin poder crecer, un cambio planificado
// NO se agrega a `drift-conocido.json` —se declara como pendiente de despliegue
// y desaparece solo cuando la migración llega a producción— y el drift sobre un
// objeto que el PR no toca sigue rompiendo igual que antes.
//
// PURO A PROPÓSITO. Todo este archivo son funciones sin E/S: reciben Maps de
// huellas y listas de nombres, y devuelven un veredicto. Así las nueve
// situaciones obligatorias se prueban en `npm test` sin levantar un Postgres.

import { AUSENTE, clavesDeBaseline, evaluar } from './auditar.mjs'

/** Valor comparable de un grupo en una huella: `<sha256>:<n>` o `AUSENTE`. */
export function valorDe(mapa, clave) {
  const v = mapa.get(clave)
  return v ? `${v.huella}:${v.n}` : AUSENTE
}

// ── clasificación ───────────────────────────────────────────────────────────

export const SIN_CAMBIO = 'sin-cambio'
export const PLANIFICADO = 'planificado'
export const RESUELTO = 'resuelto'
export const AMBIGUO = 'ambiguo'

/**
 * Las cuatro reglas, sobre un solo grupo. El orden importa: `M == R` se decide
 * primero porque significa «el PR no participa», y ahí no hay nada que
 * interpretar — se aplica el trinquete de siempre.
 */
export function clasificarGrupo(p, m, r) {
  if (m === r) return SIN_CAMBIO
  if (p === m) return PLANIFICADO  // producción y la base coinciden: falta desplegar
  if (p === r) return RESUELTO     // el PR alcanza a producción: el drift se cierra
  return AMBIGUO                   // tres valores distintos: no se decide
}

/** Clasifica los tres mapas grupo por grupo, sobre la unión de claves. */
export function clasificar(P, M, R) {
  const claves = [...new Set([...P.keys(), ...M.keys(), ...R.keys()])].sort()
  return claves.map(clave => {
    const p = valorDe(P, clave)
    const m = valorDe(M, clave)
    const r = valorDe(R, clave)
    return { clave, p, m, r, clase: clasificarGrupo(p, m, r) }
  })
}

// ── el diff de migraciones ──────────────────────────────────────────────────

/** La versión de `20260907001300_lo_que_sea.sql` es `20260907001300`. */
export function versionDe(nombre) {
  return String(nombre).split('_')[0]
}

/**
 * Qué le pasó a `supabase/migrations` entre la base y HEAD.
 *
 * `base` y `head` son mapas nombre → hash del blob. El hash es lo que separa
 * «una migración nueva» de «una migración histórica reescrita»: comparar sólo
 * los nombres dejaría pasar un cambio silencioso dentro de un archivo que ya
 * existía, que es la forma más limpia de reescribir la historia sin que se note.
 */
export function diffMigraciones(base, head) {
  const nb = [...base.keys()]
  const nh = [...head.keys()]
  const agregadas = nh.filter(n => !base.has(n)).sort()
  const eliminadas = nb.filter(n => !head.has(n)).sort()
  const modificadas = nh.filter(n => base.has(n) && base.get(n) !== head.get(n)).sort()

  // Append-only de verdad: toda migración nueva va DESPUÉS de la última que ya
  // existía. Una versión intercalada se aplicaría antes que migraciones ya
  // desplegadas en producción, y entonces el orden del repositorio deja de ser
  // el orden en que producción llegó a su estado.
  const maxBase = nb.length > 0 ? nb.map(versionDe).sort().at(-1) : ''
  const desordenadas = agregadas.filter(n => versionDe(n) <= maxBase).sort()

  return {
    agregadas,
    eliminadas,
    modificadas,
    desordenadas,
    maxBase,
    apendiceLimpio: eliminadas.length === 0 && modificadas.length === 0 && desordenadas.length === 0,
  }
}

// ── el veredicto ────────────────────────────────────────────────────────────

/**
 * Junta todo: clasificación por grupo, estado del diff de migraciones y
 * baseline, y decide si la corrida pasa.
 *
 * REGLA DE CIERRE. `ok` es una conjunción de negativos: se pasa cuando NADA de
 * lo que rompe está presente. Un caso que no encaje en ninguna categoría no
 * puede colarse por el medio, porque no hay ninguna rama que devuelva «pasa»
 * por defecto.
 */
export function evaluarTresVias({ P, M, R, baseline, migraciones }) {
  const grupos = clasificar(P, M, R)
  const declaradas = clavesDeBaseline(baseline)

  const cambiados = grupos.filter(g => g.clase !== SIN_CAMBIO)
  const planificados = grupos.filter(g => g.clase === PLANIFICADO)
  const resueltos = grupos.filter(g => g.clase === RESUELTO)
  const ambiguos = grupos.filter(g => g.clase === AMBIGUO)

  // ── 1. Los objetos que el PR NO toca: trinquete estricto contra P ────────
  //
  // Se delega en `evaluar`, el mismo que usaba la comparación de dos vías. No
  // es sólo evitar duplicación: si «drift nuevo» y «drift agravado» se
  // decidieran en dos lugares, podrían separarse, y el auditor diría cosas
  // distintas según por dónde entró el grupo.
  const conDrift = grupos
    .filter(g => g.clase === SIN_CAMBIO && g.p !== g.r)
    .map(g => ({ clave: g.clave, produccion: g.p, repo: g.r }))
  const { nuevo, agravado, esperado } = evaluar(conDrift, baseline)

  // ── 2. La poda: una entrada de baseline sin drift que la sostenga ────────
  //
  // Se mide sobre P vs R, que es lo que el repositorio afirma hoy. Un grupo
  // RESUELTO llega aquí con p === r, así que la entrada tiene que irse en este
  // mismo PR — eso es «permitir que la baseline se reduzca»: el trinquete deja
  // sacar entradas, y esta regla obliga a sacar las que ya no describen nada.
  const podaPendiente = [...declaradas]
    .filter(c => valorDe(P, c) === valorDe(R, c))
    .sort()

  // ── 3. Un cambio de catálogo exige una migración nueva ───────────────────
  //
  // R se construye APLICANDO los archivos de migración, así que si el catálogo
  // se movió sin que se agregara ninguno, lo que cambió fue el andamiaje
  // (bootstrap.sql, fingerprint.sql) o una migración histórica. Ninguna de las
  // dos cosas llega nunca a producción: el repositorio estaría describiendo un
  // esquema que nadie va a desplegar.
  const hayMigracionNueva = (migraciones?.agregadas?.length ?? 0) > 0
  const cambioSinMigracion = cambiados.length > 0 && !hayMigracionNueva ? cambiados : []

  // Un cambio planificado sólo vale si viene de una migración append-only.
  const planificadoSinRespaldo =
    planificados.length > 0 && !(hayMigracionNueva && migraciones?.apendiceLimpio) ? planificados : []

  const ok =
    nuevo.length === 0 &&
    agravado.length === 0 &&
    podaPendiente.length === 0 &&
    ambiguos.length === 0 &&
    cambioSinMigracion.length === 0 &&
    planificadoSinRespaldo.length === 0 &&
    (migraciones?.eliminadas?.length ?? 0) === 0 &&
    (migraciones?.modificadas?.length ?? 0) === 0 &&
    (migraciones?.desordenadas?.length ?? 0) === 0

  return {
    grupos, planificados, resueltos, ambiguos,
    nuevo, agravado, esperado, podaPendiente,
    cambioSinMigracion, planificadoSinRespaldo,
    migraciones,
    ok,
  }
}

/** Informe legible del veredicto. Devuelve las líneas, para poder probarlo. */
export function informe(v) {
  const l = []
  const m = v.migraciones ?? {}

  if ((m.agregadas?.length ?? 0) > 0) {
    l.push(`\n  migraciones nuevas en el PR: ${m.agregadas.length}`)
    for (const n of m.agregadas) l.push(`    + ${n}`)
  }

  if (v.esperado.length > 0) {
    l.push(`\n  ${v.esperado.length} diferencia(s) declaradas en la baseline (no rompen).`)
  }

  if (v.planificados.length > 0) {
    l.push(`\n⏳ CAMBIO PLANIFICADO — ${v.planificados.length} grupo(s) que este PR cambia y producción`)
    l.push('   todavía no tiene. NO son drift y NO se agregan a drift-conocido.json:')
    for (const g of v.planificados) {
      l.push(`    ${g.clave}`)
      l.push(`        producción = base = ${g.p}`)
      l.push(`        PR                = ${g.r}`)
    }
    l.push('\n   Se cierran solos cuando la migración se aplique a producción y se refresque')
    l.push('   huella-produccion.json con evidencia real, en un PR posterior.')
  }

  if (v.resueltos.length > 0) {
    l.push(`\n✓ DRIFT RESUELTO — ${v.resueltos.length} grupo(s) donde el PR alcanza a producción:`)
    for (const g of v.resueltos) l.push(`    ${g.clave}\n        base = ${g.m}  →  PR = producción = ${g.r}`)
  }

  if (v.ambiguos.length > 0) {
    l.push(`\n✗ CAMBIO AMBIGUO — ${v.ambiguos.length} grupo(s) donde producción, la base y el PR`)
    l.push('   dicen tres cosas distintas. No se puede decidir si el PR arregla o empeora:')
    for (const g of v.ambiguos) {
      l.push(`    ${g.clave}`)
      l.push(`        producción = ${g.p}`)
      l.push(`        base       = ${g.m}`)
      l.push(`        PR         = ${g.r}`)
    }
    l.push('\n   Se cierra en falso a propósito. Resolvelo contra producción primero.')
  }

  if (v.cambioSinMigracion.length > 0) {
    l.push(`\n✗ CATÁLOGO CAMBIADO SIN MIGRACIÓN NUEVA — ${v.cambioSinMigracion.length} grupo(s):`)
    for (const g of v.cambioSinMigracion) l.push(`    ${g.clave}  (base=${g.m}  PR=${g.r})`)
    l.push('\n   El esquema reconstruido se movió pero el PR no agrega ninguna migración.')
    l.push('   Eso es un cambio que nunca va a llegar a producción: el repositorio')
    l.push('   describiría un esquema que nadie despliega.')
  }

  if (v.planificadoSinRespaldo.length > 0) {
    l.push('\n✗ CAMBIO PLANIFICADO SIN MIGRACIÓN APPEND-ONLY QUE LO RESPALDE.')
    l.push('   Un cambio de esquema sólo se acepta si viene de una migración nueva')
    l.push('   posterior a todas las existentes, sin tocar ninguna anterior.')
  }

  if ((m.eliminadas?.length ?? 0) > 0) {
    l.push(`\n✗ MIGRACIONES ELIMINADAS — ${m.eliminadas.length}:`)
    for (const n of m.eliminadas) l.push(`    − ${n}`)
    l.push('\n   El historial es append-only: producción ya las aplicó.')
  }
  if ((m.modificadas?.length ?? 0) > 0) {
    l.push(`\n✗ MIGRACIONES HISTÓRICAS MODIFICADAS — ${m.modificadas.length}:`)
    for (const n of m.modificadas) l.push(`    ~ ${n}`)
    l.push('\n   Producción ya aplicó ese archivo: reescribirlo cambia lo que el repositorio')
    l.push('   dice que pasó, no lo que pasó. Corregí con una migración nueva.')
  }
  if ((m.desordenadas?.length ?? 0) > 0) {
    l.push(`\n✗ MIGRACIONES INTERCALADAS — ${m.desordenadas.length} con versión anterior a ${m.maxBase}:`)
    for (const n of m.desordenadas) l.push(`    ! ${n}`)
    l.push('\n   Se aplicarían antes que migraciones que producción ya tiene.')
  }

  if (v.agravado.length > 0) {
    l.push(`\n✗ DRIFT AGRAVADO — ${v.agravado.length} grupo(s) conocidos cuyas huellas cambiaron`)
    l.push('   sin que este PR toque el objeto:')
    for (const g of v.agravado) {
      l.push(`    ${g.clave}`)
      l.push(`        esperado: producción=${g.esperadoProduccion}  repo=${g.esperadoRepo}`)
      l.push(`        ahora   : producción=${g.p}  repo=${g.r}`)
    }
  }
  if (v.podaPendiente.length > 0) {
    l.push(`\n✗ ${v.podaPendiente.length} entrada(s) de la baseline YA NO corresponden a drift:`)
    for (const c of v.podaPendiente) l.push(`    ${c}`)
    l.push('\n   Retiralas de drift-conocido.json en este mismo PR: la baseline puede encoger.')
  }
  if (v.nuevo.length > 0) {
    l.push(`\n✗ DRIFT NUEVO — ${v.nuevo.length} grupo(s) que este PR no toca y la baseline no declara:`)
    for (const g of v.nuevo) l.push(`    ${g.clave}\n        producción=${g.p}  repo=${g.r}`)
    l.push('\n   Producción y el repositorio dejaron de describir lo mismo en un objeto que')
    l.push('   este PR ni siquiera modifica. Se cierra con una migración forward-only.')
  }

  if (v.ok) {
    l.push(v.planificados.length > 0
      ? '\n✓ Sin drift no autorizado. Los cambios de esquema vienen de migraciones append-only.'
      : '\n✓ Sin drift nuevo. La baseline describe exactamente las diferencias que hay.')
  }
  return l
}
