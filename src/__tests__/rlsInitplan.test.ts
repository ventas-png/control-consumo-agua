import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'

// Guard del envoltorio `(SELECT …)` en las políticas RLS (20260906000000).
//
// EL PROBLEMA QUE FIJA
// `public.user_has_permission()` es `LANGUAGE sql STABLE` y, dentro de una
// policy, no depende de la fila. El planificador la resuelve UNA VEZ como
// InitPlan sólo si va envuelta en `(SELECT …)`; desnuda la evalúa por fila. La
// diferencia no rompe nada — por eso se cuela — y se paga en cada listado de
// una tabla que crece.
//
// POR QUÉ UN GUARD Y NO SÓLO LA MIGRACIÓN
// Así fue como se acumuló: `rbac_install_company_policies` (20260518000010)
// generó ~490 políticas con la forma desnuda sobre 123 tablas, y nadie lo vio
// porque el SQL era correcto. Arreglar las de suministros sin dejar algo que
// avise sería arreglar el síntoma de hoy.
//
// EL RECORTE IMPORTA: sólo se exige desde 20260906000000 en adelante. Las
// migraciones anteriores son historia inmutable (scripts/migrations-append-only)
// y reescribirlas es justamente lo que ese guard prohíbe.
//
// Y SE ACOTA A `CREATE POLICY` A PROPÓSITO. Los cuerpos de RPC llaman
// `user_has_permission()` sin envolver y está BIEN: ahí no hay evaluación por
// fila que evitar. Un guard que gritara por eso enseñaría a ignorarlo.

const MIGRATIONS_DIR = resolve('supabase/migrations')
const DESDE = '20260906000000'
const MIG_INITPLAN = '20260906000000_rls_initplan_suministros.sql'

/** Quita comentarios de línea y de bloque para no analizar prosa. */
function soloCodigo(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '')
}

/**
 * Devuelve cada sentencia `CREATE POLICY … ;` del archivo.
 *
 * Cubre también las que viven dentro de un `format($pol$ … $pol$, …)`: la
 * plantilla del generador dice literalmente `CREATE POLICY %I ON public.%I`, y
 * el corte en el primer `;` se lleva el `);` que cierra el EXECUTE — con el
 * predicado entero adentro, que es lo que interesa.
 */
function sentenciasDePolicy(sql: string): string[] {
  return soloCodigo(sql).match(/CREATE\s+POLICY[\s\S]*?;/gi) ?? []
}

/** Llamadas a un helper de RLS que NO están envueltas en `(SELECT …)`. */
function sinEnvolver(sentencia: string, helper: string): string[] {
  const re = new RegExp(`(\\(\\s*SELECT\\s+)?public\\.${helper}\\s*\\(`, 'gi')
  return [...sentencia.matchAll(re)].filter(m => !m[1]).map(m => m[0])
}

const HELPERS = ['user_has_permission', 'is_super_admin', 'get_my_company_id', 'current_user_role']

describe('RLS · los helpers van envueltos en (SELECT …) dentro de las policies', () => {
  const nuevas = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql') && f.slice(0, 14) >= DESDE)
    .sort()

  it('hay migraciones nuevas que analizar', () => {
    // Si esto falla es que se renombró o borró la migración del envoltorio, y
    // el guard estaría pasando por no tener nada que mirar.
    expect(nuevas).toContain(MIG_INITPLAN)
  })

  it.each(nuevas)('%s envuelve todos los helpers de sus policies', file => {
    const sentencias = sentenciasDePolicy(readFileSync(join(MIGRATIONS_DIR, file), 'utf-8'))
    const desnudas: string[] = []
    for (const s of sentencias) {
      for (const helper of HELPERS) {
        for (const hit of sinEnvolver(s, helper)) {
          desnudas.push(`${hit}…  en: ${s.slice(0, 60).replace(/\s+/g, ' ')}…`)
        }
      }
    }
    expect(
      desnudas,
      `${file}: dentro de CREATE POLICY los helpers van como \`(SELECT public.x())\`, ` +
        'no desnudos — si no, el planificador los evalúa fila por fila',
    ).toEqual([])
  })
})

describe('20260906000000 · qué arregla exactamente', () => {
  const sql = readFileSync(join(MIGRATIONS_DIR, MIG_INITPLAN), 'utf-8')
  const TABLAS = ['suministros_condominio', 'movimientos_suministro'] as const
  const OPERACIONES = ['select', 'insert', 'update', 'delete'] as const

  it('corrige la PLANTILLA del generador, no sólo las ocho políticas', () => {
    // Sin esto, la próxima tabla que use el generador vuelve a nacer desnuda.
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.rbac_install_company_policies/i)
    expect(sql).toMatch(/\(SELECT public\.user_has_permission\(%L\)\)/i)
  })

  it.each(TABLAS.flatMap(t => OPERACIONES.map(op => [t, op] as const)))(
    're-declara %s_%s',
    (tabla, op) => {
      expect(sql).toMatch(new RegExp(`DROP POLICY IF EXISTS "${tabla}_${op}"`, 'i'))
      expect(sql).toMatch(new RegExp(`CREATE POLICY "${tabla}_${op}"`, 'i'))
    },
  )

  it('no cambia el permiso ni el alcance: sólo la forma', () => {
    // El riesgo real de esta clase de cambio es teclear otro permiso y abrir o
    // cerrar algo sin querer. Las ocho re-declaraciones usan el mismo que tenían.
    const otros = sql.match(/user_has_permission\('condominios\.tab\.(?!suministros')[^']*'\)/g)
    expect(otros, 'apareció un permiso que no es condominios.tab.suministros').toBeNull()
    expect(sql).not.toMatch(/project_id\s*=/i)
  })

  it('el generador conserva la lógica de detección, no sólo el predicado', () => {
    // Es una copia literal salvo el envoltorio: si alguien la simplifica, las
    // tablas sin UPDATE (estilo bitácora) empezarían a recibir uno.
    expect(sql).toMatch(/had_select\s*:=\s*'SELECT' = ANY\(existing_ops\)/i)
    expect(sql).toMatch(/policyname NOT ILIKE '%cliente%'/i)
  })
})

describe('20260906000000 · el sandbox conductual está cableado a CI', () => {
  it('el job rls-sandbox ejecuta rls_initplan_suministros', () => {
    const wf = readFileSync(resolve('.github/workflows/coverage.yml'), 'utf-8')
    expect(wf).toMatch(/supabase\/tests\/rls_initplan_suministros\/run\.sh/)
  })

  it('el runner del sandbox existe', () => {
    const runSh = resolve('supabase/tests/rls_initplan_suministros/run.sh')
    expect(() => readFileSync(runSh, 'utf-8')).not.toThrow()
  })
})
