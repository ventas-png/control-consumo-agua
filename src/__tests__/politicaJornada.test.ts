import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Guards ESTÁTICOS de la vara de la jornada (20260909000000).
//
// ALCANCE, igual que en presenciaPausas.test.ts. La conducta —que la vara se
// congele, que no mueva el cómputo— la prueba supabase/tests/politica_jornada
// contra un Postgres real. Aquí vive lo que una prueba de conducta no expresa
// bien: que esta migración NO GANE efectos.
//
// Es lo más importante que se puede afirmar de ella. Se anuncia como inerte, y
// una migración inerte que toca una función de cómputo mueve la planilla sin
// que nadie lo note hasta que alguien cobra de menos.
const RUTA = 'supabase/migrations/20260909000000_politica_de_jornada.sql'
const SQL = readFileSync(resolve(RUTA), 'utf8')

/** SQL sin comentarios: lo que la BD ejecuta, no lo que explicamos. */
const codigo = SQL.replace(/--[^\n]*/g, '')

describe('la fase 1 es inerte: declara y nada más', () => {
  it('no redeclara ninguna función de cómputo de horas', () => {
    // Si esta migración necesitara tocarlas, dejaría de ser una declaración y
    // habría que medir su efecto en la planilla antes de fusionarla.
    for (const fn of ['calcular_horas_personal', 'turnos_horas_jornada',
                      'turnos_horas_nocturnas', 'presencia_minutos_pausa']) {
      expect(codigo, `la fase 1 redeclara ${fn}`)
        .not.toMatch(new RegExp(`FUNCTION\\s+public\\.${fn}\\s*\\(`, 'i'))
    }
  })

  it('no toca presencia_personal ni presencia_pausas', () => {
    // La vara describe lo ESPERADO. Lo ocurrido ya está escrito y no se corrige
    // declarando una política.
    for (const tabla of ['presencia_personal', 'presencia_pausas']) {
      expect(codigo, `la fase 1 escribe en ${tabla}`)
        .not.toMatch(new RegExp(`(UPDATE|DELETE\\s+FROM|INSERT\\s+INTO)\\s+public\\.${tabla}`, 'i'))
    }
  })

  it('no rellena la vara hacia atrás', () => {
    // Un UPDATE de bloques_turno poniendo `politica` sería aplicarle a un mes
    // cerrado la política de hoy, que es justo lo que congelarla evita.
    expect(codigo).not.toMatch(/UPDATE\s+public\.bloques_turno/i)
  })
})

describe('la vara se congela, y la escribe el servidor', () => {
  it('la sella un trigger BEFORE, no el cliente', () => {
    expect(codigo).toMatch(/NEW\.politica\s*:=/)
    expect(codigo).toMatch(/BEFORE INSERT OR UPDATE ON public\.bloques_turno/)
  })

  it('solo se refresca al crear el bloque o si cambia de jornada', () => {
    const i = codigo.indexOf('FUNCTION public.turnos_sellar_politica(')
    const cuerpo = codigo.slice(i, codigo.indexOf('$$;', i))
    expect(cuerpo).toMatch(/TG_OP\s*=\s*'INSERT'/)
    expect(cuerpo).toMatch(/NEW\.plantilla_horario_id IS DISTINCT FROM OLD\.plantilla_horario_id/)
    // Y en cualquier otro UPDATE se conserva la foto anterior, explícitamente.
    expect(cuerpo).toMatch(/NEW\.politica\s*:=\s*OLD\.politica/)
  })

  it('una sola función arma la foto, para que no puedan divergir', () => {
    const i = codigo.indexOf('FUNCTION public.turnos_sellar_politica(')
    expect(codigo.slice(i)).toMatch(/turnos_politica_efectiva\(/)
  })
})

describe('los tres tramos no se pueden declarar al revés', () => {
  it('el CHECK exige que el tope compensable supere la tolerancia', () => {
    // Sin esto, subir la tolerancia sin mirar el tope vacía el tramo
    // compensable y degrada la política a «todo se debita» en silencio.
    expect(codigo).toMatch(/demora_compensable_hasta_min\s*>\s*tolerancia_entrada_min/)
    // Y el 0 sigue siendo válido: es la forma de decir que no hay tramo.
    expect(codigo).toMatch(/demora_compensable_hasta_min\s*=\s*0/)
  })

  it('no se inventa un segundo umbral de gracia', () => {
    // El primer tramo es `tolerancia_entrada_min`, la MISMA vara que ya decide
    // la tardanza en presencia_marcar. Dos varas para lo mismo divergen.
    expect(codigo).not.toMatch(/gracia_min|demora_gracia|tolerancia_demora/i)
  })
})

describe('quién puede fijar la vara', () => {
  it('los cupos los gobierna el permiso del tab de turnos, como la jornada', () => {
    const policies = codigo.match(/CREATE POLICY[\s\S]*?ON public\.plantilla_cupos_pausa[\s\S]*?;/gi) ?? []
    expect(policies.length, 'faltan policies en plantilla_cupos_pausa').toBe(4)
    for (const p of policies) {
      expect(p).toMatch(/condominios\.tab\.turnos/)
    }
  })

  it('las funciones internas no se le conceden a authenticated', () => {
    for (const fn of ['turnos_politica_efectiva\\(uuid\\)', 'turnos_sellar_politica\\(\\)']) {
      expect(codigo, `${fn} quedó expuesta`)
        .toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn} FROM PUBLIC, anon, authenticated`))
    }
  })
})
