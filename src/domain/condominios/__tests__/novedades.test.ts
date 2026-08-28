// Pruebas del adaptador de novedades.
//
// LO QUE SE VIGILA. Que las dos fuentes —ruta de limpieza y turnos de personal—
// produzcan la MISMA forma y el MISMO orden. Ese es el punto entero del módulo:
// si divergen, el listado mezclado queda arbitrario y volvemos a tener dos
// pantallas distintas para el mismo problema.
//
// Se prueba sin montar React, como `evidencia.ts`: el criterio de qué cuenta
// como novedad no depende del DOM y no debería necesitar un render para
// verificarse.
import { describe, it, expect } from 'vitest'
import {
  novedadesDeEjecuciones, novedadesDeTareas, TABLA_DE_FUENTE,
} from '../novedades'
import type {
  EjecucionLimpieza, ProgramacionLimpieza, PersonalCondominio,
  BloqueTurno, TareaBloque,
} from '../../../types'

// ── Fábricas ───────────────────────────────────────────────────────────────

const personal = [
  { id: 'per1', nombre: 'Ana', estado: 'activo' },
  { id: 'per2', nombre: 'Beto', estado: 'inactivo' },
] as PersonalCondominio[]

const progs = [
  { id: 'prog1', area: 'Piscina' },
  { id: 'prog2', area: 'Lobby' },
] as ProgramacionLimpieza[]

function ejec(over: Partial<EjecucionLimpieza> = {}): EjecucionLimpieza {
  return {
    id: 'eje1', programacion_id: 'prog1', personal_id: 'per1',
    fecha: '2026-08-20', orden: 0, estado: 'con_novedad',
    foto_urls: [], requiere_mantenimiento: false, created_at: '2026-08-20T10:00:00.000Z',
    ...over,
  } as EjecucionLimpieza
}

const bloques = [
  { id: 'blo1', personal_id: 'per1', fecha: '2026-08-20' },
  { id: 'blo2', personal_id: 'per2', fecha: '2026-08-21' },
] as BloqueTurno[]

function tarea(over: Partial<TareaBloque> = {}): TareaBloque {
  return {
    id: 'tar1', bloque_id: 'blo1', titulo: 'Revisar bombas', orden: 0,
    requiere_foto: false, estado: 'con_observacion', foto_urls: [],
    created_at: '2026-08-20T10:00:00.000Z',
    ...over,
  } as TareaBloque
}

// ── Qué entra al listado ───────────────────────────────────────────────────

describe('novedades · qué cuenta como novedad', () => {
  it('una ejecución sin texto ni bandera no es novedad', () => {
    const r = novedadesDeEjecuciones(progs, [ejec({ novedad: null })], personal)
    expect(r).toHaveLength(0)
  })

  it('la bandera de mantenimiento sola basta, aunque no haya texto', () => {
    // Es la marca operativa importante: si nadie escribió el detalle, la
    // novedad igual tiene que verse — es lo que dispara la orden de trabajo.
    const r = novedadesDeEjecuciones(progs, [ejec({ requiere_mantenimiento: true })], personal)
    expect(r).toHaveLength(1)
    expect(r[0].texto).toMatch(/sin descripción/i)
  })

  it('el texto en blanco no cuenta como texto', () => {
    const r = novedadesDeEjecuciones(progs, [ejec({ novedad: '   ' })], personal)
    expect(r).toHaveLength(0)
  })

  it('una ejecución anulada no sigue pidiendo mantenimiento', () => {
    // La fila se declaró equivocada: su novedad se fue con ella. `VistaRuta` ya
    // las excluía y este listado no — el filtro se salda aquí para las dos
    // fuentes de una vez.
    const r = novedadesDeEjecuciones(progs, [
      ejec({ novedad: 'gotea', requiere_mantenimiento: true, anulada_en: '2026-08-21T09:00:00.000Z' }),
    ], personal)
    expect(r).toHaveLength(0)
  })

  it('una tarea anulada tampoco', () => {
    const r = novedadesDeTareas(bloques, [
      tarea({ novedad: 'gotea', anulada_en: '2026-08-21T09:00:00.000Z' }),
    ], personal)
    expect(r).toHaveLength(0)
  })
})

// ── El rescate del histórico ───────────────────────────────────────────────

describe('novedades · las observaciones viejas no quedan invisibles', () => {
  it('cae a notas_operativo cuando no hay novedad', () => {
    // Antes de que la captura escribiera `novedad`, cerrar «con observación»
    // guardaba el hallazgo sólo en `notas_operativo`. Leer lo nuevo y caer a lo
    // viejo hace que esas filas aparezcan sin reescribir lo que significaban.
    const r = novedadesDeTareas(bloques, [
      tarea({ novedad: null, notas_operativo: 'la reja no cierra' }),
    ], personal)
    expect(r).toHaveLength(1)
    expect(r[0].texto).toBe('la reja no cierra')
  })

  it('cuando están las dos, manda novedad', () => {
    const r = novedadesDeTareas(bloques, [
      tarea({ novedad: 'lo nuevo', notas_operativo: 'lo viejo' }),
    ], personal)
    expect(r[0].texto).toBe('lo nuevo')
  })
})

// ── Misma forma, mismo orden ───────────────────────────────────────────────

describe('novedades · las dos fuentes normalizan igual', () => {
  it('devuelven exactamente las mismas claves', () => {
    // Si una fuente empezara a traer un campo que la otra no, la vista tendría
    // que preguntar de dónde viene cada fila — que es justo lo que este módulo
    // evita.
    const deLimpieza = novedadesDeEjecuciones(progs, [ejec({ novedad: 'x' })], personal)[0]
    const deTarea = novedadesDeTareas(bloques, [tarea({ novedad: 'x' })], personal)[0]
    expect(Object.keys(deTarea).sort()).toEqual(Object.keys(deLimpieza).sort())
  })

  it('la clave de render lleva la fuente: dos tablas pueden repetir id', () => {
    const deLimpieza = novedadesDeEjecuciones(progs, [ejec({ id: 'mismo', novedad: 'x' })], personal)[0]
    const deTarea = novedadesDeTareas(bloques, [tarea({ id: 'mismo', novedad: 'x' })], personal)[0]
    expect(deLimpieza.clave).not.toBe(deTarea.clave)
    // El id de la fila ORIGEN se conserva: es lo que necesita `onAtender`.
    expect(deLimpieza.id).toBe('mismo')
    expect(deTarea.id).toBe('mismo')
  })

  it('ordenan igual: primero la prioridad, después lo más reciente', () => {
    const orden = (ns: { texto: string }[]) => ns.map(n => n.texto)

    const ejecuciones = [
      ejec({ id: 'a', novedad: 'baja-vieja',  prioridad: 'baja',  fecha: '2026-08-01' }),
      ejec({ id: 'b', novedad: 'alta-vieja',  prioridad: 'alta',  fecha: '2026-08-01' }),
      ejec({ id: 'c', novedad: 'media-nueva', prioridad: 'media', fecha: '2026-08-20' }),
      ejec({ id: 'd', novedad: 'alta-nueva',  prioridad: 'alta',  fecha: '2026-08-20' }),
    ]
    const bs = [
      { id: 'b1', personal_id: 'per1', fecha: '2026-08-01' },
      { id: 'b2', personal_id: 'per1', fecha: '2026-08-20' },
    ] as BloqueTurno[]
    const tareas = [
      tarea({ id: 'a', bloque_id: 'b1', novedad: 'baja-vieja',  prioridad: 'baja' }),
      tarea({ id: 'b', bloque_id: 'b1', novedad: 'alta-vieja',  prioridad: 'alta' }),
      tarea({ id: 'c', bloque_id: 'b2', novedad: 'media-nueva', prioridad: 'media' }),
      tarea({ id: 'd', bloque_id: 'b2', novedad: 'alta-nueva',  prioridad: 'alta' }),
    ]

    const esperado = ['alta-nueva', 'alta-vieja', 'media-nueva', 'baja-vieja']
    expect(orden(novedadesDeEjecuciones(progs, ejecuciones, personal))).toEqual(esperado)
    expect(orden(novedadesDeTareas(bs, tareas, personal))).toEqual(esperado)
  })

  it('sin prioridad pesa como baja y no se cuela arriba', () => {
    const r = novedadesDeEjecuciones(progs, [
      ejec({ id: 'a', novedad: 'sin-prioridad', prioridad: null, fecha: '2026-08-20' }),
      ejec({ id: 'b', novedad: 'con-media', prioridad: 'media', fecha: '2026-08-01' }),
    ], personal)
    expect(r.map(n => n.texto)).toEqual(['con-media', 'sin-prioridad'])
  })

  it('una prioridad fuera del dominio cae a null en vez de romper el orden', () => {
    // El tipo de TS afirma el dominio; el dato llega por la red. Una fila vieja
    // o escrita por otra ruta no debe quedar antes que una `alta`.
    const r = novedadesDeTareas(bloques, [
      tarea({ id: 'a', novedad: 'rara', prioridad: 'urgentísima' as never }),
      tarea({ id: 'b', novedad: 'real', prioridad: 'alta' }),
    ], personal)
    expect(r[0].texto).toBe('real')
    expect(r[1].prioridad).toBeNull()
  })
})

// ── Quién y cuándo ─────────────────────────────────────────────────────────

describe('novedades · quién reportó y cuándo', () => {
  it('resuelve el nombre, no el id', () => {
    expect(novedadesDeEjecuciones(progs, [ejec({ novedad: 'x' })], personal)[0].persona).toBe('Ana')
  })

  it('distingue sin asignar de dado de baja', () => {
    // Son cosas distintas para quien administra: una es un hueco de asignación,
    // la otra es un empleado que ya no está pero cuyo reporte sigue valiendo.
    const sinAsignar = novedadesDeEjecuciones(progs, [ejec({ novedad: 'x', personal_id: null })], personal)[0]
    const deBaja = novedadesDeEjecuciones(progs, [ejec({ novedad: 'x', personal_id: 'borrado' })], personal)[0]
    expect(sinAsignar.persona).toBe('Sin asignar')
    expect(deBaja.persona).toBe('Empleado dado de baja')
  })

  it('la tarea hereda fecha y persona de su bloque', () => {
    // La tarea no las tiene: quien la ejecutó y qué día se vio el problema son
    // datos del turno.
    const r = novedadesDeTareas(bloques, [tarea({ bloque_id: 'blo2', novedad: 'x' })], personal)[0]
    expect(r.fecha).toBe('2026-08-21')
    expect(r.persona).toBe('Beto')
  })

  it('sin bloque cae al día del alta antes que quedar fuera del orden', () => {
    const r = novedadesDeTareas([], [tarea({ novedad: 'x' })], personal)[0]
    expect(r.fecha).toBe('2026-08-20')
    expect(r.persona).toBe('Sin asignar')
  })

  it('el título dice DÓNDE: el área en limpieza, la tarea en turnos', () => {
    expect(novedadesDeEjecuciones(progs, [ejec({ novedad: 'x' })], personal)[0].titulo).toBe('Piscina')
    expect(novedadesDeTareas(bloques, [tarea({ novedad: 'x' })], personal)[0].titulo).toBe('Revisar bombas')
  })

  it('un área borrada no esconde la novedad', () => {
    const r = novedadesDeEjecuciones(progs, [ejec({ novedad: 'x', programacion_id: 'fantasma' })], personal)
    expect(r[0].titulo).toBe('Área eliminada')
  })
})

describe('novedades · a qué tabla se escribe', () => {
  it('cada fuente conoce su tabla', () => {
    // Es lo único que `atenderNovedad` necesita saber. Si aparece una tercera
    // fuente, se agrega aquí y no en un `switch` repartido por la UI.
    expect(TABLA_DE_FUENTE.limpieza).toBe('ejecuciones_limpieza')
    expect(TABLA_DE_FUENTE.tarea).toBe('tareas_bloque')
  })
})
