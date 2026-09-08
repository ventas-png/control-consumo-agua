import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Guards ESTÁTICOS de las pausas de la jornada (20260908000300).
//
// ALCANCE, igual que en presenciaCorreccion.test.ts. La conducta —que los
// minutos se descuenten, que la pausa huérfana se cierre, que anular devuelva
// las horas— la prueba supabase/tests/presencia_pausas contra un Postgres real.
// Aquí vive lo que una prueba de conducta no expresa bien: que el código NO
// GANE ciertas cosas. Un `p_inicio timestamptz` colado en `presencia_pausar`
// pasaría todas las invariantes de conducta que hoy existen y destruiría la
// garantía entera — porque estos minutos se restan de lo que se paga.
const RUTA = 'supabase/migrations/20260908000300_presencia_pausas.sql'
const SQL = readFileSync(resolve(RUTA), 'utf8')

/** SQL sin comentarios: lo que la BD ejecuta, no lo que explicamos. */
const codigo = SQL.replace(/--[^\n]*/g, '')

function cuerpo(nombre: string): string {
  const i = codigo.indexOf(`FUNCTION public.${nombre}(`)
  expect(i, `no existe ${nombre}`).toBeGreaterThan(-1)
  return codigo.slice(i, codigo.indexOf('$$;', i))
}

/** La lista de parámetros declarada, hasta el RETURNS. */
function firma(nombre: string): string {
  const c = cuerpo(nombre)
  return c.slice(0, c.search(/\bRETURNS\b/))
}

describe('la hora de la pausa no es un parámetro', () => {
  it('presencia_pausar no recibe instantes, ni duración, ni fecha', () => {
    // El diseño entero. Si el cliente pudiera mandarlos, la persona estaría
    // tecleando los minutos que se restan de su propio pago — y aquí ni
    // siquiera hay foto que sirva de ancla, como sí la tiene el marcaje.
    const f = firma('presencia_pausar')
    for (const malo of ['p_inicio', 'p_fin', 'p_minutos', 'p_hora', 'p_fecha', 'p_duracion']) {
      expect(f, `presencia_pausar recibe ${malo}`).not.toMatch(new RegExp(`\\b${malo}\\b`))
    }
    expect(f).toMatch(/p_project_id\s+uuid/)
    expect(f).toMatch(/p_accion\s+text/)
  })

  it('los dos instantes salen de now(), no de nada que llegue de fuera', () => {
    const c = cuerpo('presencia_pausar')
    expect(c).toMatch(/inicio_en[\s\S]{0,400}now\(\)/)
    expect(c).toMatch(/SET\s+fin_en\s*=\s*now\(\)/)
  })

  it('ajustar corrige la DURACIÓN, y no deja reescribir el inicio', () => {
    // Corregir minutos es corregir el dato que consume la planilla. Reescribir
    // el instante sería devolverle al teclado la hora que este módulo existe
    // para quitarle.
    const f = firma('presencia_pausa_ajustar')
    expect(f).toMatch(/p_minutos\s+numeric/)
    expect(f).not.toMatch(/\bp_inicio\b/)
    expect(cuerpo('presencia_pausa_ajustar')).not.toMatch(/SET[\s\S]{0,200}\binicio_en\s*=/)
  })
})

describe('el motivo es obligatorio en todo lo que mueve horas', () => {
  it.each(['presencia_pausa_ajustar', 'presencia_pausa_anular', 'presencia_pausa_agregar'])(
    '%s exige un motivo de verdad, no un punto', fn => {
      const c = cuerpo(fn)
      expect(c).toMatch(/p_motivo/)
      expect(c, `${fn} acepta cualquier motivo`).toMatch(/length\(v_motivo\)\s*<\s*5/)
    })

  it('y sella quién y cuándo en la base, no en el cliente', () => {
    for (const fn of ['presencia_pausa_ajustar', 'presencia_pausa_anular']) {
      expect(cuerpo(fn)).toMatch(/corregido_por\s*=\s*\(SELECT auth\.uid\(\)\)/)
    }
    expect(codigo).not.toMatch(/p_corregido_(por|en)/)
  })
})

describe('las dos varas de permiso siguen siendo dos', () => {
  it('ajustar y agregar exigen .edit; anular exige .delete', () => {
    // Anular una pausa DEVUELVE horas pagadas, que es tan sensible como
    // quitarlas: es el mismo reparto que hace 20260908000200 con el marcaje.
    expect(cuerpo('presencia_pausa_ajustar')).toMatch(/condominios\.tab\.presencia\.edit/)
    expect(cuerpo('presencia_pausa_agregar')).toMatch(/condominios\.tab\.presencia\.edit/)
    expect(cuerpo('presencia_pausa_anular')).toMatch(/condominios\.tab\.presencia\.delete/)
    expect(cuerpo('presencia_pausa_anular')).not.toMatch(/condominios\.tab\.presencia\.edit/)
  })

  it('cambiar la regla de planilla de un tipo también exige .edit', () => {
    expect(cuerpo('presencia_tipos_pausa_guardar')).toMatch(/condominios\.tab\.presencia\.edit/)
  })

  it('marcar la propia pausa NO exige el permiso del tab', () => {
    // Un conserje no puede tener `condominios.tab.presencia` sin poder editar
    // la asistencia de sus compañeros. La pregunta que se hace la RPC es otra:
    // ¿es esta cuenta el expediente que dice ser?
    const c = cuerpo('presencia_pausar')
    expect(c).not.toMatch(/user_has_permission/)
    expect(c).toMatch(/presencia_ficha_de_usuario/)
  })
})

describe('nada se borra y nada se escribe por fuera de las RPC', () => {
  it('ninguna RPC de pausas ejecuta un DELETE', () => {
    for (const fn of ['presencia_pausar', 'presencia_pausa_ajustar', 'presencia_pausa_anular',
                      'presencia_pausa_agregar']) {
      expect(cuerpo(fn), `${fn} borra filas`).not.toMatch(/\bDELETE\s+FROM\b/i)
    }
  })

  it('presencia_pausas no tiene policy de INSERT, UPDATE ni DELETE', () => {
    // Deliberado: si un cliente pudiera escribir la tabla directamente, podría
    // ponerse los instantes que quisiera. La única puerta son las RPC.
    for (const cmd of ['INSERT', 'UPDATE', 'DELETE']) {
      expect(codigo, `presencia_pausas ganó una policy de ${cmd}`)
        .not.toMatch(new RegExp(`CREATE POLICY[^;]*ON public\\.presencia_pausas[^;]*FOR ${cmd}`, 'i'))
    }
    expect(codigo).toMatch(/CREATE POLICY[^;]*ON public\.presencia_pausas[\s\S]*?FOR SELECT/i)
  })

  it('la duración la sella un trigger: lo que mande el cliente se ignora', () => {
    expect(cuerpo('presencia_pausa_sellar_minutos')).toMatch(/NEW\.minutos\s*:=/)
    expect(codigo).toMatch(/BEFORE INSERT OR UPDATE ON public\.presencia_pausas/)
  })
})

describe('la regla de planilla se congela, y el cómputo la usa', () => {
  it('descuenta se copia del catálogo al crear la pausa, no se lee después', () => {
    // Congelarla es el punto: cambiar la política mañana no puede reescribir en
    // silencio lo que ya se pagó.
    expect(cuerpo('presencia_pausar')).toMatch(/presencia_tipos_pausa_efectivos\(\)/)
    expect(codigo).toMatch(/descuenta\s+boolean\s+NOT NULL,/)
  })

  it('calcular_horas_personal descuenta las pausas y deja la estadía aparte', () => {
    const c = cuerpo('calcular_horas_personal')
    expect(c).toMatch(/presencia_minutos_pausa\(pp\.id, v_tz\)/)
    expect(c).toMatch(/mp\.descontables\s*\/\s*60\.0/)
    // Y no produce horas negativas si alguien ajusta con el dedo torcido.
    expect(c).toMatch(/GREATEST\(0,/)
  })

  it('las nocturnas bajan con la parte de la pausa que cayó de noche', () => {
    // Sin esto se crearía una asimetría NUEVA mientras se arregla la vieja: el
    // recargo nocturno se pagaría sobre la cena que se acaba de descontar.
    expect(cuerpo('calcular_horas_personal')).toMatch(/mp\.descontables_noche/)
    // Y «noche» la define turnos_horas_nocturnas, no una segunda versión.
    expect(cuerpo('presencia_minutos_pausa')).toMatch(/turnos_horas_nocturnas/)
  })

  it('el cómputo ignora las pausas anuladas y las abiertas', () => {
    const c = cuerpo('presencia_minutos_pausa')
    expect(c).toMatch(/anulado_en IS NULL/)
    expect(c).toMatch(/minutos IS NOT NULL/)
  })
})
