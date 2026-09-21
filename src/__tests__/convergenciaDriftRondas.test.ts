import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ════════════════════════════════════════════════════════════════════════════
// Convergencia de drift: puntos_control_ruta y visitas_control (20260919000000)
//
// QUÉ VERIFICA ESTO, Y QUÉ NO. La conducta —que la reconstrucción del repo
// hashee IGUAL que producción en los seis grupos— la verifica el propio auditor
// de drift en `schema-drift.yml`, ejecutando las 483 migraciones contra un
// Postgres desechable y comparando con `huella-produccion.json`. Eso es la
// prueba de verdad y no se puede duplicar aquí sin levantar Postgres.
//
// Lo que queda para este archivo son las dos cosas que el auditor NO dice:
//
//   1. Que la migración sea un NO-OP sobre producción. El auditor compara
//      esquemas, no mide locks: una convergencia escrita con DROP/CREATE a
//      ciegas daría exactamente la misma huella y además tomaría un
//      ACCESS EXCLUSIVE sobre dos tablas para dejarlas como estaban.
//   2. Que la poda de la baseline viaje en este mismo PR y no se lleve de
//      paso las entradas de RLS, que son de #826.
// ════════════════════════════════════════════════════════════════════════════

const MIGRACION = resolve('supabase/migrations/20260919000000_convergencia_drift_rondas.sql')
const sql = readFileSync(MIGRACION, 'utf8')
/** Sin comentarios: la cabecera documenta la reversa con DDL que no se ejecuta. */
const codigo = sql.replace(/^[ \t]*--.*$/gm, '')

const BASELINE = resolve('scripts/schema-drift/drift-conocido.json')
const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as {
  grupos: Record<string, unknown>
  _HISTORIA: string
}

/** Los seis grupos que esta migración cierra. */
const CONVERGIDOS = [
  'tabla:puntos_control_ruta/columnas',
  'tabla:puntos_control_ruta/constraints',
  'tabla:puntos_control_ruta/indices',
  'tabla:visitas_control/columnas',
  'tabla:visitas_control/constraints',
  'tabla:visitas_control/indices',
] as const

describe('la migración no escribe nada sobre producción', () => {
  it('no hay una sola sentencia DDL fuera de un bloque guardado', () => {
    // Un `ALTER` suelto convertiría el no-op en una reescritura de tabla. Se
    // mide sobre lo que QUEDA al quitar los `DO $$ … $$;`, que es donde un DDL
    // correría incondicionalmente — no sobre el archivo entero, que también
    // contiene el DDL legítimo de adentro de los bloques.
    const fueraDeBloques = codigo.replace(/DO \$\$[\s\S]*?\$\$;/g, '')
    const sueltas = fueraDeBloques
      .split('\n')
      .map(l => l.trim())
      .filter(l => /^(ALTER|CREATE|DROP)\s/i.test(l))
    expect(sueltas, `DDL fuera de un DO $$: ${sueltas.join(' | ')}`).toEqual([])

    // Y que el recorte no se haya comido el archivo entero: si el regex dejara
    // de casar, `fueraDeBloques` sería todo el código y la prueba fallaría —
    // pero si casara de más, pasaría vacunada. Los cinco bloques tienen que estar.
    expect(codigo.match(/DO \$\$/g) ?? []).toHaveLength(5)
  })

  it('las FK se deciden por `confdeltype`, no por el texto de la definición', () => {
    // `pg_get_constraintdef` es texto renderizado: su forma depende de la
    // versión y del search_path. La celda del catálogo no.
    expect(codigo).toMatch(/con\.confdeltype = 'c'/)
    expect(codigo).not.toMatch(/pg_get_constraintdef/)
  })

  it('los índices se RENOMBRAN, no se recrean', () => {
    // Un DROP + CREATE deja una ventana sin índice sobre una tabla con datos.
    expect(codigo).toMatch(/ALTER INDEX public\.%I RENAME TO %I/)
    expect(codigo).not.toMatch(/DROP INDEX/)
  })

  it('el CHECK de estado sólo se agrega si falta', () => {
    expect(codigo).toMatch(/IF EXISTS \(SELECT 1 FROM pg_constraint WHERE conname = 'visitas_control_estado_check'\)/)
  })

  it('no toca las policies: el drift de RLS se decide en #826', () => {
    expect(codigo).not.toMatch(/CREATE POLICY|DROP POLICY|ALTER POLICY/)
  })
})

describe('declara lo que producción tiene, incluido lo que está mal', () => {
  it('el CHECK de estado se escribe con el vocabulario de PRODUCCIÓN', () => {
    // Producción admite 'visitado' y 'con_novedad'; la app escribe 'ok' y
    // 'novedad'. Declarar aquí el vocabulario CORRECTO haría que R ≠ P y
    // devolvería el `CAMBIO AMBIGUO` que esta migración viene a cerrar. La
    // corrección va en la migración siguiente, ya como CAMBIO PLANIFICADO.
    expect(codigo).toMatch(/CHECK \(estado IN \('pendiente', 'visitado', 'con_novedad', 'omitido'\)\)/)
    expect(codigo).not.toMatch(/'ok'/)
  })

  it('la cabecera advierte que ese CHECK contradice a la aplicación', () => {
    // Sin esta advertencia, el próximo que lea el archivo asume que producción
    // tiene razón y alinea la app al vocabulario equivocado.
    expect(sql).toMatch(/EL CHECK DE `estado` SE DECLARA TAL CUAL ESTÁ, Y ESTÁ MAL/)
    expect(sql).toContain('marcarVisita()')
  })

  it('falla si el catálogo no es el que esperaba encontrar', () => {
    // Fail-closed: una FK que desapareció, o un índice que ya no está con
    // ninguno de los dos nombres, no puede pasar callando.
    expect(codigo).toMatch(/RAISE EXCEPTION[\s\S]{0,120}no existe la FK/)
    expect(codigo).toMatch(/RAISE EXCEPTION[\s\S]{0,120}no existe ni % ni %/)
  })

  it('tiene postcondición que aborta si la convergencia queda a medias', () => {
    expect(codigo).toMatch(/RAISE EXCEPTION 'CONVERGENCIA incompleta/)
  })
})

describe('la poda de la baseline viaja en el mismo PR', () => {
  it('los seis grupos convergidos ya no están declarados', () => {
    // El auditor lo exige: una entrada de baseline cuyo grupo ya no muestra
    // drift (`P == R`) rompe la corrida hasta que se retire. Si no, la lista se
    // vuelve un «permitir» permanente.
    for (const clave of CONVERGIDOS) {
      expect(baseline.grupos, clave).not.toHaveProperty(clave)
    }
  })

  it('no toca las policies: su drift no es de esta migración', () => {
    // Control negativo de la poda: es fácil borrar por prefijo de tabla y
    // llevarse las policies de paso.
    //
    // Cuando se escribió esto, las dos entradas */policies seguían declaradas y
    // la prueba lo afirmaba. Ya no: `20260922000000` las resolvió retirando las
    // policies legadas `company_rw_*`, con su propio arnés ejecutable
    // (supabase/tests/policies_rondas). Lo que sigue siendo cierto —y es lo que
    // este control existe para vigilar— es que NO fue esta migración: su SQL no
    // menciona ninguna policy.
    expect(codigo).not.toMatch(/CREATE POLICY|DROP POLICY|ALTER POLICY/)
    expect(codigo).not.toMatch(/company_rw_/)
  })

  it('la historia de la baseline dice por qué encogió', () => {
    expect(baseline._HISTORIA).toContain('20260919000000')
  })
})
