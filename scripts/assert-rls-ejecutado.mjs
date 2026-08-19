#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Verifica que el harness RLS EJECUTÓ las verificaciones — no que "salió verde".
// ════════════════════════════════════════════════════════════════════════════
// El problema que resuelve: `vitest run` sobre un archivo cuyo `describe` está
// bajo `describe.skipIf(...)` termina con exit code 0 y CERO tests ejecutados.
// Para GitHub Actions eso es un job verde indistinguible de una verificación
// real. Es el "verde sin ejecutar" que este PR elimina.
//
// QUÉ COMPRUEBA (todo sobre el reporte JSON de vitest)
//   1. Se ejecutaron pruebas: al menos una pasada.
//   2. Ninguna prueba ni suite falló.
//   3. NO hay skips ni todos INESPERADOS. Un `it.skip` que se cuele reduce la
//      cobertura en silencio, así que aquí es un fallo, no un aviso.
//   4. TODOS los escenarios obligatorios de `coverage.json` aparecen como
//      pruebas PASADAS. Sin esto, borrar un `describe` entero seguiría pasando
//      mientras el total superara el mínimo.
//   5. TODAS las RPC críticas aparecen NOMBRADAS en alguna prueba pasada, una a
//      una. Antes bastaba con que sobreviviera el bloque del dominio ("RPCs del
//      ERP financiero") para dar por cubiertas las seis RPC de ese dominio:
//      borrar `banco_ajuste_conciliacion` no se notaba. Ahora sí.
//   6. Se alcanza el piso mínimo de pruebas (red secundaria).
//
// POR QUÉ NO SE BUSCA UN MARCADOR DE OMISIÓN
// La versión anterior fallaba si el nombre de alguna prueba contenía "omitido".
// Eso era un fallo PERMANENTE: vitest incluye las pruebas skipped en el reporte,
// así que el bloque `describe.runIf(!ENABLED)` con su `it.skip('omitido — …')`
// aparecía SIEMPRE, también cuando el harness sí había corrido con credenciales.
// El job no podía ponerse verde ni con el sandbox montado. El bloque alternativo
// se eliminó del harness y la señal de omisión la da el preflight, que es quien
// tiene la información (`scripts/rls-preflight.mjs`).
//
// USO
//   node scripts/assert-rls-ejecutado.mjs <ruta-al-reporte.json> [minimo]
// ════════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const AQUI = dirname(fileURLToPath(import.meta.url))

/** Manifiesto compartido con el harness y el seed. */
export function cargarCobertura(ruta = join(AQUI, '..', 'src', 'test', 'rls', 'coverage.json')) {
  return JSON.parse(readFileSync(ruta, 'utf8'))
}

/** Aplana el reporte de vitest a `{ status, nombre }`. */
export function pruebasDelReporte(reporte) {
  return (reporte?.testResults ?? []).flatMap((suite) =>
    (suite?.assertionResults ?? []).map((a) => ({
      status: a?.status ?? 'unknown',
      nombre: a?.fullName ?? a?.title ?? '',
    })),
  )
}

/**
 * Evalúa un reporte. Devuelve `{ ok, errores, resumen }` — pura, sin E/S ni
 * process.exit, para poder probarla.
 */
export function evaluarReporte(reporte, cobertura, { minimo } = {}) {
  const errores = []
  const pruebas = pruebasDelReporte(reporte)

  const pasadas = pruebas.filter((p) => p.status === 'passed')
  const fallidas = pruebas.filter((p) => p.status === 'failed')
  // vitest marca los `it.skip` como 'skipped' y los `it.todo` como 'todo';
  // 'pending' aparece en algunas versiones para lo mismo.
  const omitidas = pruebas.filter((p) => ['skipped', 'pending', 'todo'].includes(p.status))

  const total = reporte?.numTotalTests ?? pruebas.length
  const suitesFallidas = reporte?.numFailedTestSuites ?? 0
  const pisoMinimo = minimo ?? cobertura?.minimoPruebas ?? 1

  if (pasadas.length === 0) {
    errores.push(
      `no se ejecutó NINGUNA prueba (pasadas = 0, total = ${total}). ` +
      'El harness se saltó: los secretos RLS_* no llegaron al job.',
    )
  }

  if (fallidas.length > 0 || suitesFallidas > 0) {
    const muestra = fallidas.slice(0, 3).map((p) => p.nombre).join(' · ')
    errores.push(
      `hay fallos: ${fallidas.length} prueba(s) y ${suitesFallidas} suite(s).` +
      (muestra ? ` Primeras: ${muestra}` : ''),
    )
  }

  // Skips inesperados: con el bloque alternativo eliminado, el harness no
  // declara ningún `it.skip`, así que cualquiera indica cobertura perdida.
  if (omitidas.length > 0) {
    const muestra = omitidas.slice(0, 3).map((p) => `${p.status}: ${p.nombre}`).join(' · ')
    errores.push(
      `hay ${omitidas.length} prueba(s) omitida(s) (skip/todo) que el harness no declara. ` +
      `Cobertura perdida en silencio. Primeras: ${muestra}`,
    )
  }

  // Escenarios obligatorios: se exige una prueba PASADA cuyo nombre los contenga.
  const escenarios = cobertura?.escenariosObligatorios ?? []
  const ausentes = escenarios.filter(
    (e) => !pasadas.some((p) => p.nombre.includes(e.patron)),
  )
  for (const e of ausentes) {
    errores.push(
      `falta el escenario obligatorio "${e.clave}" (ninguna prueba pasada contiene «${e.patron}»). ` +
      `Por qué importa: ${e.porQue}`,
    )
  }

  // RPC críticas, evidencia POR EVIDENCIA.
  //
  // Antes bastaba con que alguna prueba pasada CONTUVIERA el nombre de la RPC:
  //
  //     pasadas.some((p) => p.nombre.includes(r.nombre))
  //
  // Con eso, 23 pruebas de «anon NO puede ejecutar X» daban por cubiertas las 23
  // RPC —incluidas las declaradas como aislamiento por tenant, que anon no
  // ejercita en absoluto—. Verde falso, reproducido antes de cambiar nada.
  //
  // Ahora cada RPC declara qué vectores hay que acreditar y el harness marca sus
  // pruebas con un identificador estable, `[RLS:rpc:<nombre>:<garantia>:<vector>]`.
  // Una prueba de anon no puede acreditar una evidencia autenticada, y si alguien
  // borra la prueba autenticada dejando la de anon, el nombre de la RPC sigue
  // apareciendo pero la evidencia desaparece — y el job falla.
  const rpcs = cobertura?.rpcsObligatorias ?? []
  const evidenciasAusentes = []

  for (const r of rpcs) {
    const declaradas = Array.isArray(r.evidencias) ? r.evidencias : []

    if (declaradas.length === 0) {
      // Un manifiesto sin evidencias no es "todo vale": es una RPC sin contrato.
      errores.push(
        `la RPC obligatoria "${r.nombre}" no declara ninguna evidencia en coverage.json. ` +
        'Sin vectores declarados no hay nada que exigir, así que se trata como cobertura ausente.',
      )
      evidenciasAusentes.push(`${r.nombre}:(sin declarar)`)
      continue
    }

    for (const vector of declaradas) {
      const id = `[RLS:rpc:${r.nombre}:${r.garantia}:${vector}]`
      if (pasadas.some((p) => p.nombre.includes(id))) continue

      evidenciasAusentes.push(`${r.nombre}:${vector}`)
      errores.push(
        `falta la evidencia "${vector}" de la RPC "${r.nombre}" (garantía ${r.garantia}, ` +
        `dominio ${r.dominio}): ninguna prueba pasada lleva el marcador ${id}. ` +
        `Por qué importa: ${r.porQue}`,
      )
    }
  }

  const rpcsAusentes = rpcs.filter((r) =>
    evidenciasAusentes.some((e) => e.startsWith(`${r.nombre}:`)),
  )

  if (pasadas.length > 0 && pasadas.length < pisoMinimo) {
    errores.push(
      `sólo se ejecutaron ${pasadas.length} pruebas, por debajo del piso de ${pisoMinimo}. ` +
      'El harness parece recortado.',
    )
  }

  return {
    ok: errores.length === 0,
    errores,
    resumen: {
      pasadas: pasadas.length,
      fallidas: fallidas.length,
      omitidas: omitidas.length,
      total,
      suitesFallidas,
      escenariosExigidos: escenarios.length,
      escenariosAusentes: ausentes.map((e) => e.clave),
      rpcsExigidas: rpcs.length,
      rpcsAusentes: rpcsAusentes.map((r) => r.nombre),
      evidenciasExigidas: rpcs.reduce((n, r) => n + (r.evidencias?.length ?? 0), 0),
      evidenciasAusentes,
      pisoMinimo,
    },
  }
}

/** Línea de resumen para la UI de Actions. Nunca incluye valores de secretos. */
export function resumenMarkdown({ ok, errores, resumen }) {
  if (ok) {
    return [
      '### ✅ Harness RLS ejecutado (aislamiento multi-tenant verificado)',
      '',
      `- Pruebas pasadas: **${resumen.pasadas}** (total ${resumen.total}, fallos ${resumen.fallidas}, omitidas ${resumen.omitidas})`,
      `- Escenarios obligatorios presentes: **${resumen.escenariosExigidos}/${resumen.escenariosExigidos}**`,
      `- RPC críticas verificadas una a una: **${resumen.rpcsExigidas}/${resumen.rpcsExigidas}**`,
      `- Evidencias acreditadas (por RPC, garantía y vector): **${resumen.evidenciasExigidas}/${resumen.evidenciasExigidas}**`,
      `- Piso mínimo exigido: ${resumen.pisoMinimo}`,
      '',
      'Las tablas con cobertura real vs. estructural están declaradas en',
      '`src/test/rls/coverage.json` y las verifica `scripts/seed-rls-sandbox.mjs`.',
      '',
    ].join('\n')
  }
  return [
    '### ❌ El harness RLS no demostró haber verificado el aislamiento',
    '',
    ...errores.map((e) => `- ${e}`),
    '',
    `Pasadas ${resumen.pasadas} · fallidas ${resumen.fallidas} · omitidas ${resumen.omitidas} · total ${resumen.total}`,
    '',
    'Ver `docs/ACTIVAR_HARNESS_RLS.md`.',
    '',
  ].join('\n')
}

// ── CLI ─────────────────────────────────────────────────────────────────────
async function main(argv, env) {
  const [rutaReporte, minimoArg] = argv
  if (!rutaReporte) {
    console.error('Uso: node scripts/assert-rls-ejecutado.mjs <reporte.json> [minimo]')
    return 2
  }

  let reporte
  try {
    reporte = JSON.parse(readFileSync(rutaReporte, 'utf8'))
  } catch (e) {
    console.error(`❌ No se pudo leer el reporte de vitest en ${rutaReporte}: ${e.message}`)
    console.error('   Sin reporte no hay forma de demostrar que el harness corrió.')
    return 1
  }

  const cobertura = cargarCobertura()
  const veredicto = evaluarReporte(reporte, cobertura, {
    minimo: minimoArg === undefined ? undefined : Number(minimoArg),
  })

  if (veredicto.ok) {
    console.log(
      `✅ Harness RLS ejecutado de verdad: ${veredicto.resumen.pasadas} pruebas pasadas, ` +
      `0 fallos, 0 omitidas, ${veredicto.resumen.escenariosExigidos} escenarios y ` +
      `${veredicto.resumen.rpcsExigidas} RPC obligatorias presentes.`,
    )
  } else {
    console.error('\n❌ El harness RLS NO demostró haber verificado el aislamiento:\n')
    for (const e of veredicto.errores) console.error(`   • ${e}`)
    console.error('\n   Ver docs/ACTIVAR_HARNESS_RLS.md.\n')
  }

  if (env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs')
    appendFileSync(env.GITHUB_STEP_SUMMARY, resumenMarkdown(veredicto))
  }

  return veredicto.ok ? 0 : 1
}

// Sólo se ejecuta como script; importarlo desde las pruebas no dispara nada.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main(process.argv.slice(2), process.env))
}
