#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Reporte de SÓLO LECTURA de las lecturas de agua históricas que están mal.
// ════════════════════════════════════════════════════════════════════════════
// La migración 20260910000200 cierra la puerta hacia adelante: desde ahora el
// consumo, la tarifa y el importe los decide el servidor. Lo que ya está
// escrito sigue estando escrito, y una parte está mal — cadenas rotas por el
// desempate al azar de `getUltimaLectura`, consumos que no son la resta de sus
// propias lecturas, importes en cero con consumo positivo, filas contabilizadas
// en el proyecto equivocado, recibos que nacieron 'pagado' sin pago.
//
// ESTE SCRIPT NO CORRIGE NADA, Y NO PUEDE. Llama a
// `agua_lecturas_inconsistencias()`, que es STABLE: la base rechazaría una
// escritura aunque el SQL la intentara. Cada una de esas filas puede ser un
// recibo emitido, cobrado y contabilizado; reescribirlas en lote movería dinero
// de clientes reales sin que nadie lo hubiera mirado. Lo que produce es el
// INVENTARIO, para decidir caso por caso, en su propio PR y con su propio
// rastro.
//
// USO
//   SUPABASE_URL="https://<ref>.supabase.co" \
//   SUPABASE_SERVICE_ROLE_KEY="<service_role>" \
//   node scripts/reporte-lecturas-inconsistencias.mjs [--project <uuid>] [--csv salida.csv]
//
// Sin `--project` recorre todos los proyectos que el rol pueda ver. Con
// service_role eso es TODO el padrón, así que el reporte es del operador de la
// plataforma; un usuario normal obtiene el suyo llamando a la misma RPC desde
// la aplicación, acotada a su empresa por la propia función.
// ════════════════════════════════════════════════════════════════════════════

import { writeFileSync } from 'node:fs'

const SEVERIDADES = ['alta', 'media', 'informativa']

/** Lee los argumentos de la línea de comandos sin dependencias. */
export function parsearArgs(argv) {
  const args = { projectId: null, csv: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') args.projectId = argv[++i] ?? null
    else if (argv[i] === '--csv') args.csv = argv[++i] ?? null
  }
  return args
}

/** Agrupa los hallazgos por tipo, conservando el orden por severidad. */
export function resumir(filas) {
  const porTipo = new Map()
  for (const f of filas) {
    const clave = `${f.severidad} ${f.hallazgo}`
    const acc = porTipo.get(clave) ?? {
      hallazgo: f.hallazgo, severidad: f.severidad, filas: 0, contadores: new Set(),
    }
    acc.filas++
    if (f.contador_id) acc.contadores.add(f.contador_id)
    porTipo.set(clave, acc)
  }
  return [...porTipo.values()]
    .map((a) => ({ ...a, contadores: a.contadores.size }))
    .sort((a, b) =>
      SEVERIDADES.indexOf(a.severidad) - SEVERIDADES.indexOf(b.severidad) || b.filas - a.filas)
}

/** El CSV que se le pasa a quien vaya a revisar fila por fila. */
export function aCsv(filas) {
  const cabecera = ['severidad', 'hallazgo', 'registro_id', 'project_id', 'contador_id',
                    'numero_serie', 'cliente_nombre', 'fecha', 'detalle']
  const escapar = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lineas = [cabecera.join(',')]
  for (const f of filas) {
    lineas.push(cabecera
      .map((c) => escapar(c === 'detalle' ? JSON.stringify(f.detalle) : f[c]))
      .join(','))
  }
  return lineas.join('\n')
}

async function main(env = process.env, argv = process.argv.slice(2), log = console.log, err = console.error) {
  const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    err('❌ faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY')
    return 1
  }
  const { projectId, csv } = parsearArgs(argv)

  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/agua_lecturas_inconsistencias`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_project_id: projectId }),
  })
  if (!res.ok) {
    err(`❌ la RPC respondió ${res.status}: ${await res.text()}`)
    return 1
  }
  const filas = await res.json()
  if (!Array.isArray(filas)) {
    err('❌ respuesta inesperada de la RPC')
    return 1
  }

  log('')
  log('Lecturas de agua con datos internamente contradictorios (sólo lectura)')
  log('══════════════════════════════════════════════════════════════════════')
  if (filas.length === 0) {
    log('  Ningún hallazgo. Nada que revisar.')
    return 0
  }
  for (const r of resumir(filas)) {
    log(`  ${r.severidad.padEnd(12)} ${r.hallazgo.padEnd(26)} ` +
        `${String(r.filas).padStart(6)} filas · ${r.contadores} contador(es)`)
  }
  log('')
  log(`  ${filas.length} hallazgo(s) en total.`)
  log('')
  log('  NADA DE ESTO SE HA MODIFICADO. Corregir una lectura ya emitida o cobrada')
  log('  mueve dinero de un cliente real: va en su propio PR, con revisión, y')
  log('  fila por fila. Este reporte es el inventario, no el arreglo.')

  if (csv) {
    writeFileSync(csv, aCsv(filas), 'utf8')
    log('')
    log(`  Detalle escrito en ${csv}`)
  }
  return 0
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main())
}

export { main }
