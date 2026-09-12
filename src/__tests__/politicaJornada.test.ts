import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Guards ESTÁTICOS de la vara de la jornada (20260912020300).
//
// ALCANCE, igual que en presenciaPausas.test.ts. La conducta —que la vara se
// congele, que no mueva el cómputo— la prueba supabase/tests/politica_jornada
// contra un Postgres real. Aquí vive lo que una prueba de conducta no expresa
// bien: que esta migración NO GANE efectos.
//
// Es lo más importante que se puede afirmar de ella. Se anuncia como inerte, y
// una migración inerte que toca una función de cómputo mueve la planilla sin
// que nadie lo note hasta que alguien cobra de menos.
const RUTA = 'supabase/migrations/20260912020300_politica_de_jornada.sql'
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
    for (const fn of ['turnos_politica_efectiva\\(uuid, uuid, uuid\\)', 'turnos_sellar_politica\\(\\)']) {
      expect(codigo, `${fn} quedó expuesta`)
        .toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${fn} FROM PUBLIC, anon, authenticated`))
    }
  })
})

describe('el cupo no puede cruzar de inquilino', () => {
  it('la jornada se referencia por la TERNA, no sólo por su id', () => {
    // La FK simple sólo comprueba que la plantilla exista, no de quién es. Con
    // ella sola, supabase-js podía mandar el company_id propio y un
    // plantilla_horario_id ajeno: las policies veían un tenant correcto y la
    // fila entraba. Este guard falla si alguien la reintroduce.
    expect(codigo).toMatch(
      /FOREIGN KEY\s*\(\s*plantilla_horario_id\s*,\s*company_id\s*,\s*project_id\s*\)\s*REFERENCES\s+public\.plantillas_horario\s*\(\s*id\s*,\s*company_id\s*,\s*project_id\s*\)/i,
    )
    expect(codigo, 'volvió la FK simple, que no mira el tenant')
      .not.toMatch(/plantilla_horario_id\s+uuid\s+NOT NULL\s+REFERENCES\s+public\.plantillas_horario\s*\(\s*id\s*\)/i)
  })

  it('la RLS mira el tenant REAL de la plantilla, no el que venga en la fila', () => {
    // Cuatro policies, y las cuatro tienen que preguntar por la jornada. Una
    // que sólo compare `company_id` estaría gateando sobre un dato del cliente.
    const policies = codigo.match(/CREATE POLICY "plantilla_cupos_pausa_\w+"[\s\S]*?;/g) ?? []
    expect(policies).toHaveLength(4)
    for (const p of policies) {
      expect(p, `una policy de cupos no consulta la jornada:\n${p}`)
        .toMatch(/turnos_puede_administrar_jornada\s*\(\s*plantilla_horario_id\s*\)/)
    }
  })

  it('la OCURRENCIA también queda anclada a la terna', () => {
    // La FK de plantilla_cupos_pausa cierra la definición; ésta cierra el
    // bloque. Sin ella, un bloque con el company_id correcto podía nombrar la
    // jornada de otra empresa — y la vara ajena terminaba congelada dentro.
    expect(codigo).toMatch(
      /ADD CONSTRAINT bloques_turno_horario_fk\s+FOREIGN KEY\s*\(\s*plantilla_horario_id\s*,\s*company_id\s*,\s*project_id\s*\)\s*REFERENCES\s+public\.plantillas_horario\s*\(\s*id\s*,\s*company_id\s*,\s*project_id\s*\)/i,
    )
  })

  it('el ON DELETE nombra la única columna que puede quedar en NULL', () => {
    // `ON DELETE SET NULL` a secas sobre una FK compuesta intentaría vaciar
    // también company_id y project_id, que son NOT NULL: reventaría al borrar
    // una jornada, en producción y con la transacción a medias.
    // Acotado a la SENTENCIA, no al archivo: los COMMENT ON la nombran en
    // prosa y son literales SQL, así que sobreviven al borrado de comentarios.
    const i = codigo.indexOf('ADD CONSTRAINT bloques_turno_horario_fk')
    expect(i, 'no está la FK compuesta de bloques_turno').toBeGreaterThan(-1)
    const sentencia = codigo.slice(i, codigo.indexOf(';', i))
    expect(sentencia).toMatch(/ON DELETE SET NULL\s*\(\s*plantilla_horario_id\s*\)/i)
    // Y ningún SET NULL sin lista: el `\s*` va DENTRO del lookahead, o la
    // aserción se satisface a sí misma retrocediendo a cero espacios.
    expect(sentencia, 'un SET NULL sin columnas alcanzaría a company_id')
      .not.toMatch(/ON DELETE SET NULL(?!\s*\()/i)
  })

  it('el trigger resuelve la jornada por la terna de NEW, no por el uuid', () => {
    const i = codigo.indexOf('FUNCTION public.turnos_sellar_politica(')
    const cuerpo = codigo.slice(i, codigo.indexOf('$$;', i))
    expect(cuerpo).toMatch(
      /turnos_politica_efectiva\(\s*NEW\.plantilla_horario_id\s*,\s*NEW\.company_id\s*,\s*NEW\.project_id\s*\)/,
    )
  })

  it('el trigger es SECURITY DEFINER, o el DML de authenticated no puede dispararlo', () => {
    // turnos_politica_efectiva tiene EXECUTE revocado a authenticated. Una
    // función de trigger sin SECURITY DEFINER corre con los privilegios de
    // quien dispara el trigger, así que un INSERT legítimo moría con
    // «permission denied for function turnos_politica_efectiva».
    const i = codigo.indexOf('FUNCTION public.turnos_sellar_politica(')
    const cabecera = codigo.slice(i, codigo.indexOf('AS $$', i))
    expect(cabecera).toMatch(/SECURITY DEFINER/)
    expect(cabecera, 'un SECURITY DEFINER sin search_path fijado es superficie')
      .toMatch(/SET search_path = ''/)
  })

  it('desvincular la jornada CONSERVA la vara congelada', () => {
    // Es el camino que recorre ON DELETE SET NULL al borrar una jornada.
    // Recalcular ahí pondría `politica` en NULL en todos los bloques que esa
    // jornada rigió: meses de historia sin contra qué medirse.
    const i = codigo.indexOf('FUNCTION public.turnos_sellar_politica(')
    const cuerpo = codigo.slice(i, codigo.indexOf('$$;', i))
    expect(cuerpo).toMatch(/NEW\.plantilla_horario_id IS NOT NULL\s*\n?\s*AND NEW\.plantilla_horario_id IS DISTINCT FROM OLD\.plantilla_horario_id/)
    expect(cuerpo).toMatch(/NEW\.politica\s*:=\s*OLD\.politica/)
  })

  it('la foto de la vara empareja cupos por la terna completa', () => {
    // Segundo candado: aunque la FK se aflojara, turnos_politica_efectiva no
    // puede recoger el cupo de otro tenant y congelarlo en un bloque.
    const fn = codigo.slice(
      codigo.indexOf('FUNCTION public.turnos_politica_efectiva'),
      codigo.indexOf('COMMENT ON FUNCTION public.turnos_politica_efectiva'),
    )
    expect(fn).toMatch(/c\.company_id\s*=\s*ph\.company_id/)
    expect(fn).toMatch(/c\.project_id\s*=\s*ph\.project_id/)
  })
})

describe('los privilegios de la tabla se declaran, no se heredan', () => {
  it('anon y PUBLIC quedan fuera, y authenticated sólo con su CRUD', () => {
    expect(codigo).toMatch(/REVOKE ALL ON TABLE public\.plantilla_cupos_pausa FROM PUBLIC, anon/)
    expect(codigo).toMatch(
      /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.plantilla_cupos_pausa TO authenticated/,
    )
    expect(codigo).toMatch(/GRANT ALL\s+ON TABLE public\.plantilla_cupos_pausa TO service_role/)
  })

  it('la RLS es FORCE: ni el dueño de la tabla se la salta', () => {
    expect(codigo).toMatch(/ALTER TABLE public\.plantilla_cupos_pausa FORCE ROW LEVEL SECURITY/)
  })
})

describe('guardar la jornada y sus cupos es atómico', () => {
  it('la RPC es SECURITY INVOKER: no puede más que quien la llama', () => {
    const fn = codigo.slice(codigo.indexOf('FUNCTION public.turnos_guardar_jornada'))
    expect(fn).toMatch(/SECURITY INVOKER/)
    expect(fn, 'la RPC se volvió DEFINER sin reimplementar el gateo')
      .not.toMatch(/SECURITY DEFINER/)
    expect(fn).toMatch(/SET search_path = ''/)
  })

  it('borra e inserta los cupos DENTRO de la misma función', () => {
    // Es lo único que aporta: si el DELETE y el INSERT volvieran a estar en dos
    // llamadas del cliente, un fallo entre medias deja la jornada sin cupos.
    const fn = codigo.slice(codigo.indexOf('FUNCTION public.turnos_guardar_jornada'))
    expect(fn).toMatch(/DELETE FROM public\.plantilla_cupos_pausa/)
    expect(fn).toMatch(/INSERT INTO public\.plantilla_cupos_pausa/)
  })

  it('el UPDATE no deja mover una jornada de tenant', () => {
    // Sólo la lista de SET: en el WHERE los dos sí aparecen, y ahí es donde
    // tienen que estar — acotando qué fila se toca, no cambiándola de dueño.
    const desde = codigo.indexOf('UPDATE public.plantillas_horario SET')
    const set = codigo.slice(desde, codigo.indexOf('WHERE id = p_plantilla_id', desde))
    expect(set, 'el UPDATE reasigna el company_id').not.toMatch(/company_id\s*=/)
    expect(set, 'el UPDATE reasigna el project_id').not.toMatch(/project_id\s*=/)
  })

  it('anon no la puede ejecutar', () => {
    expect(codigo).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.turnos_guardar_jornada\([^)]*\) FROM PUBLIC, anon/,
    )
  })
})
