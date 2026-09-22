import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ════════════════════════════════════════════════════════════════════════════
// Cierre de la escritura cruzada en `empresa` (20260923000000 · #826 §3.3)
//
// Producción guarda el INSERT/UPDATE/DELETE de `empresa` sólo con
// `current_user_role() = 'admin'`. Ese predicado mira el ROL y no mira de qué
// empresa es, y `empresa` no tiene columna de tenant: cualquier admin de
// cualquier tenant reescribe o borra las filas que todos los demás leen.
//
// QUÉ VERIFICA ESTO, Y QUÉ NO. Que el agujero exista y quede cerrado se prueba
// EJECUTÁNDOLO en `supabase/tests/policies_empresa/`, con usuarios reales de dos
// empresas distintas contra un Postgres desechable. Eso es la prueba de verdad.
// Aquí quedan las cosas que ese arnés no puede afirmar sobre sí mismo: que esté
// cableado en CI, que conserve la forma que lo hace significar algo, y que la
// baseline del auditor NO se pode antes de tiempo.
// ════════════════════════════════════════════════════════════════════════════

const MIGRACION = resolve('supabase/migrations/20260923000000_empresa_cerrar_drift_policies_y_grants.sql')
const sql = readFileSync(MIGRACION, 'utf8')
// Se quitan los comentarios de línea: la cabecera explica el caso y nombra
// todas las policies, así que buscarlas en crudo encontraría la explicación en
// vez del DDL.
const codigo = sql.replace(/^[ \t]*--.*$/gm, '')

const DIR = 'supabase/tests/policies_empresa'
const run = readFileSync(resolve(`${DIR}/run.sh`), 'utf8')
const fixture = readFileSync(resolve(`${DIR}/fixture.sql`), 'utf8')
const antes = readFileSync(resolve(`${DIR}/antes.sql`), 'utf8')
const despues = readFileSync(resolve(`${DIR}/despues.sql`), 'utf8')

const baseline = JSON.parse(
  readFileSync(resolve('scripts/schema-drift/drift-conocido.json'), 'utf8'),
) as { grupos: Record<string, { produccion: string; repo: string }> }

const LEGADAS = [
  'empresa_insert_by_role',
  'empresa_update_by_role',
  'empresa_delete_by_role',
  'empresa_select_by_role',
] as const

describe('la migración retira las cuatro policies legadas', () => {
  it('nombra exactamente las cuatro, sobre public.empresa', () => {
    for (const p of LEGADAS) {
      expect(codigo).toMatch(
        new RegExp(`DROP POLICY IF EXISTS "${p}" ON public\\.empresa;`),
      )
    }
  })

  it('conserva la del repositorio con su misma definición', () => {
    // Re-declararla hace que producción termine con EXACTAMENTE ésta y no con
    // una variante editada a mano. Sobre la reconstrucción el par DROP+CREATE
    // deja el objeto idéntico, así que no mueve la huella del auditor.
    expect(codigo).toMatch(/CREATE POLICY "empresa_select_authenticated" ON public\.empresa/)
    expect(codigo).toMatch(/FOR SELECT\s+TO authenticated\s+USING \(true\)/)
  })

  it('no inventa una policy de escritura', () => {
    // Con RLS activa, la AUSENCIA de policy es lo que deniega. Agregar una de
    // escritura «bien acotada» sería imposible además: no hay columna de tenant
    // por donde acotar.
    expect(codigo).not.toMatch(/FOR\s+(INSERT|UPDATE|DELETE|ALL)/i)
  })

  it('cierra la SEGUNDA capa: los grants de tabla', () => {
    // Quitar las policies y dejar los grants deja el arma cargada para la
    // próxima policy permisiva que alguien agregue a mano. Es la lección que
    // 20260910000001 ya dejó escrita para security_logs.
    expect(codigo).toMatch(/REVOKE ALL ON public\.empresa FROM PUBLIC;/)
    for (const rol of ['anon', 'authenticated', 'service_role']) {
      expect(codigo).toMatch(new RegExp(`REVOKE ALL ON public\\.empresa FROM ${rol};`))
    }
    // Y vuelve a abrir sólo la lectura, que es lo único que hay.
    expect(codigo).toMatch(/GRANT SELECT ON public\.empresa TO authenticated;/)
    expect(codigo).not.toMatch(/GRANT[^;]*\b(INSERT|UPDATE|DELETE)\b[^;]*ON public\.empresa/i)
  })

  it('revoca a PUBLIC además de a los roles', () => {
    // Un privilegio HEREDADO de PUBLIC no se quita revocándoselo al rol: es el
    // mismo fallo que ya se pagó en 20260729000700, 20260825010000 y
    // 20260909000000. El REVOKE de PUBLIC va ANTES que el de los roles.
    const iPublic = codigo.indexOf('FROM PUBLIC')
    const iAnon = codigo.indexOf('FROM anon')
    expect(iPublic).toBeGreaterThan(-1)
    expect(iAnon).toBeGreaterThan(iPublic)
  })

  it('comprueba el RESULTADO, no sólo que el DROP corrió', () => {
    // Un DROP que no encuentra la policy no es error para Postgres, y un REVOKE
    // sin autoridad emite un WARNING y sale 0: sin medir el resultado, la
    // migración quedaría registrada como aplicada con la puerta abierta.
    expect(codigo).toMatch(/se esperaba exactamente 1/)
    expect(codigo).toMatch(/conserva % después del REVOKE/)
    expect(codigo).toMatch(/authenticated se quedó sin SELECT/)
    expect(codigo).toMatch(/la RLS quedó DESHABILITADA/)
  })
})

describe('el arnés prueba lo que dice probar', () => {
  it('está cableado en CI (si no, no corre nunca)', () => {
    const ci = readFileSync(resolve('.github/workflows/coverage.yml'), 'utf8')
    expect(ci).toContain('supabase/tests/policies_empresa/run.sh')
  })

  it('el fixture reproduce las legadas con la forma que causa el agujero', () => {
    // El predicado tiene que ser SÓLO el rol. Si el fixture lo declarara
    // acotado por empresa, no habría agujero que demostrar — y la tabla no
    // tiene columna por la que acotarlo, que es el fondo del asunto.
    const insert = fixture.slice(fixture.indexOf('CREATE POLICY "empresa_insert_by_role"'))
    const cuerpo = insert.slice(0, insert.indexOf(';'))
    expect(cuerpo).toMatch(/current_user_role\(\) = 'admin'/)
    expect(cuerpo).not.toMatch(/company_id/)
  })

  it('el fixture declara la tabla SIN columna de tenant', () => {
    // No es un descuido del fixture: es el hecho central. Si `empresa` tuviera
    // company_id, la corrección sería acotar las policies y no retirarlas.
    const tabla = fixture.slice(fixture.indexOf('CREATE TABLE public.empresa'))
    expect(tabla.slice(0, tabla.indexOf(');'))).not.toMatch(/company_id/)
  })

  it('el fixture concede los grants por defecto de Supabase', () => {
    // Sin ellos no se estaría probando la segunda capa: la policy de INSERT
    // sólo llega a ser algo porque el grant de INSERT existe.
    expect(fixture).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE[^;]*ON public\.empresa TO anon, authenticated/)
  })

  it('el que demuestra el agujero es de OTRA empresa', () => {
    // Si el admin fuera de la misma empresa que la fila, escribir sería
    // legítimo y la prueba no probaría nada.
    const adminB = 'bbbbbbbb-0000-0000-0000-00000000000b'
    const padron = fixture.slice(fixture.indexOf('INSERT INTO public.app_users'))
    expect(padron).toMatch(
      new RegExp(`${adminB}', '22222222-2222-2222-2222-222222222222', 'admin'`),
    )
    expect(antes).toContain(adminB)
  })

  it('antes.sql lleva el CONTROL que separa «no filtra empresa» de «no filtra nada»', () => {
    // Es lo que hace concluyente a la demostración: el operativo TAMPOCO puede
    // escribir, así que lo que falla no es que la puerta no exista — es que no
    // comprueba de dónde viene quien la cruza.
    expect(antes).toMatch(/el predicado de rol no filtra nada/)
    expect(antes).toContain('cccccccc-0000-0000-0000-00000000000c')
    const iCtrl = antes.indexOf('CTRL')
    const iBug1 = antes.indexOf('BUG 1')
    expect(iCtrl).toBeGreaterThan(-1)
    expect(iBug1).toBeGreaterThan(iCtrl) // el control va primero
  })

  it('el runner FALLA si el agujero no se reproduce', () => {
    expect(run).toMatch(/el agujero NO se reprodujo/)

    // El ORDEN se mide sobre el código, no sobre el archivo: la cabecera
    // explica los cuatro pasos y nombra los tres archivos antes de ejecutar
    // nada, así que buscarlos en crudo encuentra la explicación, no el paso.
    const ejecutable = run.split('\n').filter(l => !/^\s*#/.test(l)).join('\n')
    const posAntes = ejecutable.indexOf('antes.sql')
    const posMig = ejecutable.indexOf('-f "$MIG"')
    const posDespues = ejecutable.indexOf('despues.sql')
    expect(posAntes).toBeGreaterThan(-1)
    expect(posMig).toBeGreaterThan(posAntes)     // primero el fallo…
    expect(posDespues).toBeGreaterThan(posMig)   // …y después el arreglo
  })

  it('el runner crea los tres roles, o la migración se verificaría en vacío', () => {
    // Las guardas de la migración son `CONTINUE WHEN NOT EXISTS (… pg_roles …)`:
    // sin los roles, cada comprobación de privilegios pasaría sin mirar nada.
    expect(run).toMatch(/CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;/)
  })

  it('despues.sql comprueba las dos direcciones y las dos capas', () => {
    expect(despues).toMatch(/no modifica, no borra, no inserta/)   // se cerró
    expect(despues).toMatch(/useEmpresaQuery no se rompe/)         // no de más
    expect(despues).toMatch(/se le cayó el grant, no sólo el predicado/)
    expect(despues).toMatch(/authenticated perdió SELECT; se cerró de más/)
  })

  it('tolera las dos formas de rechazo, que no son la misma', () => {
    // Sin policy, un UPDATE no encuentra la fila y afecta 0 filas sin error.
    // Sin grant de tabla, LANZA 42501. Como esta migración quita las dos, la
    // prueba no puede depender de cuál capa mordió primero.
    expect(despues).toMatch(/EXCEPTION WHEN insufficient_privilege/)
    expect(despues).toMatch(/GET DIAGNOSTICS n = ROW_COUNT/)
  })
})

describe('la baseline del auditor NO se poda en este PR', () => {
  it('tabla:empresa/policies sigue declarada', () => {
    // Y tiene que seguir: los DROP sólo hacen algo en PRODUCCIÓN, así que la
    // reconstrucción del repositorio no cambia y P sigue distinto de R hasta
    // que la migración se aplique y se recapture la huella. Retirar la entrada
    // acá sería afirmar una convergencia que todavía nadie midió — es lo mismo
    // que 20260910000001 dejó escrito para security_logs.
    expect(baseline.grupos).toHaveProperty('tabla:empresa/policies')
    const e = baseline.grupos['tabla:empresa/policies']
    expect(e.produccion).not.toBe(e.repo)
  })

  it('la migración dice por qué no se poda', () => {
    // El texto va envuelto en comentarios de línea, así que se desenvuelve
    // antes de buscarlo: si no, una frase partida por el salto no casaría y la
    // prueba pasaría o fallaría por cómo está formateado el archivo.
    const prosa = sql.replace(/^[ \t]*--[ \t]?/gm, '').replace(/\s+/g, ' ')
    expect(prosa).toContain('NO se retira acá: se retira cuando el auditor demuestre la convergencia')
  })

  it('los grants de empresa NO estaban declarados como drift', () => {
    // Es lo que permite afirmar que producción y el repositorio coinciden hoy
    // en la ACL — y por tanto que el REVOKE cambia los dos lados por igual, que
    // es lo que el auditor clasificará como CAMBIO PLANIFICADO.
    expect(baseline.grupos).not.toHaveProperty('tabla:empresa/grants')
  })
})
