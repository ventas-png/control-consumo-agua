#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Generador de las migraciones «escribir exige la ACCIÓN del tab» (RLS).
//
// POR QUÉ EXISTE
// La pantalla decide cada escritura de un tab de condominios con su acción
// (canCreate / canEdit / canDelete → condominios.tab.<tab>.<acción>, con el
// fallback legado platform.condominios.view + .<acción>). Las policies que
// instaló `rbac_install_company_policies` aplican otra regla: INSERT y UPDATE
// con sólo la VISIBILIDAD del tab, DELETE sólo company_owner/admin. Son unas
// 400 policies en ~150 tablas, casi todas con una de tres formas, pero no
// todas: hay tablas hijas que autorizan por el padre (EXISTS), ramas del
// residente, claves de otro tab. Reescribirlas a mano es la manera segura de
// equivocarse en una de cuatrocientas.
//
// QUÉ HACE
// Toma cada policy de escritura VIGENTE (la base se reconstruye desde las
// migraciones del repositorio, hasta antes de la de la sección) y sustituye
// SÓLO sus átomos de permiso:
//
//   user_has_permission('condominios.tab.<tab>')       (con o sin SELECT)
//   current_user_role() = ANY (ARRAY['company_owner','admin'])   (ídem)
//
// por la acción que el mapa de la sección declara para ese comando:
//
//   ( SELECT (condominios_puede_actuar('<tab>', '<acción>') OR …) )
//
// Todo lo demás de la expresión —la empresa, el EXISTS al padre, la rama del
// residente, cualquier otra condición— queda IDÉNTICO. company_owner/admin
// siguen pasando: user_has_permission los trata como exentos.
//
// Una policy de escritura PERMISIVA sin ningún átomo (p. ej. un UPDATE que sólo
// mira la empresa) no pide permiso alguno: el mapa la declara en `agregar_en`
// con el fragmento literal junto al que va la acción —«(company_id =
// get_my_company_id())»— y el generador escribe «(fragmento AND acción)».
//
// Y se detiene en vez de adivinar: si una policy conserva un átomo que no supo
// sustituir, si la clave del átomo no es la del tab de la tabla (y el mapa no
// la reconoce en `otras_claves`), o si una policy FOR ALL tiene átomos.
//
// EL MAPA: supabase/rls-acciones/<sección>.json
//   { "_migracion": "<versión>_<nombre>.sql", "_titulo": "…", "_porque": ["…"],
//     "tablas": { "<tabla>": { "tab": "<tab>",
//                              "INSERT": ["<tab>.create", …],   // por defecto [tab.create]
//                              "UPDATE": ["<tab>.edit", …],     // por defecto [tab.edit]
//                              "DELETE": ["<tab>.delete", …],   // por defecto [tab.delete]
//                              "otras_claves": ["<tab2>"],      // átomos de otro tab, reconocidos
//                              "agregar_en": { "<CMD>": "<fragmento>" }, // policy SIN átomo: la acción va junto al fragmento
//                              "receta": { "<columna>": "<valor SQL>" },  // sólo para la fila que fabrica el arnés
//                              "evidencia": { "<tab ajeno>": ["<componente del tab>", …, "<archivo que escribe>"] },
//                              "porque": "…" } },
//     "_sin_clave": { "<tab>": "por qué el catálogo no siembra sus claves" },
//     "_recetas": { "<tabla padre fuera del mapa>": { "<columna>": "<valor SQL>" } } }
// Un tab AJENO en un comando amplía quién escribe la tabla: `evidencia` dice
// qué pantalla de ese tab la escribe (cadena de imports desde el componente
// del registro hasta la escritura); src/__tests__/rlsAccionesMapas.test.ts lo
// comprueba, junto con que toda pantalla que escribe la tabla esté en el mapa.
// `_sin_clave` declara los tabs cuyas claves no existen en `permissions` (hoy
// sólo los exentos actúan en ellos); el arnés rechaza cualquier otro par que
// no esté en el catálogo: sería una errata que deja la acción en «sólo admin».
// Un comando sin ninguna policy permisiva (p. ej. votos no tiene UPDATE) no se
// crea: nadie lo hace, antes y después; el mapa no puede declararlo.
//
// USO
//   node scripts/rls-acciones/generar.mjs <sección>            → escribe la migración
//   node scripts/rls-acciones/generar.mjs <sección> --stdout   → la imprime
//   node scripts/rls-acciones/generar.mjs <sección> --revertir → SQL que vuelve atrás
// Requiere binarios de PostgreSQL (reconstruye la base en un clúster desechable).
// ════════════════════════════════════════════════════════════════════════════
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reconstruir, DIR_MIGRACIONES } from '../schema-drift/reconstruir.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
export const RAIZ = resolve(AQUI, '..', '..')
export const DIR_MAPAS = join(RAIZ, 'supabase', 'rls-acciones')

const ACCION = { INSERT: 'create', UPDATE: 'edit', DELETE: 'delete' }
export const COMANDOS = Object.keys(ACCION)

/** El mapa de la sección, con los comandos por defecto rellenados. */
export function cargarMapa(seccion) {
  const mapa = JSON.parse(readFileSync(join(DIR_MAPAS, `${seccion}.json`), 'utf8'))
  if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(mapa._migracion ?? '')) throw new Error(`${seccion}: _migracion inválida`)
  for (const [tabla, t] of Object.entries(mapa.tablas)) {
    if (!/^[a-z_]+$/.test(t.tab ?? '')) throw new Error(`${tabla}: falta "tab"`)
    t.declarados = COMANDOS.filter(cmd => t[cmd] !== undefined)
    for (const cmd of COMANDOS) {
      t[cmd] ??= [`${t.tab}.${ACCION[cmd]}`]
      if (!Array.isArray(t[cmd]) || t[cmd].length === 0) throw new Error(`${tabla}.${cmd}: lista vacía`)
      for (const par of t[cmd]) {
        if (!/^[a-z_]+\.(create|edit|delete|change_status|approve)$/.test(par)) throw new Error(`${tabla}.${cmd}: par inválido «${par}»`)
      }
    }
    t.otras_claves ??= []
    for (const [col, valor] of Object.entries(t.receta ?? {})) {
      if (!/^[a-z_][a-z0-9_]*$/.test(col) || typeof valor !== 'string') throw new Error(`${tabla}.receta: «${col}» inválida`)
    }
    t.agregar_en ??= {}
    for (const [cmd, frag] of Object.entries(t.agregar_en)) {
      if (!COMANDOS.includes(cmd) || typeof frag !== 'string' || !frag) throw new Error(`${tabla}.agregar_en: «${cmd}» inválido`)
    }
  }
  // Recetas de tablas PADRE que no están en el mapa (la fila de prueba de una
  // tabla del mapa las fabrica): mismas reglas que `receta`.
  mapa._recetas ??= {}
  for (const [tabla, receta] of Object.entries(mapa._recetas)) {
    if (!/^[a-z_][a-z0-9_]*$/.test(tabla) || mapa.tablas[tabla]) throw new Error(`${seccion}: _recetas «${tabla}» inválida (¿está en el mapa? va en su "receta")`)
    for (const [col, valor] of Object.entries(receta)) {
      if (!/^[a-z_][a-z0-9_]*$/.test(col) || typeof valor !== 'string') throw new Error(`_recetas.${tabla}: «${col}» inválida`)
    }
  }
  mapa._sin_clave ??= {}
  for (const tab of Object.keys(mapa._sin_clave)) {
    if (!/^[a-z_]+$/.test(tab)) throw new Error(`${seccion}: _sin_clave «${tab}» inválido`)
  }
  mapa.version = mapa._migracion.slice(0, 14)
  return mapa
}

/** Reconstruye la base con las migraciones ANTERIORES a `version`. */
export function baseAntesDe(version, log = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rla-mig-'))
  for (const f of readdirSync(DIR_MIGRACIONES)) {
    if (f.endsWith('.sql') && f.slice(0, 14) < version) symlinkSync(join(DIR_MIGRACIONES, f), join(dir, f))
  }
  const db = reconstruir({ dirMigraciones: dir, log, pararEnElPrimerFallo: true })
  const destruir = db.destruir
  db.destruir = () => { destruir(); rmSync(dir, { recursive: true, force: true }) }
  if (db.fallos.length) { db.destruir(); throw new Error(`la cadena no aplica: ${JSON.stringify(db.fallos)}`) }
  return db
}

/**
 * ¿La tabla no tiene NINGUNA policy permisiva para el comando? Entonces nadie
 * (ni el admin) lo hace por la API, antes y después: la migración no la crea.
 */
export const sinPolicy = (todas, tabla, cmd) =>
  !todas.some(p => p.tabla === tabla && p.permisiva === 'PERMISSIVE' && (p.cmd === cmd || p.cmd === 'ALL'))

/** Las policies de escritura de las tablas, tal como están en la base. */
export function leerPolicies(psql, tablas, bd = 'postgres') {
  const lista = tablas.map(t => `'${t}'`).join(',')
  const out = psql(['-X', '-A', '-t', '-d', bd, '-F', '\x1f', '-R', '\x1e', '-c',
    `SELECT tablename, policyname, cmd, permissive, array_to_string(roles, ','), coalesce(qual, ''), coalesce(with_check, '')
     FROM pg_policies WHERE schemaname = 'public' AND tablename IN (${lista}) AND cmd <> 'SELECT'
     ORDER BY tablename, cmd, policyname`])
  return out.split('\x1e').map(r => r.replace(/^\n/, '')).filter(Boolean).map(r => {
    const [tabla, nombre, cmd, permisiva, roles, using, check] = r.split('\x1f')
    return { tabla, nombre, cmd, permisiva, roles, using, check }
  })
}

// Átomos (en el texto que devuelve pg_get_expr). El orden importa: la forma
// envuelta en SELECT antes que la desnuda.
const ATOMOS = [
  { re: /\( SELECT user_has_permission\('condominios\.tab\.([a-z_]+)'::text\) AS user_has_permission\)/g, clave: true },
  { re: /user_has_permission\('condominios\.tab\.([a-z_]+)'::text\)/g, clave: true },
  { re: /\(\( SELECT current_user_role\(\) AS current_user_role\) = ANY \(ARRAY\['company_owner'::text, 'admin'::text\]\)\)/g, clave: false },
  { re: /\(current_user_role\(\) = ANY \(ARRAY\['company_owner'::text, 'admin'::text\]\)\)/g, clave: false },
]
const RESTO = [/user_has_permission\(\s*'condominios\.tab\./, /user_has_permission\(\s*CASE/, /ARRAY\['company_owner'::text, 'admin'::text\]/]

/** ¿La expresión lleva algún átomo de permiso (sustituible o no)? */
export const tieneAtomos = s => ATOMOS.some(a => new RegExp(a.re.source).test(s)) || RESTO.some(re => re.test(s))

export function accionSql(pares) {
  const terminos = pares.map(p => {
    const [tab, accion] = p.split('.')
    return `public.condominios_puede_actuar('${tab}', '${accion}')`
  })
  return `( SELECT (${terminos.join(' OR ')}) )`
}

/** Sustituye los átomos de una expresión. Devuelve { texto, n }. */
function sustituir(expr, pares, t, donde) {
  if (!expr) return { texto: expr, n: 0 }
  let n = 0
  let texto = expr
  for (const { re, clave } of ATOMOS) {
    texto = texto.replace(re, (_m, tab) => {
      if (clave && tab !== t.tab && !t.otras_claves.includes(tab)) {
        throw new Error(`${donde}: átomo de otro tab «${tab}» (el de la tabla es «${t.tab}»); reconócelo en "otras_claves" si es correcto`)
      }
      n++
      return accionSql(pares)
    })
  }
  for (const re of RESTO) {
    if (re.test(texto)) throw new Error(`${donde}: queda un átomo de permiso sin sustituir: ${texto}`)
  }
  // «visibilidad OR rol» (tablas hijas) queda «acción OR acción»: se deja una.
  const a = accionSql(pares)
  texto = texto.split(`(${a} OR ${a})`).join(a)
  return { texto, n }
}

/** Para cada policy de escritura con átomos: su versión nueva. */
export function transformar(mapa, policies) {
  const salida = []
  for (const p of policies) {
    const t = mapa.tablas[p.tabla]
    const donde = `${p.tabla}.${p.nombre}`
    const frag = p.permisiva === 'PERMISSIVE' ? t.agregar_en[p.cmd] : undefined
    if (!tieneAtomos(p.using) && !tieneAtomos(p.check)) {
      if (!frag) continue   // sin átomos (feature, MFA, …): no se toca
      // Sin átomo y declarada en agregar_en: la acción se suma al fragmento.
      const agregar = e => (e ? e.split(frag).join(`(${frag} AND ${accionSql(t[p.cmd])})`) : e)
      const usingNuevo = agregar(p.using)
      const checkNuevo = agregar(p.check)
      if (usingNuevo === p.using && checkNuevo === p.check) throw new Error(`${donde}: agregar_en no encontró «${frag}»`)
      salida.push({ ...p, usingNuevo, checkNuevo, pares: t[p.cmd] })
      continue
    }
    if (frag) throw new Error(`${donde}: agregar_en declarado, pero la policy ya tiene átomos de permiso`)
    if (!(p.cmd in ACCION)) throw new Error(`${donde}: policy FOR ${p.cmd} con átomos de permiso; resuélvela a mano`)
    const pares = t[p.cmd]
    const u = sustituir(p.using, pares, t, `${donde} USING`)
    const c = sustituir(p.check, pares, t, `${donde} WITH CHECK`)
    if (u.n + c.n === 0) throw new Error(`${donde}: no se sustituyó ningún átomo`)
    salida.push({ ...p, usingNuevo: u.texto, checkNuevo: c.texto, pares })
  }
  return salida
}

const rolesSql = r => r.split(',').map(x => (x === 'public' ? 'PUBLIC' : x)).join(', ')

function crear(p, using, check) {
  const l = [`DROP POLICY IF EXISTS ${q(p.nombre)} ON public.${p.tabla};`,
    `CREATE POLICY ${q(p.nombre)} ON public.${p.tabla}`,
    `  AS ${p.permisiva} FOR ${p.cmd} TO ${rolesSql(p.roles)}`]
  if (using) l.push(`  USING (${using})`)
  if (check) l.push(`  WITH CHECK (${check})`)
  l[l.length - 1] += ';'
  return l.join('\n')
}
const q = n => (/^[a-z_][a-z0-9_]*$/.test(n) ? n : `"${n.replace(/"/g, '""')}"`)

/** La migración (o su reversión) como texto. */
export function sql(mapa, nuevas, { revertir = false, todas } = {}) {
  if (!todas?.length) throw new Error('sql(): faltan las policies vigentes (todas)')
  const porTabla = new Map()
  for (const p of nuevas) porTabla.set(p.tabla, (porTabla.get(p.tabla) ?? []).concat(p))
  const tablas = Object.keys(mapa.tablas).sort()
  for (const t of tablas) {
    if (!porTabla.has(t)) throw new Error(`${t}: está en el mapa pero no tiene policies de escritura con átomos`)
  }
  const cuerpo = tablas.map(t => {
    const ps = porTabla.get(t)
    const m = mapa.tablas[t]
    const cab = [`-- ── ${t} ${'─'.repeat(Math.max(3, 72 - t.length))}`]
    if (!revertir) {
      for (const cmd of COMANDOS) {
        if (!sinPolicy(todas, t, cmd)) cab.push(`--   ${cmd.padEnd(6)} ${m[cmd].join(' · ')}`)
        else if (m.declarados.includes(cmd)) throw new Error(`${t}.${cmd}: el mapa lo declara, pero la tabla no tiene policy de ${cmd}`)
        else cab.push(`--   ${cmd.padEnd(6)} sin policy: nadie (no se crea)`)
      }
      if (m.porque) cab.push(...[].concat(m.porque).map(l => `--   ${l}`))
    }
    return cab.concat(ps.map(p => (revertir ? crear(p, p.using, p.check) : crear(p, p.usingNuevo, p.checkNuevo)))).join('\n')
  }).join('\n\n')
  if (revertir) return `-- REVERSIÓN de ${mapa._migracion} (generada; no es una migración)\n\n${cuerpo}\n`

  const total = t => todas.filter(p => p.tabla === t).length
  const conteo = tablas.map(t => `    ('${t}', ${porTabla.get(t).length}, ${total(t)})`).join(',\n')
  const guarda = `-- ── Guarda de postcondición ${'─'.repeat(52)}
-- Ninguna policy de escritura de estas tablas conserva la visibilidad del tab
-- ni el rol como permiso, y todas las reescritas exigen una acción. Una
-- policy permisiva de más se uniría con OR y volvería opcional la acción: el
-- número de policies de escritura por tabla tiene que ser el de antes.
DO $$
DECLARE
  v_t text; v_n int; v_total int; v_esperado int; v_esperado_total int; v_mal text;
BEGIN
  FOR v_t, v_esperado, v_esperado_total IN SELECT * FROM (VALUES
${conteo}
  ) AS e(tabla, n, total) LOOP
    SELECT count(*) FILTER (WHERE coalesce(qual, '') || coalesce(with_check, '') ~ 'condominios_puede_actuar'),
           count(*),
           string_agg(policyname, ', ') FILTER (WHERE coalesce(qual, '') || coalesce(with_check, '') ~ $r$user_has_permission\\(\\s*('condominios\\.tab\\.|CASE)|ARRAY\\['company_owner'::text, 'admin'::text\\]$r$)
      INTO v_n, v_total, v_mal
    FROM pg_policies WHERE schemaname = 'public' AND tablename = v_t AND cmd <> 'SELECT';
    IF v_mal IS NOT NULL THEN
      RAISE EXCEPTION 'acciones por permiso: % conserva visibilidad o rol como permiso de escritura en: %', v_t, v_mal;
    END IF;
    IF v_n <> v_esperado THEN
      RAISE EXCEPTION 'acciones por permiso: % tiene % policies de escritura por acción (se esperaban %)', v_t, v_n, v_esperado;
    END IF;
    IF v_total <> v_esperado_total THEN
      RAISE EXCEPTION 'acciones por permiso: % tiene % policies de escritura (se esperaban %): una de más se uniría con OR', v_t, v_total, v_esperado_total;
    END IF;
  END LOOP;
END $$;`

  const cabecera = [
    `-- ${'═'.repeat(76)}`,
    `-- ${mapa._titulo}`,
    '--',
    ...[].concat(mapa._porque ?? []).map(l => (l ? `-- ${l}` : '--')),
    '--',
    '-- QUÉ HACE (generado por scripts/rls-acciones/generar.mjs desde',
    `-- supabase/rls-acciones/${mapa._migracion.replace(/^\d{14}_rls_acciones_|\.sql$/g, '')}.json; no editar a mano)`,
    '-- En cada policy de escritura de las tablas de abajo se sustituyen SÓLO los',
    '-- átomos de permiso —user_has_permission(\'condominios.tab.<tab>\') y',
    '-- current_user_role() = ANY (company_owner, admin)— por la acción del tab que',
    '-- la pantalla exige para ese comando (condominios_puede_actuar, réplica de',
    '-- canActInCondominiosTab). Empresa, EXISTS al padre, ramas del residente y',
    '-- cualquier otra condición quedan idénticas. company_owner/admin siguen',
    '-- pasando (exentos en user_has_permission); super_admin, como antes.',
    '--',
    '-- IMPACTO: ningún dato cambia. Quien sólo VE un tab deja de crear, editar o',
    '-- borrar por la API; quien tiene la acción (o el par legado) hace en la base lo',
    '-- que ya le ofrecía la pantalla. Las RPC SECURITY DEFINER y service_role no',
    '-- pasan por RLS.',
    '--',
    `-- REVERSIÓN: node scripts/rls-acciones/generar.mjs <sección> --revertir`,
    '-- emite las policies tal como estaban.',
    '--',
    '-- IDEMPOTENTE: DROP POLICY IF EXISTS antes de cada CREATE.',
    `-- ${'═'.repeat(76)}`,
  ].join('\n')
  return `${cabecera}\n\n${cuerpo}\n\n${guarda}\n`
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [seccion, ...flags] = process.argv.slice(2)
  if (!seccion) { console.error('uso: generar.mjs <sección> [--stdout|--revertir]'); process.exit(2) }
  const mapa = cargarMapa(seccion)
  const db = baseAntesDe(mapa.version, m => console.error(m))
  try {
    const todas = leerPolicies(db.psql, Object.keys(mapa.tablas))
    const nuevas = transformar(mapa, todas)
    const texto = sql(mapa, nuevas, { revertir: flags.includes('--revertir'), todas })
    if (flags.includes('--stdout') || flags.includes('--revertir')) process.stdout.write(texto)
    else {
      writeFileSync(join(DIR_MIGRACIONES, mapa._migracion), texto)
      console.error(`✓ ${mapa._migracion}: ${nuevas.length} policies en ${Object.keys(mapa.tablas).length} tablas`)
    }
  } finally { db.destruir() }
}
