#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Verifica que el harness RLS EJECUTÓ pruebas reales — no que "salió verde".
// ════════════════════════════════════════════════════════════════════════════
// El problema que resuelve: `vitest run` sobre un archivo cuyo `describe` está
// bajo `describe.skipIf(!ENABLED)` termina con exit code 0 y CERO tests
// ejecutados. Para GitHub Actions eso es un job verde indistinguible de una
// verificación real. Es exactamente el "verde sin ejecutar" que este PR elimina.
//
// Comprueba, sobre el reporte JSON de vitest:
//   1. Se ejecutaron pruebas: numPassedTests > 0.
//   2. Ninguna falló y ninguna suite falló.
//   3. NO aparece el marcador de omisión ("omitido") — su presencia significa
//      que corrió la rama `describe.runIf(!ENABLED)`, es decir, que el harness
//      se saltó por falta de credenciales.
//   4. Se alcanzó el piso mínimo de aserciones esperado, para que un archivo
//      recortado a dos tests no pase por "harness completo".
//
// USO
//   node scripts/assert-rls-ejecutado.mjs <ruta-al-reporte.json> [minimo]
// ════════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs'

const [, , rutaReporte, minimoArg] = process.argv

// Piso mínimo de aserciones. El harness declara HOY 127 pruebas cuando está
// habilitado (128 incluyendo el marcador de omisión, que sólo existe en la rama
// sin credenciales). 100 deja holgura para que evolucione sin volverse un
// estorbo, pero corta en seco un archivo vaciado o un `skipIf` que se cuele y
// deje corriendo sólo un puñado.
const MINIMO = Number(minimoArg ?? 100)

// Marcador del bloque `describe.runIf(!ENABLED)` del harness: si aparece, el
// harness NO verificó nada.
const MARCADOR_OMISION = 'omitido'

if (!rutaReporte) {
  console.error('Uso: node scripts/assert-rls-ejecutado.mjs <reporte.json> [minimo]')
  process.exit(2)
}

let reporte
try {
  reporte = JSON.parse(readFileSync(rutaReporte, 'utf8'))
} catch (e) {
  console.error(`❌ No se pudo leer el reporte de vitest en ${rutaReporte}: ${e.message}`)
  console.error('   Sin reporte no hay forma de demostrar que el harness corrió.')
  process.exit(1)
}

const total = reporte.numTotalTests ?? 0
const pasadas = reporte.numPassedTests ?? 0
const fallidas = reporte.numFailedTests ?? 0
const suitesFallidas = reporte.numFailedTestSuites ?? 0

const nombres = (reporte.testResults ?? []).flatMap((s) =>
  (s.assertionResults ?? []).map((a) => `${a.fullName ?? a.title ?? ''}`),
)
const omitidas = nombres.filter((n) => n.toLowerCase().includes(MARCADOR_OMISION))

const errores = []

if (pasadas === 0) {
  errores.push(
    `no se ejecutó NINGUNA prueba (numPassedTests = 0, numTotalTests = ${total}). ` +
    'El harness se saltó: los secretos RLS_* no llegaron al job.',
  )
}

if (omitidas.length > 0) {
  errores.push(
    `el reporte contiene el marcador de omisión "${MARCADOR_OMISION}" en ${omitidas.length} prueba(s): ` +
    omitidas.slice(0, 3).join(' · ') +
    '. Eso significa que corrió la rama sin credenciales, no la verificación real.',
  )
}

if (fallidas > 0 || suitesFallidas > 0) {
  errores.push(`hay fallos: ${fallidas} prueba(s) y ${suitesFallidas} suite(s).`)
}

if (pasadas > 0 && pasadas < MINIMO) {
  errores.push(
    `sólo se ejecutaron ${pasadas} pruebas, por debajo del piso de ${MINIMO}. ` +
    'El harness parece recortado o parcialmente saltado.',
  )
}

if (errores.length > 0) {
  console.error('\n❌ El harness RLS NO demostró haber verificado el aislamiento:\n')
  for (const e of errores) console.error(`   • ${e}`)
  console.error('\n   Ver docs/ACTIVAR_HARNESS_RLS.md.\n')
  process.exit(1)
}

console.log(`✅ Harness RLS ejecutado de verdad: ${pasadas} pruebas pasadas, 0 fallos, sin marcador de omisión.`)

// Resumen para la UI de Actions. No se imprime ningún valor de secreto: sólo
// recuentos y nombres de prueba (que son literales del repo).
const resumen = process.env.GITHUB_STEP_SUMMARY
if (resumen) {
  const { appendFileSync } = await import('node:fs')
  appendFileSync(
    resumen,
    [
      '### ✅ Harness RLS ejecutado (aislamiento multi-tenant verificado)',
      '',
      `- Pruebas ejecutadas: **${pasadas}** (total ${total}, fallos ${fallidas})`,
      `- Marcador de omisión "${MARCADOR_OMISION}": **ausente**`,
      `- Piso mínimo exigido: ${MINIMO}`,
      '',
      'Las tablas con cobertura real vs. estructural están declaradas en',
      '`src/test/rls/coverage.json` y las verifica `scripts/seed-rls-sandbox.mjs`.',
      '',
    ].join('\n'),
  )
}
