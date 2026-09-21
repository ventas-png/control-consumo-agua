import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ════════════════════════════════════════════════════════════════════════════
// Cierre del bypass de RLS en rondas (20260922000000)
//
// `20260424000059` creó dos policies junto con las tablas y ninguna migración
// las borró: `company_rw_puntos_control` y `company_rw_visitas_control`. Sin
// cláusula `FOR` son FOR ALL, sin `TO` son TO PUBLIC, y son permisivas — o sea
// que se unían con OR al gate RBAC de `20260519000002` y volvían OPCIONALES sus
// dos puertas: el permiso `condominios.tab.rutas_ronda` y el límite del DELETE
// a company_owner/admin.
//
// QUÉ VERIFICA ESTO, Y QUÉ NO. Que el bypass exista y quede cerrado se prueba
// EJECUTÁNDOLO en `supabase/tests/policies_rondas/`, con tres usuarios reales
// contra un Postgres desechable. Eso es la prueba de verdad. Aquí quedan las
// dos cosas que ese arnés no puede afirmar sobre sí mismo: que esté cableado en
// CI, y que conserve la forma que lo hace significar algo — primero demostrar
// el fallo, después arreglarlo.
// ════════════════════════════════════════════════════════════════════════════

const MIGRACION = resolve('supabase/migrations/20260922000000_retirar_policies_legadas_rondas.sql')
const sql = readFileSync(MIGRACION, 'utf8')
const codigo = sql.replace(/^[ \t]*--.*$/gm, '')

const DIR = 'supabase/tests/policies_rondas'
const run = readFileSync(resolve(`${DIR}/run.sh`), 'utf8')
const fixture = readFileSync(resolve(`${DIR}/fixture.sql`), 'utf8')
const antes = readFileSync(resolve(`${DIR}/antes.sql`), 'utf8')

const baseline = JSON.parse(
  readFileSync(resolve('scripts/schema-drift/drift-conocido.json'), 'utf8'),
) as { grupos: Record<string, unknown>; _HISTORIA: string }

describe('la migración retira las dos policies legadas', () => {
  it('nombra exactamente las dos, en sus tablas', () => {
    expect(codigo).toMatch(/DROP POLICY IF EXISTS "company_rw_puntos_control"\s+ON public\.puntos_control_ruta;/)
    expect(codigo).toMatch(/DROP POLICY IF EXISTS "company_rw_visitas_control" ON public\.visitas_control;/)
  })

  it('no recrea ni toca las cuatro de RBAC', () => {
    // Redeclararlas sólo agregaría superficie para equivocarse: ya están bien
    // en los dos lados.
    expect(codigo).not.toMatch(/CREATE POLICY/)
  })

  it('comprueba el RESULTADO, no sólo que el DROP corrió', () => {
    // Un DROP que no encuentra la policy no es error para Postgres. La guarda
    // mira qué policies QUEDAN, que es lo que de verdad decide los permisos:
    // ni una de más (una permisiva reabriría el OR) ni una de menos (sin el
    // gate la tabla queda sin lectura ni escritura).
    expect(codigo).toMatch(/conserva policies fuera del gate RBAC/)
    expect(codigo).toMatch(/le faltan policies del gate RBAC/)
  })
})

describe('el arnés prueba lo que dice probar', () => {
  it('está cableado en CI (si no, no corre nunca)', () => {
    const ci = readFileSync(resolve('.github/workflows/coverage.yml'), 'utf8')
    expect(ci).toContain('supabase/tests/policies_rondas/run.sh')
  })

  it('el fixture reproduce las legadas con la forma que causa el agujero', () => {
    // Sin `FOR` y sin `TO`. Si el fixture las declarara acotadas —por ejemplo
    // `FOR SELECT TO authenticated`— no habría OR sobre los otros comandos y la
    // prueba pasaría sin haber reproducido nada.
    const legada = fixture.slice(fixture.indexOf('CREATE POLICY "company_rw_puntos_control"'))
      .slice(0, fixture.slice(fixture.indexOf('CREATE POLICY "company_rw_puntos_control"')).indexOf(';'))
    expect(legada).not.toMatch(/\bFOR\s+(SELECT|INSERT|UPDATE|DELETE|ALL)\b/i)
    expect(legada).not.toMatch(/\bTO\s+\w+/i)
  })

  it('el usuario del caso NO tiene el permiso del tab', () => {
    // El operativo es quien demuestra el agujero. Si el fixture le diera el
    // permiso, entraría por la puerta legítima y no probaría nada.
    const operativo = '11111111-0000-0000-0000-000000000001'
    const asignaciones = fixture.slice(fixture.indexOf('INSERT INTO public.user_roles'))
    expect(asignaciones).not.toContain(operativo)
    expect(antes).toContain(operativo)
  })

  it('`user_has_permission` del fixture NO regala el permiso por rol', () => {
    // Otros fixtures del repo dan todos los permisos a company_owner/admin. Si
    // aquí se hiciera igual, la dueña pasaría cualquier gate por ser dueña y la
    // prueba no podría separar "pasó por el permiso" de "pasó por el rol".
    const fn = fixture.slice(fixture.indexOf('FUNCTION public.user_has_permission'))
      .slice(0, 400)
    expect(fn).not.toMatch(/company_owner/)
  })

  it('el runner FALLA si el agujero no se reproduce', () => {
    // Es lo que separa esta prueba de una que pasa por suerte.
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

  it('comprueba las dos direcciones, no sólo el cierre', () => {
    const despues = readFileSync(resolve(`${DIR}/despues.sql`), 'utf8')
    expect(despues).toMatch(/dejó de leer paradas/)      // no se cerró de más
    expect(despues).toMatch(/company_owner no pudo borrar/)
    expect(despues).toMatch(/sin ser company_owner ni admin/) // ni de menos
  })
})

describe('la poda de la baseline viaja en el mismo PR', () => {
  it('los dos grupos de policies ya no están declarados', () => {
    expect(baseline.grupos).not.toHaveProperty('tabla:puntos_control_ruta/policies')
    expect(baseline.grupos).not.toHaveProperty('tabla:visitas_control/policies')
  })

  it('la historia dice por qué encogió', () => {
    expect(baseline._HISTORIA).toContain('20260922000000')
  })
})
