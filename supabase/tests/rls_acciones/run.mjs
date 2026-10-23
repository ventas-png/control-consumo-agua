#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// Verificación EJECUTABLE de una migración «escribir exige la ACCIÓN del tab»
// (las que genera scripts/rls-acciones/generar.mjs, una por sección).
//
// POR QUÉ EXISTE
// Una sección son veinte tablas y sesenta policies. Que la de una pida de
// menos (borra quien sólo ve) o de más (la RLS no deja hacer lo que la
// pantalla ofrece y lo hace en silencio) no se ve leyendo el SQL, y escribir a
// mano un padrón por tabla no escala. Aquí todo sale del MAPA de la sección y
// del CATÁLOGO de la base:
//
//   1 · cadena    bootstrap + TODAS las migraciones anteriores a la de la
//                 sección, en una base vacía (el esquema real)
//   2 · generada  la migración del repo es EXACTAMENTE la que produce el
//                 generador desde el mapa (nadie la editó a mano)
//   3 · antes     con el padrón de la prueba, el hueco EXISTE: quien sólo ve
//                 crea filas. Si no, la prueba no probaría nada.
//   4 · migra     la migración DOS veces: la segunda no cambia la huella del
//                 auditor de drift, y la primera cambia EXACTAMENTE las
//                 policies de las tablas del mapa
//   5 · matriz    por tabla, una fila FABRICADA desde el catálogo; por cada
//                 par «tab.acción» del mapa, una persona que sólo tiene ese
//                 par (y la visibilidad de los tabs de la sección); INSERT,
//                 UPDATE y DELETE se intentan y se DESHACEN. Pasa quien el
//                 mapa dice, y nadie más: ni quien sólo ve, ni otra empresa.
//                 El admin de la empresa, siempre.
//                 Una tabla con `ramas` (la policy elige el tab por una
//                 columna) fabrica además una fila por rama, que se prueba
//                 con los pares de su rama.
//                 Y el RESIDENTE (cliente dueño de una unidad) obtiene en cada
//                 tabla y comando exactamente lo mismo que antes: sus ramas en
//                 las policies no dependen de ningún tab y no se tocan.
//   6 · mutantes  por tabla, la migración con UN comando devuelto a la regla
//                 vieja: la matriz DEBE fallar en esa tabla
//
// Las tablas cuya fila fabricada no entra ni como superusuario (triggers con
// reglas de negocio) se informan y quedan fuera de la matriz: las cubre la
// guarda de la migración y el paso 2.
//
// USO:  node supabase/tests/rls_acciones/run.mjs <sección>
// Requiere binarios de PostgreSQL. No toca ningún proyecto remoto.
// ════════════════════════════════════════════════════════════════════════════
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DIR_MIGRACIONES, listarMigraciones } from '../../../scripts/schema-drift/reconstruir.mjs'
import { baseAntesDe, cargarMapa, COMANDOS, leerPolicies, sql as generarSql, transformar, accionSql, sinPolicy, tieneAtomos } from '../../../scripts/rls-acciones/generar.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const HUELLA = join(AQUI, '../../../scripts/schema-drift/fingerprint.sql')
const seccion = process.argv[2]
if (!seccion) { console.error('uso: run.mjs <sección>'); process.exit(2) }

const mapa = cargarMapa(seccion)
const tablas = Object.keys(mapa.tablas).sort()
const MIG = join(DIR_MIGRACIONES, mapa._migracion)
const trabajo = mkdtempSync(join(tmpdir(), 'rla-'))
let fallo = false
const ok = m => console.log(`  ✓ ${m}`)
const mal = m => { console.log(`  ✗ ${m}`); fallo = true }
const salir = () => { if (fallo) { console.log('\n❌ rls_acciones: hay invariantes incumplidas'); process.exit(1) } }

// Las filas de la matriz: una por tabla y una por cada rama («tabla:valor»).
const ramasDe = t => Object.entries(mapa.tablas[t].ramas?.valores ?? {})
const filas = tablas.flatMap(t => [{ clave: t, tabla: t, variante: '' }, ...ramasDe(t).map(([v]) => ({ clave: `${t}:${v}`, tabla: t, variante: v }))])
const filaDe = clave => filas.find(f => f.clave === clave)
/** Los pares que el mapa da a un comando de una fila; undefined si su rama no lo declara. */
const paresDe = (clave, cmd) => {
  const f = filaDe(clave)
  return f.variante ? mapa.tablas[f.tabla].ramas.valores[f.variante][cmd] : mapa.tablas[f.tabla][cmd]
}

// Pares «tab.acción» y tabs de la sección: el universo de las personas.
const pares = [...new Set(filas.flatMap(f => COMANDOS.flatMap(c => paresDe(f.clave, c) ?? [])))].sort()
const tabsSeccion = [...new Set(tablas.flatMap(t => [mapa.tablas[t].tab, ...ramasDe(t).map(([, r]) => r.tab)]).concat(pares.map(p => p.split('.')[0])))].sort()
const alias = p => 'P_' + p.replace('.', '__')

console.log(`── 1/6 · cadena de migraciones anteriores a ${mapa.version}`)
const db = baseAntesDe(mapa.version)
const psql = (bd, args, op = {}) => db.psql(['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', bd, ...args], { stdio: 'pipe', ...op })
const aplicar = (bd, archivo) => psql(bd, ['-f', archivo], { env: { ...db.entorno, PGOPTIONS: '-c client_min_messages=warning' } })
const copia = (de, a) => psql('template1', ['-c', `DROP DATABASE IF EXISTS ${a}`, '-c', `CREATE DATABASE ${a} TEMPLATE ${de}`])
const huella = bd => psql(bd, ['-tA', '-f', HUELLA]).trim().split('\n').sort()
const posteriores = bd => {
  for (const f of listarMigraciones()) if (f.slice(0, 14) > mapa.version) aplicar(bd, join(DIR_MIGRACIONES, f))
}

try {
  psql('template1', ['-c', 'CREATE DATABASE base TEMPLATE postgres'])
  ok(`${listarMigraciones().filter(f => f.slice(0, 14) < mapa.version).length} migraciones aplicadas sobre una base vacía`)

  console.log('── 2/6 · la migración del repo es la que produce el generador desde el mapa')
  const todas = leerPolicies(db.psql, tablas, 'base')
  const nuevas = transformar(mapa, todas)
  const esperado = generarSql(mapa, nuevas, { todas })
  const enRepo = readFileSync(MIG, 'utf8')
  if (enRepo === esperado) ok(`${mapa._migracion}: ${nuevas.length} policies en ${tablas.length} tablas, idéntica a la generada`)
  else {
    writeFileSync(join(trabajo, 'esperada.sql'), esperado)
    mal(`${mapa._migracion} difiere de la generada (regenerá con: node scripts/rls-acciones/generar.mjs ${seccion})`)
    salir()
  }

  // ── Catálogo: toda clave de la sección existe, salvo los tabs declarados ──
  const clavesDe = ps => [...new Set(tabsSeccion.map(t => `condominios.tab.${t}`).concat(ps.map(p => `condominios.tab.${p}`)))]
  const usadas = clavesDe(pares)
  const ausentes = psql('base', ['-tA', '-c', `SELECT k FROM unnest(ARRAY[${usadas.map(k => `'${k}'`).join(', ')}]) AS k WHERE NOT EXISTS (SELECT 1 FROM public.permissions p WHERE p.key = k) ORDER BY k`]).trim().split('\n').filter(Boolean)
  const tabDe = k => k.split('.')[2]
  const sinDeclarar = ausentes.filter(k => !(tabDe(k) in mapa._sin_clave))
  const declaradasPresentes = Object.keys(mapa._sin_clave).filter(t => !ausentes.some(k => tabDe(k) === t))
  if (sinDeclarar.length) mal(`claves que el catálogo no tiene (¿errata?; si es así a propósito, declara el tab en "_sin_clave"): ${sinDeclarar.join(', ')}`)
  if (declaradasPresentes.length) mal(`"_sin_clave" declara tabs cuyas claves ya están en el catálogo: ${declaradasPresentes.join(', ')}`)
  salir()
  if (ausentes.length) ok(`claves de la sección en el catálogo; sin sembrar a propósito (la prueba las agrega): ${ausentes.join(', ')}`)
  else ok(`las ${usadas.length} claves de la sección existen en el catálogo`)

  // ── Padrón y personas ───────────────────────────────────────────────────────
  const usuariosSql = () => {
    const filas = [['VER', []], ...pares.map(p => [alias(p), [p]]), ['OTRA', pares]]
    const l = ['\\set ON_ERROR_STOP on']
    if (ausentes.length) l.push(`INSERT INTO public.permissions (key, category, label) SELECT k, 'condominios', k FROM unnest(ARRAY[${ausentes.map(k => `'${k}'`).join(', ')}]) AS k;`)
    filas.forEach(([a], i) => l.push(`INSERT INTO ra.ids VALUES ('${a}', '${`c3000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`}');`))
    for (const [a, ps] of filas) {
      const empresa = a === 'OTRA' ? 'B' : 'A'
      l.push(`INSERT INTO auth.users (id) VALUES (ra.id('${a}'));`,
        `INSERT INTO public.app_users (id, company_id, full_name, role) VALUES (ra.id('${a}'), ra.id('${empresa}'), 'rls_acciones ${a}', 'operator');`,
        `INSERT INTO public.user_project_assignments (user_id, project_id, permission_type) VALUES (ra.id('${a}'), ra.id('${empresa}1'), 'total');`,
        `INSERT INTO public.roles (id, company_id, name) VALUES (ra.id('${a}'), ra.id('${empresa}'), 'rls_acciones ${a}');`,
        `INSERT INTO public.user_roles (user_id, role_id) VALUES (ra.id('${a}'), ra.id('${a}'));`)
      const claves = clavesDe(ps)
      l.push(`INSERT INTO public.role_permissions (role_id, permission_key, effect) SELECT ra.id('${a}'), k, 'allow' FROM unnest(ARRAY[${claves.map(k => `'${k}'`).join(', ')}]) AS k;`)
    }
    return l.join('\n') + '\n'
  }
  writeFileSync(join(trabajo, 'usuarios.sql'), usuariosSql())
  // Compuertas RESTRICTIVE ajenas al permiso (plan contratado, MFA): la
  // migración no las toca —la guarda y la huella lo comprueban— y no dependen
  // del tab ni de la acción. Se retiran en cada base de la prueba (antes,
  // después y mutantes por igual) para observar la rama de permisos; con
  // ellas puestas, el AND sólo puede quitar permisos, nunca darlos.
  const compuertas = todas.filter(p => p.permisiva === 'RESTRICTIVE' && !tieneAtomos(p.using) && !tieneAtomos(p.check))
  const lit = v => `'${String(v).replace(/'/g, "''")}'`
  // Una migración posterior puede retirar la tabla entera (20261106000300 funde
  // asambleas_digital en asambleas): su compuerta se fue con ella.
  writeFileSync(join(trabajo, 'compuertas.sql'), compuertas.map(p =>
    `DO $$ BEGIN IF to_regclass('public.${p.tabla}') IS NOT NULL THEN EXECUTE ${lit(`DROP POLICY "${p.nombre.replace(/"/g, '""')}" ON public.${p.tabla}`)}; END IF; END $$;`).join('\n') + '\n')
  const recetas = [...tablas.map(t => [t, '', mapa.tablas[t].receta ?? {}]), ...Object.entries(mapa._recetas).map(([t, r]) => [t, '', r]),
    ...tablas.flatMap(t => ramasDe(t).map(([v, r]) => [t, v, r.receta ?? {}]))]
    .flatMap(([t, variante, receta]) => Object.entries(receta).map(([col, valor]) => `INSERT INTO ra.recetas (tabla, variante, col, valor) VALUES ('public.${t}', ${lit(variante)}, ${lit(col)}, ${lit(valor)});`))
  writeFileSync(join(trabajo, 'recetas.sql'), recetas.join('\n') + '\n')
  const padron = bd => {
    aplicar(bd, join(AQUI, 'fabricar.sql'))
    aplicar(bd, join(trabajo, 'recetas.sql'))
    aplicar(bd, join(AQUI, 'padron.sql'))
    aplicar(bd, join(trabajo, 'usuarios.sql'))
    aplicar(bd, join(trabajo, 'compuertas.sql'))
  }

  // ── Matriz ──────────────────────────────────────────────────────────────────
  // Fase 1 (superusuario): una fila base confirmada por tabla y, por persona,
  // un INSERT recién fabricado. Control: el superusuario puede cada comando.
  // Fase 2 (cada persona): los intentos, que se deshacen; el resultado queda.
  const personas = ['VER', 'ADM', 'OTRA', 'RES', ...pares.map(alias)]
  const matriz = (bd, soloTablas = tablas) => {
    const f1 = ['\\set ON_ERROR_STOP on',
      'CREATE TABLE ra.base (tabla text PRIMARY KEY, fila jsonb, sql_update text, sql_delete text);',
      'CREATE TABLE ra.altas (tabla text, persona text, sql text);',
      'CREATE TABLE ra.control (tabla text, cmd text, resultado text);',
      'GRANT SELECT ON ra.base, ra.altas TO PUBLIC;',
      `SELECT ra.como('ADM');`]
    const unidades = filas.filter(f => soloTablas.includes(f.tabla))
    for (const { clave: k, tabla: t, variante: v } of unidades) {
      f1.push(`DO $$ DECLARE v_sql text := ra.sql_alta('public.${t}', ra.id('A'), 0, '${v}'); v_fila jsonb; v_col text := ra.columna_editable('public.${t}'); BEGIN
  IF v_sql IS NULL THEN INSERT INTO ra.control VALUES ('${k}', 'FABRICA', 'sin receta'); RETURN; END IF;
  BEGIN EXECUTE v_sql || ' RETURNING to_jsonb(${t}.*)' INTO v_fila;
  EXCEPTION WHEN OTHERS THEN INSERT INTO ra.control VALUES ('${k}', 'FABRICA', SQLSTATE || ' ' || left(SQLERRM, 160)); RETURN; END;
  INSERT INTO ra.base VALUES ('${k}', v_fila,
    format('UPDATE public.${t} SET %I = %I WHERE %s', v_col, v_col, ra.donde('public.${t}', v_fila)),
    format('DELETE FROM public.${t} WHERE %s', ra.donde('public.${t}', v_fila)));
  INSERT INTO ra.altas SELECT '${k}', p, ra.sql_alta('public.${t}', ra.id(CASE p WHEN 'OTRA' THEN 'A' ELSE 'A' END), 0, '${v}')
    FROM unnest(ARRAY[${personas.map(p => `'${p}'`).join(', ')}, 'CONTROL']) AS p;
  INSERT INTO ra.control VALUES
    ('${k}', 'INSERT', ra.intento((SELECT sql FROM ra.altas WHERE tabla = '${k}' AND persona = 'CONTROL'))),
    ('${k}', 'UPDATE', ra.intento((SELECT sql_update FROM ra.base WHERE tabla = '${k}'))),
    ('${k}', 'DELETE', ra.intento((SELECT sql_delete FROM ra.base WHERE tabla = '${k}')));
END $$;`)
    }
    const f2 = ['\\set ON_ERROR_STOP on']
    for (const p of personas) {
      f2.push(`SELECT ra.como('${p}');`, 'SET ROLE authenticated;')
      for (const { clave: t } of unidades) {
        f2.push(`INSERT INTO ra.resultados SELECT '${p}', '${t}', 'INSERT', ra.intento(sql) FROM ra.altas WHERE tabla = '${t}' AND persona = '${p}';`,
          `INSERT INTO ra.resultados SELECT '${p}', '${t}', 'UPDATE', ra.intento(sql_update) FROM ra.base WHERE tabla = '${t}';`,
          `INSERT INTO ra.resultados SELECT '${p}', '${t}', 'DELETE', ra.intento(sql_delete) FROM ra.base WHERE tabla = '${t}';`)
      }
      f2.push('RESET ROLE;')
    }
    writeFileSync(join(trabajo, 'fase1.sql'), f1.join('\n') + '\n')
    writeFileSync(join(trabajo, 'fase2.sql'), f2.join('\n') + '\n')
    aplicar(bd, join(trabajo, 'fase1.sql'))
    aplicar(bd, join(trabajo, 'fase2.sql'))
    const leer = q => psql(bd, ['-tA', '-F', '\t', '-c', q]).trim().split('\n').filter(Boolean).map(l => l.split('\t'))
    return {
      control: leer('SELECT tabla, cmd, resultado FROM ra.control'),
      resultados: leer('SELECT usuario, tabla, cmd, resultado FROM ra.resultados'),
    }
  }

  /**
   * Qué pedía ANTES cada comando, leído de su policy permisiva: la visibilidad
   * del tab, el rol company_owner/admin, sólo la empresa (lo que el mapa declara
   * en `agregar_en`) o nada que la migración sustituya —p. ej. un DELETE sólo de
   * super_admin—: ese no se toca, y no se prueba ni antes ni después.
   */
  const reglaAntes = (t, cmd) => {
    const txt = todas.filter(p => p.tabla === t && p.permisiva === 'PERMISSIVE' && (p.cmd === cmd || p.cmd === 'ALL'))
      .map(p => `${p.using} ${p.check}`).join(' ')
    if (/user_has_permission\(\s*('condominios\.tab\.|CASE)/.test(txt)) return 'visibilidad'   // CASE: la clave la elige una columna (`ramas`)
    if (/ARRAY\['company_owner'::text, 'admin'::text\]/.test(txt)) return 'rol'
    if (mapa.tablas[t].agregar_en[cmd]) return 'empresa'
    return 'intocado'
  }

  /**
   * Lo que el mapa dice que pasa: persona → fila → comando → permitido. Una
   * rama que no declara el comando no lo sustituye (p. ej. un DELETE «sólo
   * company_owner»): no se prueba aquí, ni antes ni después.
   */
  const permitido = (persona, clave, cmd) => {
    const t = filaDe(clave).tabla
    if (persona === 'RES') return null   // se compara contra «antes», no contra el mapa
    if (sinPolicy(todas, t, cmd)) return false   // sin policy permisiva: nadie, ni antes ni después
    if (reglaAntes(t, cmd) === 'intocado' || !paresDe(clave, cmd)) return null
    if (persona === 'ADM') return true
    if (persona === 'VER' || persona === 'OTRA') return false
    return paresDe(clave, cmd).map(alias).includes(persona)
  }

  /** Compara; devuelve las diferencias (y las tablas fuera de la matriz). */
  const evaluar = ({ control, resultados }, esperar = permitido) => {
    const fuera = new Map()
    for (const [t, cmd, r] of control) if (r !== 'ok') fuera.set(`${t}.${cmd}`, r)
    const difs = []
    for (const [p, t, cmd, r] of resultados) {
      if (fuera.has(`${t}.FABRICA`) || fuera.has(`${t}.${cmd}`)) continue
      const quiere = esperar(p, t, cmd)
      if (quiere === null) continue
      if (r.startsWith('error:')) difs.push(`${t} ${cmd} · ${p}: error inesperado ${r}`)
      else if ((r === 'ok') !== quiere) difs.push(`${t} ${cmd} · ${p}: ${r === 'ok' ? 'PASÓ' : 'NO pasó'} y ${quiere ? 'debía' : 'no debía'}`)
    }
    return { difs, fuera }
  }

  let residenteAntes = new Map()
  console.log('── 3/6 · control previo: el padrón reproduce el hueco de ANTES')
  copia('base', 'antes')
  padron('antes')
  {
    const r = matriz('antes')
    // Antes: con la visibilidad (o sólo la empresa) pasa toda persona de A —todas
    // ven los tabs de la sección—; con el rol, sólo el admin.
    const { difs, fuera } = evaluar(r, (p, clave, cmd) => {
      const t = filaDe(clave).tabla
      if (p === 'RES') return null
      if (sinPolicy(todas, t, cmd)) return false
      const regla = reglaAntes(t, cmd)
      if (regla === 'intocado' || !paresDe(clave, cmd)) return null
      return p === 'ADM' || (p !== 'OTRA' && regla !== 'rol')
    })
    residenteAntes = new Map(r.resultados.filter(([p]) => p === 'RES').map(([, t, cmd, res]) => [`${t}.${cmd}`, res]))
    const probadas = filas.filter(f => !fuera.has(`${f.clave}.FABRICA`))
    for (const p of compuertas) console.log(`  · compuerta retirada en la prueba: ${p.tabla}.${p.nombre} (${p.cmd}: ${(p.check || p.using).replace(/\s+/g, ' ')})`)
    const vacios = tablas.flatMap(t => COMANDOS.filter(c => sinPolicy(todas, t, c)).map(c => `${t}.${c}`))
    if (vacios.length) console.log(`  · sin policy permisiva (nadie, ni antes ni después): ${vacios.join(', ')}`)
    const intocados = tablas.flatMap(t => COMANDOS.filter(c => !sinPolicy(todas, t, c) && reglaAntes(t, c) === 'intocado').map(c => `${t}.${c}`))
    if (intocados.length) console.log(`  · sin permiso que sustituir (la migración no los toca): ${intocados.join(', ')}`)
    const ramaSin = filas.filter(f => f.variante).flatMap(f => COMANDOS.filter(c => !sinPolicy(todas, f.tabla, c) && !paresDe(f.clave, c)).map(c => `${f.clave}.${c}`))
    if (ramaSin.length) console.log(`  · rama sin sustituir (su policy la resuelve sin átomo; no se prueba aquí): ${ramaSin.join(', ')}`)
    const visibles = tablas.flatMap(t => COMANDOS.filter(c => c !== 'INSERT' && c !== 'UPDATE' && reglaAntes(t, c) === 'visibilidad').map(c => `${t}.${c}`))
    if (difs.length) for (const d of difs.slice(0, 20)) mal(`antes · ${d}`)
    else ok(`antes · en ${probadas.length} filas (${tablas.length} tablas y sus ramas), quien sólo VE crea y edita, y nadie salvo el admin borra${visibles.length ? ` (salvo ${visibles.join(', ')}: también borraba quien sólo veía)` : ''}`)
  }
  salir()

  console.log('── 4/6 · la migración, DOS veces, y lo que cambia en la huella')
  copia('base', 'post')
  const h0 = huella('post')
  aplicar('post', MIG)
  const h1 = huella('post')
  aplicar('post', MIG)
  const h2 = huella('post')
  if (h1.join('\n') === h2.join('\n')) ok('idempotente: la segunda pasada deja la misma huella')
  else mal('la segunda pasada cambió la huella')
  const grupo = l => l.split('\t').slice(0, 2).join('\t')
  const cambiados = [...new Set([...h0.map(grupo).filter(g => !h1.map(grupo).includes(g)), ...h1.map(grupo).filter(g => !h0.map(grupo).includes(g))].map(g => g.split('\t')[0]))].sort()
  const esperados = tablas.map(t => `tabla:${t}/policies`).sort()
  if (cambiados.join(' ') === esperados.join(' ')) ok(`la huella cambia EXACTAMENTE en las policies de las ${tablas.length} tablas (ninguna función, grant ni columna)`)
  else mal(`la huella cambió otros grupos:\n      cambiados: ${cambiados.join(' ')}\n      esperados: ${esperados.join(' ')}`)
  posteriores('post')
  salir()

  console.log('── 5/6 · matriz: cada comando, cada persona, cada tabla')
  copia('post', 'matriz')
  // Una migración posterior puede retirar una tabla del mapa (20261106000300
  // funde asambleas_digital en asambleas y la borra): ya no hay nada que probar.
  const existentes = new Set(psql('matriz', ['-tA', '-c',
    `SELECT t FROM unnest(ARRAY[${tablas.map(t => `'${t}'`).join(', ')}]) t WHERE to_regclass('public.' || t) IS NOT NULL`]).trim().split('\n'))
  const vivas = tablas.filter(t => existentes.has(t))
  for (const t of tablas.filter(t => !existentes.has(t))) console.log(`  · retirada por una migración posterior: ${t}`)
  padron('matriz')
  const r = matriz('matriz', vivas)
  const { difs, fuera } = evaluar(r)
  const conFila = vivas.filter(t => !fuera.has(`${t}.FABRICA`))
  const ramasConFila = filas.filter(f => f.variante && existentes.has(f.tabla) && !fuera.has(`${f.clave}.FABRICA`))
  for (const [k, v] of fuera) console.log(`  · fuera de la matriz ${k}: ${v}`)
  if (difs.length) for (const d of difs) mal(d)
  else ok(`${conFila.length}/${vivas.length} tablas con fila fabricada${ramasConFila.length ? ` (y ${ramasConFila.length} rama${ramasConFila.length > 1 ? 's' : ''}: ${ramasConFila.map(f => f.clave).join(', ')})` : ''} · ${r.resultados.length} intentos · ${personas.length} personas: pasa exactamente quien el mapa dice`)
  if (filas.some(f => f.variante && fuera.has(`${f.clave}.FABRICA`))) mal('una rama quedó fuera de la matriz: su receta no fabrica la fila')
  const residente = r.resultados.filter(([p, t, cmd]) => p === 'RES' && !fuera.has(`${t}.FABRICA`) && !fuera.has(`${t}.${cmd}`))
  const cambios = residente.filter(([, t, cmd, res]) => residenteAntes.get(`${t}.${cmd}`) !== res)
  if (cambios.length) for (const [, t, cmd, res] of cambios) mal(`residente · ${t} ${cmd}: antes «${residenteAntes.get(`${t}.${cmd}`)}», ahora «${res}»`)
  else ok(`el residente obtiene lo mismo que antes en ${residente.length} intentos (${residente.filter(x => x[3] === 'ok').length} permitidos: sus ramas siguen intactas)`)
  salir()

  console.log('── 6/6 · mutantes: con un comando devuelto a la regla vieja, la matriz debe fallar')
  // Uno por tabla (un comando, rotando) y uno por rama (su primer comando).
  const mutables = [
    ...conFila.map((t, i) => {
      const cmd = COMANDOS[i % COMANDOS.length]
      const pol = nuevas.find(p => p.tabla === t && p.cmd === cmd && !fuera.has(`${t}.${cmd}`)) ?? nuevas.find(p => p.tabla === t && !fuera.has(`${t}.${p.cmd}`))
      return pol && { t, nombre: t, pol, pares: pol.pares, tab: mapa.tablas[t].tab }
    }),
    ...ramasConFila.map(f => {
      const r = mapa.tablas[f.tabla].ramas.valores[f.variante]
      const pol = nuevas.find(p => p.tabla === f.tabla && r.declarados.includes(p.cmd) && !fuera.has(`${f.clave}.${p.cmd}`))
      return pol && { t: f.tabla, nombre: f.clave, pol, pares: r[pol.cmd], tab: r.tab }
    }),
  ].filter(Boolean)
  for (const { t, nombre, pol, pares: paresMutados, tab } of mutables) {
    const vieja = `(SELECT public.user_has_permission('condominios.tab.${tab}'))`
    const texto = enRepo.slice(0, enRepo.indexOf('-- ── Guarda de postcondición'))
    const bloque = `CREATE POLICY ${/^[a-z_][a-z0-9_]*$/.test(pol.nombre) ? pol.nombre : `"${pol.nombre}"`} ON public.${t}`
    const ini = texto.indexOf(bloque)
    const fin = texto.indexOf(';', ini)
    const mutada = texto.slice(0, ini) + texto.slice(ini, fin).split(accionSql(paresMutados)).join(vieja) + texto.slice(fin)
    if (mutada === texto) { mal(`mutante ${nombre} ${pol.cmd}: no encontró el texto a mutar`); continue }
    writeFileSync(join(trabajo, 'mutante.sql'), mutada)
    copia('base', 'mutante')
    aplicar('mutante', join(trabajo, 'mutante.sql'))
    posteriores('mutante')
    padron('mutante')
    const rm = matriz('mutante', [t])
    const { difs: dm } = evaluar(rm)
    if (dm.length) ok(`sin la acción en ${nombre} ${pol.cmd}, la matriz falla (${dm[0]})`)
    else mal(`mutante ${nombre} ${pol.cmd} (visibilidad en vez de acción) pasó la matriz: esa regla no está probada`)
  }
  salir()
  console.log(`\n✅ rls_acciones/${seccion}: la migración es la generada, el padrón reproduce el hueco,`)
  console.log(`   la huella cambia sólo en las policies de ${tablas.length} tablas, la matriz coincide con el mapa`)
  console.log(`   y ${mutables.length} mutantes rompen la matriz.`)
} finally {
  db.destruir()
  rmSync(trabajo, { recursive: true, force: true })
}
