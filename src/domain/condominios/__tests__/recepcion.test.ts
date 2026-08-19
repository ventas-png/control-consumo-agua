// Contrato del modelo común de recepción (Paquetería ↔ Correspondencia).
// Lo que se protege aquí es lo que la bandeja unificada promete: una sola
// búsqueda encuentra la pieza sin importar en qué módulo la registraron, la
// guía se compara con la forma en que la gente la teclea, y un registro
// duplicado entre módulos se detecta en vez de pasar inadvertido.
import { describe, it, expect } from 'vitest'
import {
  construirBandejaRecepcion, buscarEnRecepcion, duplicadosPorGuia,
  normalizarGuia, diasParaVencer, correspondenciaEnRiesgo,
  paqueteAItemRecepcion, correspondenciaAItemRecepcion,
} from '../recepcion'
import type { CorrespondenciaCondominio, PaqueteRecibido } from '../../../types'

function paquete(over: Partial<PaqueteRecibido> = {}): PaqueteRecibido {
  return {
    id: 'p1', company_id: 'c', project_id: 'p', unidad_id: 'u1',
    descripcion: 'Caja Amazon', tipo: 'paquete', estado: 'pendiente',
    hora_recepcion: '2026-08-10T15:00:00Z', created_at: '2026-08-10T15:00:00Z',
    ...over,
  }
}

function correspondencia(over: Partial<CorrespondenciaCondominio> = {}): CorrespondenciaCondominio {
  return {
    id: 'c1', company_id: 'c', project_id: 'p',
    tipo: 'entrada', categoria: 'carta', asunto: 'Citación municipal',
    fecha: '2026-08-12', prioridad: 'normal', estado: 'pendiente',
    created_at: '2026-08-12T09:00:00Z',
    ...over,
  }
}

describe('normalización a ItemRecepcion', () => {
  it('unifica el vocabulario de dirección de los dos módulos', () => {
    expect(paqueteAItemRecepcion(paquete({ direccion: 'saliente_tercero' })).direccion).toBe('salida')
    expect(paqueteAItemRecepcion(paquete({ direccion: 'entrante' })).direccion).toBe('entrada')
    // Paquetería vieja: `direccion` puede venir null (filas previas a la columna).
    expect(paqueteAItemRecepcion(paquete({ direccion: null })).direccion).toBe('entrada')
    expect(correspondenciaAItemRecepcion(correspondencia({ tipo: 'salida' })).direccion).toBe('salida')
  })

  it('marca como cerrada cualquier pieza que ya salió de custodia, con el estado propio de cada módulo', () => {
    expect(paqueteAItemRecepcion(paquete({ estado: 'entregado' })).cerrado).toBe(true)
    expect(paqueteAItemRecepcion(paquete({ estado: 'devuelto' })).cerrado).toBe(true)
    expect(correspondenciaAItemRecepcion(correspondencia({ estado: 'atendido' })).cerrado).toBe(true)
    expect(correspondenciaAItemRecepcion(correspondencia({ estado: 'pendiente' })).cerrado).toBe(false)
  })

  it('en una salida por tercero el destinatario es quien está autorizado a retirar', () => {
    const item = paqueteAItemRecepcion(paquete({ direccion: 'saliente_tercero', autorizado_nombre: 'Ana Ruiz' }))
    expect(item.destinatario).toBe('Ana Ruiz')
  })
})

describe('construirBandejaRecepcion', () => {
  it('mezcla ambos orígenes con el más reciente primero', () => {
    const bandeja = construirBandejaRecepcion({
      paquetes: [paquete({ id: 'p1', hora_recepcion: '2026-08-10T15:00:00Z' })],
      correspondencia: [correspondencia({ id: 'c1', fecha: '2026-08-12' })],
    })
    expect(bandeja.map(i => i.id)).toEqual(['c1', 'p1'])
  })

  it('excluye el módulo que el usuario no tiene permiso de ver', () => {
    const args = { paquetes: [paquete()], correspondencia: [correspondencia()] }
    expect(construirBandejaRecepcion({ ...args, incluirCorrespondencia: false }).map(i => i.origen))
      .toEqual(['paqueteria'])
    expect(construirBandejaRecepcion({ ...args, incluirPaqueteria: false }).map(i => i.origen))
      .toEqual(['correspondencia'])
  })
})

describe('buscarEnRecepcion', () => {
  const bandeja = construirBandejaRecepcion({
    paquetes: [paquete({ id: 'p1', num_guia: 'AB-12 34', empresa_mensajeria: 'DHL', unidad_nombre: 'Apto 2A' })],
    correspondencia: [correspondencia({ id: 'c1', categoria: 'notificacion_legal', remitente: 'Municipalidad' })],
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

  it('busca también por la clase legible de la pieza', () => {
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
  it('detecta la misma guía registrada en los dos módulos', () => {
    const bandeja = construirBandejaRecepcion({
      paquetes: [paquete({ id: 'p1', num_guia: 'AB1234' })],
      correspondencia: [correspondencia({ id: 'c1', numero_guia: 'ab-1234' })],
    })
    const grupos = duplicadosPorGuia(bandeja)
    expect(grupos).toHaveLength(1)
    expect(grupos[0].map(i => i.id).sort()).toEqual(['c1', 'p1'])
  })

  it('no marca duplicado cuando la repetición está dentro del mismo módulo', () => {
    // Dos paquetes con la misma guía son un envío partido en bultos, no un
    // registro duplicado entre módulos.
    const bandeja = construirBandejaRecepcion({
      paquetes: [paquete({ id: 'p1', num_guia: 'AB1234' }), paquete({ id: 'p2', num_guia: 'AB1234' })],
      correspondencia: [],
    })
    expect(duplicadosPorGuia(bandeja)).toHaveLength(0)
  })

  it('no agrupa piezas sin guía', () => {
    const bandeja = construirBandejaRecepcion({
      paquetes: [paquete({ id: 'p1', num_guia: null })],
      correspondencia: [correspondencia({ id: 'c1', numero_guia: null })],
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

describe('correspondenciaEnRiesgo', () => {
  const hoy = '2026-08-18'

  it('separa vencidas de por vencer y respeta la ventana de aviso', () => {
    const { vencidas, porVencer } = correspondenciaEnRiesgo([
      correspondencia({ id: 'vencida', fecha_limite: '2026-08-15' }),
      correspondencia({ id: 'hoy', fecha_limite: '2026-08-18' }),
      correspondencia({ id: 'pronto', fecha_limite: '2026-08-21' }),
      correspondencia({ id: 'lejana', fecha_limite: '2026-09-30' }),
    ], hoy)
    expect(vencidas.map(c => c.id)).toEqual(['vencida'])
    expect(porVencer.map(c => c.id)).toEqual(['hoy', 'pronto'])
  })

  it('ignora las piezas ya cerradas y las que no tienen plazo', () => {
    const { vencidas, porVencer } = correspondenciaEnRiesgo([
      correspondencia({ id: 'atendida', fecha_limite: '2026-08-01', estado: 'atendido' }),
      correspondencia({ id: 'archivada', fecha_limite: '2026-08-01', estado: 'archivado' }),
      correspondencia({ id: 'sin-plazo', fecha_limite: null }),
    ], hoy)
    expect(vencidas).toHaveLength(0)
    expect(porVencer).toHaveLength(0)
  })
})
