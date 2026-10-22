#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Verificación EJECUTABLE de 20261104000150: la policy legada
// `str_cliente_portal` de reservas_str deja de existir.
//
// POR QUÉ EXISTE
// La migración no cambia datos: cambia QUIÉN PUEDE HACER QUÉ. Eso se comprueba
// intentando las operaciones con el residente, no contando policies.
//
// LA FORMA: primero el fallo, después el arreglo, sobre la cadena REAL.
//   1 · cadena   bootstrap + todas las migraciones anteriores, en una base
//                vacía, y el padrón de rls_acciones (dos empresas, una unidad
//                cada una, el residente dueño de la unidad de A con una renta
//                corta aprobada, el admin de A).
//   2 · antes    el agujero EXISTE: el residente crea una reserva en la unidad
//                de OTRA empresa. Si no se reproduce, la prueba no probaría
//                nada y falla. Mover la suya allí ya está cerrado (la fila
//                nueva de un UPDATE pasa por las policies de SELECT) y se
//                comprueba en las dos fases.
//   3 · migra    se aplica la migración.
//   4 · después  el residente ya no escribe fuera de su unidad, y sigue
//                viendo, creando, editando y borrando las reservas de SU unidad
//                (cerrar de más también es un fallo). El admin, igual.
//   5 · otra vez re-aplicarla deja las mismas cuatro policies.
//
// Cada intento se DESHACE (ra.intento): las filas del padrón no cambian.
//
// USO:  node supabase/tests/reservas_str_portal/run.mjs
// Requiere binarios de PostgreSQL. No toca ningún proyecto remoto.
// ════════════════════════════════════════════════════════════════════════════
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DIR_MIGRACIONES } from '../../../scripts/schema-drift/reconstruir.mjs'
import { baseAntesDe } from '../../../scripts/rls-acciones/generar.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RLA = join(AQUI, '..', 'rls_acciones')
const VERSION = '20261104000150'
const MIG = join(DIR_MIGRACIONES, `${VERSION}_reservas_str_retirar_policy_legada_portal.sql`)
const trabajo = mkdtempSync(join(tmpdir(), 'rsp-'))

let fallo = false
const ok = m => console.log(`  ✓ ${m}`)
const mal = m => { console.log(`  ✗ ${m}`); fallo = true }

console.log(`── 1/5 · cadena anterior a ${VERSION} y padrón`)
const db = baseAntesDe(VERSION)
const psql = args => db.psql(['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres', ...args],
  { stdio: 'pipe', env: { ...db.entorno, PGOPTIONS: '-c client_min_messages=warning' } })
const aplicar = archivo => psql(['-f', archivo])
const leer = sql => psql(['-tA', '-F', '\t', '-c', sql]).trim().split('\n').filter(Boolean).map(l => l.split('\t'))

// Los intentos: [nombre, persona, sentencia]. `R1` es la reserva del residente
// en su unidad; `UB`/`B1`/`B` son la unidad, el condominio y la empresa ajenos.
const alta = (empresa, proyecto, unidad) =>
  `INSERT INTO public.reservas_str (company_id, project_id, unidad_id, huesped_nombre, fecha_entrada, fecha_salida)
   VALUES (ra.id('${empresa}'), ra.id('${proyecto}'), ra.id('${unidad}'), 'rsp', current_date, current_date + 1)`
const INTENTOS = [
  ['ajena: crear en la unidad de otra empresa', 'RES', alta('B', 'B1', 'UB')],
  ['cerrada: mover la suya a otra empresa', 'RES', `UPDATE public.reservas_str SET company_id = ra.id('B'), project_id = ra.id('B1'), unidad_id = ra.id('UB') WHERE id = ra.id('R1')`],
  ['propia: ver', 'RES', `SELECT 1 FROM public.reservas_str WHERE id = ra.id('R1')`],
  ['propia: crear', 'RES', alta('A', 'A1', 'UA')],
  ['propia: editar', 'RES', `UPDATE public.reservas_str SET notas = 'rsp' WHERE id = ra.id('R1')`],
  ['propia: borrar', 'RES', `DELETE FROM public.reservas_str WHERE id = ra.id('R1')`],
  ['admin: crear', 'ADM', alta('A', 'A1', 'UA')],
  ['admin: borrar', 'ADM', `DELETE FROM public.reservas_str WHERE id = ra.id('R1')`],
]
const AJENOS = new Set(INTENTOS.filter(([n]) => n.startsWith('ajena')).map(([n]) => n))
const CERRADOS = new Set(INTENTOS.filter(([n]) => n.startsWith('cerrada')).map(([n]) => n))
/** Lo esperado: el agujero pasa antes y no después; lo cerrado, nunca; lo legítimo, siempre. */
const espera = (nombre, fase) => (CERRADOS.has(nombre) || (AJENOS.has(nombre) && fase === 'despues') ? 'rls' : 'ok')

const lit = s => `'${s.replace(/'/g, "''")}'`
const intentar = () => {
  const l = ['\\set ON_ERROR_STOP on', 'TRUNCATE ra.resultados;']
  for (const [nombre, persona, sql] of INTENTOS) {
    l.push(`SELECT ra.como('${persona}');`, 'SET ROLE authenticated;',
      `INSERT INTO ra.resultados SELECT '${persona}', 'reservas_str', ${lit(nombre)}, ra.intento(${lit(sql)});`,
      'RESET ROLE;')
  }
  writeFileSync(join(trabajo, 'intentos.sql'), l.join('\n') + '\n')
  aplicar(join(trabajo, 'intentos.sql'))
  return new Map(leer('SELECT cmd, resultado FROM ra.resultados').map(([n, r]) => [n, r]))
}

try {
  aplicar(join(RLA, 'fabricar.sql'))
  aplicar(join(RLA, 'padron.sql'))
  // La renta corta aprobada del residente en SU unidad, y una reserva suya.
  writeFileSync(join(trabajo, 'fixture.sql'), `\\set ON_ERROR_STOP on
INSERT INTO ra.ids VALUES ('R1', 'c7000000-0000-0000-0000-0000000000a1');
INSERT INTO public.solicitud_renta_unidad (company_id, project_id, unidad_id, cliente_id, tipo_renta, tipo_aprobado, estado)
  VALUES (ra.id('A'), ra.id('A1'), ra.id('UA'), ra.id('CLI'), 'str', 'str', 'aprobada');
INSERT INTO public.reservas_str (id, company_id, project_id, unidad_id, huesped_nombre, fecha_entrada, fecha_salida)
  VALUES (ra.id('R1'), ra.id('A'), ra.id('A1'), ra.id('UA'), 'rsp', current_date, current_date + 1);
`)
  aplicar(join(trabajo, 'fixture.sql'))
  ok('cadena, padrón y la renta corta aprobada del residente en su unidad')

  console.log('── 2/5 · antes: el agujero se reproduce')
  const antes = intentar()
  for (const [nombre] of INTENTOS) {
    const r = antes.get(nombre)
    if (r === espera(nombre, 'antes')) ok(`${nombre}: ${r === 'ok' ? 'pasa' : 'rechazado'}${AJENOS.has(nombre) ? ' (el agujero)' : ''}`)
    else mal(`${nombre}: ${r} (${AJENOS.has(nombre) ? 'el agujero no se reprodujo: la prueba no probaría nada' : `se esperaba ${espera(nombre, 'antes')}`})`)
  }
  if (fallo) throw new Error('control previo')

  console.log(`── 3/5 · la migración`)
  aplicar(MIG)
  ok(`${VERSION} aplicada`)

  console.log('── 4/5 · después: fuera de su unidad, nada; en su unidad, todo')
  const despues = intentar()
  for (const [nombre] of INTENTOS) {
    const r = despues.get(nombre)
    const quiere = espera(nombre, 'despues')
    if (r === quiere) ok(`${nombre}: ${r === 'ok' ? 'pasa' : 'rechazado'}`)
    else mal(`${nombre}: ${r}, y debía ${quiere === 'ok' ? 'pasar' : 'ser rechazado'}`)
  }

  console.log('── 5/5 · re-aplicarla no cambia nada')
  aplicar(MIG)
  const quedan = leer(`SELECT policyname, cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = 'reservas_str' ORDER BY 1`)
  const esperadas = ['reservas_str_delete', 'reservas_str_insert', 'reservas_str_select', 'reservas_str_update']
  if (quedan.map(([n]) => n).join(' ') === esperadas.join(' ') && quedan.every(([, c]) => c !== 'ALL')) ok('quedan las cuatro por comando, ninguna FOR ALL')
  else mal(`quedan: ${quedan.map(r => r.join(' ')).join(', ')}`)
} catch (e) {
  if (!fallo) { console.log(`  ✗ ${e.message}`); fallo = true }
} finally {
  db.destruir()
  rmSync(trabajo, { recursive: true, force: true })
}
if (fallo) { console.log('\n❌ reservas_str_portal: hay invariantes incumplidas'); process.exit(1) }
console.log('\n✅ reservas_str_portal: el agujero se reprodujo, la migración lo cierra y el residente')
console.log('   sigue gestionando las reservas de su unidad. Migración idempotente.')
