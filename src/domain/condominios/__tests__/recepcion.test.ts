// Contrato del motor único de recepción (paquetería + correspondencia en una
// sola tabla desde 20260829000000). Lo que se protege aquí: que cada clase
// conserve su vocabulario, que una sola búsqueda encuentre la pieza sin saber
// de qué clase es, que la guía se compare como la teclea la gente, y que un
// registro duplicado entre clases se detecte en vez de pasar inadvertido.
import { describe, it, expect } from 'vitest'
import {
  construirBandejaRecepcion, buscarEnRecepcion, duplicadosPorGuia,
  normalizarGuia, diasParaVencer, piezasEnRiesgo, piezaAItemRecepcion,
  estadoLabel, subtipoDePieza, claseDePieza,
} from '../recepcion'
import type { PiezaRecepcion } from '../../../types'

function paquete(over: Partial<PiezaRecepcion> = {}): PiezaRecepcion {
  return {
    id: 'p1', company_id: 'c', project_id: 'p', unidad_id: 'u1',
    clase: 'paquete', destinatario_tipo: 'unidad', prioridad: 'normal',
    descripcion: 'Caja Amazon', tipo: 'paquete', estado: 'pendiente',
    direccion: 'entrante',
    hora_recepcion: '2026-08-10T15:00:00Z', created_at: '2026-08-10T15:00:00Z',
    ...over,
  }
}

function correspondencia(over: Partial<PiezaRecepcion> = {}): PiezaRecepcion {
  return {
    id: 'c1', company_id: 'c', project_id: 'p', unidad_id: null,
    clase: 'correspondencia', destinatario_tipo: 'administracion', prioridad: 'normal',
    descripcion: 'Citación municipal', tipo: 'carta', estado: 'pendiente',
    direccion: 'entrante', fecha_pieza: '2026-08-12',
    hora_recepcion: '2026-08-12T09:00:00Z', created_at: '2026-08-12T09:00:00Z',
    ...over,
  }
}

describe('vocabulario por clase', () => {
  it('resuelve subtipo y estado con el diccionario de la clase de la fila', () => {
    expect(subtipoDePieza(paquete({ tipo: 'sobre' })).label).toBe('Sobre')
    expect(subtipoDePieza(correspondencia({ tipo: 'notificacion_legal' })).label).toBe('Notif. Legal')
    expect(estadoLabel(paquete({ estado: 'devuelto' }))).toBe('Devuelto')
    expect(estadoLabel(correspondencia({ estado: 'archivado' }))).toBe('Archivado')
  })

  it('cae a paquete cuando la fila llega sin clase (caché anterior a la unificación)', () => {
    expect(claseDePieza({ clase: undefined as unknown as PiezaRecepcion['clase'] })).toBe('paquete')
  })

  it('un subtipo desconocido no rompe: usa el por defecto de su clase', () => {
    expect(subtipoDePieza(paquete({ tipo: 'inexistente' as PiezaRecepcion['tipo'] })).label).toBe('Paquete')
    expect(subtipoDePieza(correspondencia({ tipo: 'inexistente' as PiezaRecepcion['tipo'] })).label).toBe('Carta')
  })
})

describe('normalización a ItemRecepcion', () => {
  it('unifica las dos salidas en una sola dirección legible', () => {
    // 'saliente_tercero' (retiro por un tercero) y 'saliente' (despacho de la
    // administración) son flujos distintos, pero ambos son salida.
    expect(piezaAItemRecepcion(paquete({ direccion: 'saliente_tercero' })).direccion).toBe('salida')
    expect(piezaAItemRecepcion(correspondencia({ direccion: 'saliente' })).direccion).toBe('salida')
    expect(piezaAItemRecepcion(paquete({ direccion: 'entrante' })).direccion).toBe('entrada')
    expect(piezaAItemRecepcion(paquete({ direccion: null })).direccion).toBe('entrada')
  })

  it('marca como cerrada la pieza que salió de custodia, con el estado de su clase', () => {
    expect(piezaAItemRecepcion(paquete({ estado: 'entregado' })).cerrado).toBe(true)
    expect(piezaAItemRecepcion(paquete({ estado: 'devuelto' })).cerrado).toBe(true)
    expect(piezaAItemRecepcion(correspondencia({ estado: 'atendido' })).cerrado).toBe(true)
    expect(piezaAItemRecepcion(correspondencia({ estado: 'pendiente' })).cerrado).toBe(false)
  })

  it('en una salida por tercero el destinatario es quien está autorizado a retirar', () => {
    const item = piezaAItemRecepcion(paquete({ direccion: 'saliente_tercero', autorizado_nombre: 'Ana Ruiz' }))
    expect(item.destinatario).toBe('Ana Ruiz')
  })

  it('manda cada clase a la pestaña donde se administra', () => {
    expect(piezaAItemRecepcion(paquete()).tabId).toBe('paqueteria')
    expect(piezaAItemRecepcion(correspondencia()).tabId).toBe('correspondencia')
  })
})

describe('construirBandejaRecepcion', () => {
  it('mezcla ambas clases con la más reciente primero', () => {
    const bandeja = construirBandejaRecepcion({
      piezas: [
        paquete({ id: 'p1', hora_recepcion: '2026-08-10T15:00:00Z' }),
        correspondencia({ id: 'c1', hora_recepcion: '2026-08-12T09:00:00Z' }),
      ],
    })
    expect(bandeja.map(i => i.id)).toEqual(['c1', 'p1'])
  })

  it('excluye la clase que el usuario no tiene permiso de ver', () => {
    const piezas = [paquete(), correspondencia()]
    expect(construirBandejaRecepcion({ piezas, incluirCorrespondencia: false }).map(i => i.origen))
      .toEqual(['paquete'])
    expect(construirBandejaRecepcion({ piezas, incluirPaqueteria: false }).map(i => i.origen))
      .toEqual(['correspondencia'])
  })
})

describe('buscarEnRecepcion', () => {
  const bandeja = construirBandejaRecepcion({
    piezas: [
      paquete({ id: 'p1', num_guia: 'AB-12 34', empresa_mensajeria: 'DHL', unidad_nombre: 'Apto 2A' }),
      correspondencia({ id: 'c1', tipo: 'notificacion_legal', remitente: 'Municipalidad' }),
    ],
  })

  it('devuelve todo cuando la consulta está vacía', () => {
    expect(buscarEnRecepcion(bandeja, '   ')).toHaveLength(2)
  })

  it('ignora acentos y mayúsculas', () => {
    expect(buscarEnRecepcion(bandeja, 'CITACION').map(i => i.id)).toEqual(['c1'])
    expect(buscarEnRecepcion(bandeja, 'citación').map(i => i.id)).toEqual(['c1'])
  })

  it('encuentra la guía como la teclea la gente, con o sin separadores', () => {
    for (const consulta of ['#AB-1234', 'ab1234', 'AB 12 34']) {
      expect(buscarEnRecepcion(bandeja, consulta).map(i => i.id)).toEqual(['p1'])
    }
  })

  it('exige que TODOS los términos coincidan (AND), no cualquiera', () => {
    expect(buscarEnRecepcion(bandeja, 'dhl apto').map(i => i.id)).toEqual(['p1'])
    expect(buscarEnRecepcion(bandeja, 'dhl municipalidad')).toHaveLength(0)
  })

  it('busca también por la etiqueta legible del subtipo', () => {
    expect(buscarEnRecepcion(bandeja, 'legal').map(i => i.id)).toEqual(['c1'])
  })
})

describe('normalizarGuia', () => {
  it('reduce a alfanuméricos en minúscula', () => {
    expect(normalizarGuia(' A-1 234/b ')).toBe('a1234b')
  })
  it('trata null y vacío como cadena vacía (no agrupa piezas sin guía)', () => {
    expect(normalizarGuia(null)).toBe('')
    expect(normalizarGuia('---')).toBe('')
  })
})

describe('duplicadosPorGuia', () => {
  it('detecta la misma guía registrada en las dos clases', () => {
    const bandeja = construirBandejaRecepcion({
      piezas: [paquete({ id: 'p1', num_guia: 'AB1234' }), correspondencia({ id: 'c1', num_guia: 'ab-1234' })],
    })
    const grupos = duplicadosPorGuia(bandeja)
    expect(grupos).toHaveLength(1)
    expect(grupos[0].map(i => i.id).sort()).toEqual(['c1', 'p1'])
  })

  it('no marca duplicado cuando la repetición está dentro de la misma clase', () => {
    // Dos paquetes con la misma guía son un envío partido en bultos, no un
    // registro duplicado entre módulos.
    const bandeja = construirBandejaRecepcion({
      piezas: [paquete({ id: 'p1', num_guia: 'AB1234' }), paquete({ id: 'p2', num_guia: 'AB1234' })],
    })
    expect(duplicadosPorGuia(bandeja)).toHaveLength(0)
  })

  it('no agrupa piezas sin guía', () => {
    const bandeja = construirBandejaRecepcion({
      piezas: [paquete({ id: 'p1', num_guia: null }), correspondencia({ id: 'c1', num_guia: null })],
    })
    expect(duplicadosPorGuia(bandeja)).toHaveLength(0)
  })
})

describe('diasParaVencer', () => {
  it('cuenta días de calendario, negativo si ya venció', () => {
    expect(diasParaVencer('2026-08-20', '2026-08-18')).toBe(2)
    expect(diasParaVencer('2026-08-18', '2026-08-18')).toBe(0)
    expect(diasParaVencer('2026-08-15', '2026-08-18')).toBe(-3)
  })
  it('devuelve NaN ante una fecha inválida en vez de un número engañoso', () => {
    expect(diasParaVencer('no-es-fecha', '2026-08-18')).toBeNaN()
  })
})

describe('piezasEnRiesgo', () => {
  const hoy = '2026-08-18'

  it('separa vencidas de por vencer y respeta la ventana de aviso', () => {
    const { vencidas, porVencer } = piezasEnRiesgo([
      correspondencia({ id: 'vencida', fecha_limite: '2026-08-15' }),
      correspondencia({ id: 'hoy', fecha_limite: '2026-08-18' }),
      correspondencia({ id: 'pronto', fecha_limite: '2026-08-21' }),
      correspondencia({ id: 'lejana', fecha_limite: '2026-09-30' }),
    ], hoy)
    expect(vencidas.map(c => c.id)).toEqual(['vencida'])
    expect(porVencer.map(c => c.id)).toEqual(['hoy', 'pronto'])
  })

  it('ignora las piezas ya cerradas y las que no tienen plazo', () => {
    const { vencidas, porVencer } = piezasEnRiesgo([
      correspondencia({ id: 'atendida', fecha_limite: '2026-08-01', estado: 'atendido' }),
      correspondencia({ id: 'archivada', fecha_limite: '2026-08-01', estado: 'archivado' }),
      correspondencia({ id: 'sin-plazo', fecha_limite: null }),
    ], hoy)
    expect(vencidas).toHaveLength(0)
    expect(porVencer).toHaveLength(0)
  })
})
