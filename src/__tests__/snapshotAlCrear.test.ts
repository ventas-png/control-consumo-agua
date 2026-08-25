import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

// Guards del snapshot al crear la tarea (20260905000600).
//
// LA VERIFICACIÓN CONDUCTUAL vive en supabase/tests/snapshot_al_crear/run.sh y
// corre en CI: allí se ejecutan los INSERT de verdad y se comprueba que la tarea
// manual llegue armada, que el gate de evidencia muerda después de la copia, y
// que la materialización no cambie de resultado.
//
// LO QUE ESE SANDBOX NO PUEDE VER es lo que se PIERDE al reescribir la
// migración, porque probaría la versión nueva. Aquí se fija el único filo que,
// desafilado, deja una migración que sigue pasando todas sus pruebas felices y
// aun así rompe algo serio:
//
//   · Las tres banderas se combinan con OR, no se asignan. `requiere_foto`,
//     `requiere_comentario` y `requiere_checklist` son `boolean NOT NULL DEFAULT
//     false`: NO hay forma de distinguir «el que inserta dijo false» de «no dijo
//     nada». Con una asignación, este trigger BAJARÍA exigencias que alguien
//     puso a propósito — y el gate de 20260905000400 dejaría de exigirlas sin
//     que nadie se entere.

const MIG = resolve('supabase/migrations/20260905000600_snapshot_al_crear_tarea.sql')
const soloCodigo = (sql: string) => sql.replace(/--[^\n]*/g, '')
const sql = soloCodigo(readFileSync(MIG, 'utf8'))

const cuerpo = (() => {
  const m = sql.match(
    /CREATE OR REPLACE FUNCTION public\.tarea_copiar_snapshot_plantilla\(\)([\s\S]*?)\n\$\$;/i,
  )
  if (!m) throw new Error('no se encontró tarea_copiar_snapshot_plantilla')
  return m[1]
})()

const BANDERAS = ['requiere_foto', 'requiere_comentario', 'requiere_checklist'] as const

describe('20260905000600 · el trigger sólo puede APRETAR', () => {
  it.each(BANDERAS)('%s se combina con OR y no se asigna', bandera => {
    // El filo entero del diseño. Si esto se vuelve `NEW.x := p.x`, una tarea que
    // exigía foto deja de exigirla porque su plantilla no la pedía.
    expect(cuerpo).toMatch(
      new RegExp(`NEW\\.${bandera}\\s*:=\\s*NEW\\.${bandera}\\s*OR\\s*COALESCE\\(p\\.${bandera}`, 'i'),
    )
  })

  it.each(BANDERAS)('TODA asignación a %s pasa por OR, no sólo la primera', bandera => {
    // Se parsea la sentencia completa en vez de mirar hacia adelante con un
    // lookahead: `\s*(?!…)` se puede esquivar por backtracking y el guard
    // pasaría sobre código que sí asigna. Aquí se recogen TODAS las asignaciones
    // a la bandera y se exige que cada una combine.
    const asignaciones = [
      ...cuerpo.matchAll(new RegExp(`NEW\\.${bandera}\\s*:=[^;]*;`, 'gi')),
    ].map(m => m[0])

    expect(asignaciones.length, `no se encontró ninguna asignación a ${bandera}`)
      .toBeGreaterThan(0)
    for (const asignacion of asignaciones) {
      expect(asignacion, `${bandera} dejó de combinarse y pasó a asignarse`)
        .toMatch(new RegExp(`NEW\\.${bandera}\\s+OR\\s`, 'i'))
    }
  })
})

describe('20260905000600 · qué se copia y cuándo', () => {
  it('los nullables se llenan sólo si vienen vacíos', () => {
    // COALESCE con NEW primero: lo que el llamador mandó manda. Invertirlo
    // pisaría valores puestos a mano.
    expect(cuerpo).toMatch(/NEW\.duracion_estimada_min\s*:=\s*COALESCE\(NEW\.duracion_estimada_min/i)
    expect(cuerpo).toMatch(/NEW\.instrucciones_seguridad\s*:=\s*COALESCE\(NEW\.instrucciones_seguridad/i)
  })

  it('el checklist se completa sólo cuando está vacío', () => {
    // `checklist` es NOT NULL DEFAULT '[]': el arreglo vacío ES el centinela, y
    // por eso no alcanza un COALESCE.
    expect(cuerpo).toMatch(/jsonb_array_length\(COALESCE\(NEW\.checklist[\s\S]{0,40}=\s*0/i)
  })

  it('la tarea ad-hoc sale temprano y no revienta el alta', () => {
    expect(cuerpo).toMatch(/NEW\.plantilla_id IS NULL[\s\S]{0,60}RETURN NEW/i)
  })

  it('una plantilla inexistente tampoco aborta el INSERT', () => {
    expect(cuerpo).toMatch(/IF NOT FOUND THEN[\s\S]{0,40}RETURN NEW/i)
  })
})

describe('20260905000600 · el privilegio no es decorativo', () => {
  it('es SECURITY DEFINER con search_path fijado', () => {
    // `tareas_bloque_insert` acepta `turnos`, pero `plantillas_tarea_cargo_select`
    // NO. Con INVOKER, quien sólo tiene `turnos` crearía la tarea y la copia
    // fallaría EN SILENCIO. El sandbox lo prueba ejecutándolo.
    expect(cuerpo).toMatch(/SECURITY DEFINER/i)
    expect(cuerpo).toMatch(/SET search_path = public, pg_temp/i)
  })

  it('revoca PUBLIC', () => {
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.tarea_copiar_snapshot_plantilla\(\) FROM PUBLIC/i,
    )
  })

  it('es BEFORE INSERT sobre tareas_bloque', () => {
    // AFTER no serviría: hay que escribir sobre NEW antes de que la fila se grabe.
    expect(sql).toMatch(
      /CREATE TRIGGER trg_tarea_copiar_snapshot\s+BEFORE INSERT ON public\.tareas_bloque/i,
    )
  })
})

describe('20260905000600 · la pantalla dejó de duplicar la regla', () => {
  it('TareasPersonalTab ya no OR-ea requiere_foto con la plantilla', () => {
    // La regla se mudó al trigger. Dejarla también en el cliente sería tener dos
    // lugares donde puede divergir — que es exactamente cómo nació este hueco.
    const tab = readFileSync(
      resolve('src/components/condominios/tabs/TareasPersonalTab.tsx'), 'utf8',
    )
    expect(tab).not.toMatch(/\|\|\s*plantilla\?\.requiere_foto/)
  })
})

describe('20260905000600 · el sandbox conductual está cableado a CI', () => {
  it('el job rls-sandbox ejecuta snapshot_al_crear', () => {
    const wf = readFileSync(resolve('.github/workflows/coverage.yml'), 'utf8')
    expect(wf).toMatch(/supabase\/tests\/snapshot_al_crear\/run\.sh/)
  })

  it('el runner del sandbox existe', () => {
    const runSh = join(resolve('supabase/tests/snapshot_al_crear'), 'run.sh')
    expect(() => readFileSync(runSh, 'utf8')).not.toThrow()
  })
})
