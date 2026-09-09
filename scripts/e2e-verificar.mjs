#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Verificador POST-EJECUCIÓN del job "E2E (caminos de dinero/auth)".
// ════════════════════════════════════════════════════════════════════════════
// Playwright ya hizo su parte: si una prueba FALLÓ, el job está rojo. Lo que
// Playwright no detecta es la NO-ejecución: una suite donde todo quedó skipped
// sale con exit 0, y "0 ejecutadas" se contabilizaría como cobertura. Este
// script lee el reporte JSON (playwright-results.json) y falla el job si la
// suite no corrió DE VERDAD:
//
//   · cero pruebas descubiertas                             → rojo
//   · cero pruebas ejecutadas (todas skipped)               → rojo
//   · un spec OBLIGATORIO sin ninguna prueba ejecutada      → rojo, nombrándolo
//     y citando las razones de skip que dejó (accionables: "sembrar X")
//   · CUALQUIER skip                                        → rojo. Ya no hay
//     specs condicionales: la mecánica de "omisión declarada" sigue existiendo
//     (SPECS_CONDICIONALES, hoy vacía) pero no la usa nadie, así que cualquier
//     skip es INESPERADO — un test individual de un spec obligatorio, o un
//     archivo fuera de las listas—, aunque el resto del archivo haya corrido
//
// EL CRITERIO DEL VERDE, en tres condiciones (las mismas que documentan el PR
// y e2e/README.md):
//   1. 0 fallos — eso lo reporta Playwright;
//   2. 0 skips, punto. Mientras hubo condicionales el criterio admitía uno
//      "declarado"; hoy el resultado esperado es 25 de 25;
//   3. todos los specs obligatorios con al menos una prueba ejecutada.
//
// El mismo criterio que el paso "Verificar que el harness ejecutó los
// escenarios obligatorios" del job RLS: el verde tiene que significar
// "verificado", no "no se opuso".
//
// Probado en scripts/__tests__/e2e-verificar.test.mjs con reportes sintéticos
// y con mutaciones (quitar un spec de la lista, vaciar el reporte).
// ════════════════════════════════════════════════════════════════════════════

import { appendFileSync, readFileSync } from 'node:fs'

/**
 * LOS NUEVE specs — todos — cuyo gating depende sólo de las variables
 * obligatorias: si el preflight pasó, cada uno tiene que ejecutar al menos una
 * prueba. Un spec de esta lista completamente skipped significa que el
 * despliegue de pruebas no está sembrado como debe (el skip runtime dice qué
 * falta) — y eso es un fallo del entorno que hay que ver, no tragarse.
 *
 * `invitation-accept` y `fiscal-timbrar` entraron aquí al dejar de ser
 * condicionales: fabrican su propia precondición dentro de la prueba en vez de
 * esperar a que alguien la prepare. Ver SPECS_CONDICIONALES, abajo.
 */
export const SPECS_OBLIGATORIOS = [
  'auth-login.e2e.ts',
  'unauthorized-access.e2e.ts',
  'role-restricted-access.e2e.ts',
  'agua-lectura-cobro.e2e.ts',
  'agua-lectura-validaciones.e2e.ts',
  'condominios-cuota.e2e.ts',
  'contabilidad-ledger.e2e.ts',
  'invitation-accept.e2e.ts',
  'fiscal-timbrar.e2e.ts',
]

/**
 * NO QUEDA NINGUNO. La lista sobrevive vacía porque el mecanismo —«omisión
 * declarada»— sigue siendo parte del contrato de este verificador, y porque
 * volver a añadir una entrada aquí tiene que ser una decisión deliberada y
 * revisable, no el efecto colateral de que alguien no supiera preparar un dato.
 *
 * Una omisión declarada seguía siendo una omisión: el spec no corría, y el
 * resumen del job lo decía en un `notice` que nadie leía como lo que era —una
 * parte del producto sin probar—. Hoy el resultado esperado de la suite es
 * 25 de 25, sin ninguna.
 */
export const SPECS_CONDICIONALES = []

/**
 * Reduce el reporte JSON de Playwright a conteos por archivo.
 *
 * @returns {Map<string, {total: number, ejecutadas: number, skipped: number,
 *                        razonesSkip: string[]}>}
 */
export function resumir(reporte) {
  const porArchivo = new Map()
  const cuenta = (archivo) => {
    if (!porArchivo.has(archivo)) {
      porArchivo.set(archivo, { total: 0, ejecutadas: 0, skipped: 0, razonesSkip: [] })
    }
    return porArchivo.get(archivo)
  }

  const caminar = (suite) => {
    for (const spec of suite.specs ?? []) {
      const c = cuenta(spec.file ?? suite.file ?? '(desconocido)')
      for (const test of spec.tests ?? []) {
        c.total += 1
        if (test.status === 'skipped') {
          c.skipped += 1
          for (const a of test.annotations ?? []) {
            if ((a.type === 'skip' || a.type === 'fixme') && a.description) {
              c.razonesSkip.push(a.description)
            }
          }
        } else {
          c.ejecutadas += 1
        }
      }
    }
    for (const hija of suite.suites ?? []) caminar(hija)
  }

  for (const suite of reporte?.suites ?? []) caminar(suite)
  return porArchivo
}

const unicas = (xs) => [...new Set(xs)]

/**
 * Aplica las reglas. Pura: el entorno entra por parámetro.
 *
 * @returns {{ fallos: string[], declarados: string[], totales: {total: number, ejecutadas: number} }}
 */
export function verificar(porArchivo, env = {}) {
  const fallos = []
  const declarados = []

  let total = 0
  let ejecutadas = 0
  for (const c of porArchivo.values()) {
    total += c.total
    ejecutadas += c.ejecutadas
  }

  if (total === 0) {
    fallos.push(
      'El reporte no contiene NINGUNA prueba. O Playwright no descubrió los specs ' +
        '(¿cambió testMatch o la extensión *.e2e.ts?) o el reporte JSON no se generó.',
    )
    return { fallos, declarados, totales: { total, ejecutadas } }
  }

  if (ejecutadas === 0) {
    fallos.push(
      `Las ${total} pruebas quedaron SKIPPED: la suite no verificó nada. ` +
        'Con el preflight en verde esto significa que el gating de los specs no vio ' +
        'las variables (¿se exportaron al paso de Playwright?) o que el despliegue ' +
        'de pruebas está sin sembrar.',
    )
    return { fallos, declarados, totales: { total, ejecutadas } }
  }

  for (const archivo of SPECS_OBLIGATORIOS) {
    const c = porArchivo.get(archivo)
    if (!c || c.total === 0) {
      fallos.push(`Spec obligatorio AUSENTE del reporte: ${archivo}. ¿Se borró o se renombró sin actualizar esta lista?`)
      continue
    }
    if (c.ejecutadas === 0) {
      const razones = unicas(c.razonesSkip)
      fallos.push(
        `Spec obligatorio sin ninguna prueba ejecutada: ${archivo} (${c.skipped} skipped). ` +
          (razones.length > 0
            ? `Razones que dejó: ${razones.join(' · ')}`
            : 'Sin razón de skip registrada.'),
      )
    }
  }

  for (const { archivo, variable } of SPECS_CONDICIONALES) {
    const c = porArchivo.get(archivo)
    const habilitado = Boolean(env[variable])
    if (!c || c.total === 0) {
      fallos.push(`Spec condicional AUSENTE del reporte: ${archivo}. ¿Se borró o se renombró sin actualizar esta lista?`)
      continue
    }
    if (habilitado && c.ejecutadas === 0) {
      const razones = unicas(c.razonesSkip)
      fallos.push(
        `${variable} está configurada pero ${archivo} no ejecutó ninguna prueba ` +
          `(${c.skipped} skipped${razones.length > 0 ? `: ${razones.join(' · ')}` : ''}). ` +
          'Una variable presente con su spec omitido es un falso verde parcial.',
      )
    }
    if (!habilitado && c.skipped > 0) {
      // Hoy inalcanzable: SPECS_CONDICIONALES está vacía. La rama se conserva
      // porque el mecanismo sigue siendo parte del contrato; si algún día vuelve
      // a haber un condicional, su omisión tiene que salir DECLARADA y no
      // silenciosa. El porqué lo aporta quien añada la entrada.
      declarados.push(`${archivo}: omitido DECLARADO — falta ${variable}`)
    }
  }

  // ── 0 skips INESPERADOS ────────────────────────────────────────────────────
  // Un skip individual dentro de un spec que sí ejecutó otras pruebas pasaba
  // desapercibido: el archivo cumplía "al menos una ejecutada" y el conteo se
  // leía como cobertura completa. El único skip admitido es el de un spec
  // condicional SIN su variable (declarado arriba); todo lo demás — un test
  // suelto de un spec obligatorio, un archivo fuera de las listas — es un skip
  // INESPERADO y pone el job en rojo con sus razones.
  const variablePorCondicional = new Map(SPECS_CONDICIONALES.map((c) => [c.archivo, c.variable]))
  for (const [archivo, c] of porArchivo) {
    if (c.skipped === 0) continue
    const variable = variablePorCondicional.get(archivo)
    if (variable && !env[variable]) continue // omisión condicional declarada
    // Un archivo con CERO ejecutadas de las listas ya tiene su fallo específico
    // arriba; no se duplica el mensaje.
    if (c.ejecutadas === 0 && (SPECS_OBLIGATORIOS.includes(archivo) || variable)) continue
    const razones = unicas(c.razonesSkip)
    fallos.push(
      `${c.skipped} skip(s) INESPERADO(s) en ${archivo} (${c.ejecutadas} ejecutadas). ` +
        (razones.length > 0 ? `Razones que dejó: ${razones.join(' · ')}. ` : 'Sin razón registrada. ') +
        'El único skip admitido es el de un spec condicional sin su variable.',
    )
  }

  return { fallos, declarados, totales: { total, ejecutadas } }
}

function resumen(titulo, cuerpo) {
  if (!process.env.GITHUB_STEP_SUMMARY) return
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${titulo}\n\n${cuerpo}\n`)
}

export function main(ruta = 'playwright-results.json', env = process.env) {
  let reporte
  try {
    reporte = JSON.parse(readFileSync(ruta, 'utf8'))
  } catch (e) {
    console.error(
      `::error title=E2E sin reporte::No se pudo leer ${ruta} (${e.message}). ` +
        'Sin reporte no hay forma de afirmar que la suite corrió: el job falla.',
    )
    return 1
  }

  const { fallos, declarados, totales } = verificar(resumir(reporte), env)

  for (const d of declarados) console.log(`::notice title=E2E omitido declarado::${d}`)

  if (fallos.length > 0) {
    for (const f of fallos) console.error(`::error title=E2E no verificó::${f}`)
    resumen('❌ La suite E2E no corrió entera', fallos.map((f) => `- ${f}`).join('\n'))
    return 1
  }

  const linea =
    `✅ Suite E2E ejecutada de verdad: ${totales.ejecutadas} de ${totales.total} pruebas corridas` +
    (declarados.length > 0 ? `; ${declarados.length} spec(s) en omisión declarada.` : ', sin omisiones.')
  console.log(linea)
  resumen('✅ E2E verificado', [linea, ...declarados.map((d) => `- ${d}`)].join('\n'))
  return 0
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv[2] ?? 'playwright-results.json'))
}
