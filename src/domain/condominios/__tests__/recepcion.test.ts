// Contrato del motor único de recepción (paquetería + correspondencia en una
// sola tabla desde 20260829000000). Lo que se protege aquí: que cada clase
// conserve su vocabulario, que una sola búsqueda encuentre la pieza sin saber
// de qué clase es, que la guía se compare como la teclea la gente, y que un
// registro duplicado entre clases se detecte en vez de pasar inadvertido.
import { describe, it, expect, afterEach } from 'vitest'
import {
  construirBandejaRecepcion, buscarEnRecepcion, duplicadosPorGuia,
  normalizarGuia, diasParaVencer, diasEnCustodia, piezasEnRiesgo, piezaAItemRecepcion,
  estadoLabel, subtipoDePieza, claseDePieza,
  esPiezaSaliente, piezaAvisable, etiquetaEstadoResidente, nombreAcuse, nombreAcuseValido,
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
    // 'devuelto' es común a las dos clases desde 20260830000000.
    expect(estadoLabel(correspondencia({ estado: 'devuelto' }))).toBe('Devuelto')
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

describe('diasEnCustodia', () => {
  it('cuenta desde que la pieza entró a recepción', () => {
    expect(diasEnCustodia({ hora_recepcion: '2026-08-01T15:00:00Z' }, '2026-08-18')).toBe(17)
    expect(diasEnCustodia({ hora_recepcion: '2026-08-18T09:00:00Z' }, '2026-08-18')).toBe(0)
  })

  it('NO usa la fecha del documento: una carta vieja recién entregada lleva 0 días en custodia', () => {
    // fecha_pieza puede ser de hace meses (el documento se emitió entonces);
    // la antigüedad en custodia empieza cuando el condominio la recibe.
    const pieza = { hora_recepcion: '2026-08-18T09:00:00Z' }
    expect(diasEnCustodia(pieza, '2026-08-18')).toBe(0)
  })

  it('nunca es negativo aunque el reloj vaya atrás', () => {
    expect(diasEnCustodia({ hora_recepcion: '2026-08-20T09:00:00Z' }, '2026-08-18')).toBe(0)
  })

  it('descarta una hora_recepcion inválida en vez de inventar una antigüedad', () => {
    expect(diasEnCustodia({ hora_recepcion: 'no-es-fecha' }, '2026-08-18')).toBe(0)
  })

  // ── Recepciones nocturnas: el bug que motivó usar dateLocalISO ─────────────
  // `hora_recepcion` es timestamptz y llega en UTC. Cortar los 10 primeros
  // caracteres tomaba el DÍA UTC: una pieza recibida a las 20:30 del 11 en
  // Guatemala (02:30Z del 12) contaba como recibida el 12 y salía un día más
  // joven — justo la clase de error que hace que una pieza cruce el umbral de
  // devolución un día tarde.
  describe('recepción nocturna, por zona horaria', () => {
    const TZ_ORIGINAL = process.env.TZ
    // 20:30 del 11 en Guatemala (UTC-6) = 02:30Z del 12.
    const NOCTURNA = { hora_recepcion: '2026-08-12T02:30:00Z' }

    afterEach(() => { process.env.TZ = TZ_ORIGINAL })

    it('America/Guatemala: cuenta desde el 11, que es el día que se vivió ahí', () => {
      process.env.TZ = 'America/Guatemala'
      expect(diasEnCustodia(NOCTURNA, '2026-08-12')).toBe(1)
      expect(diasEnCustodia(NOCTURNA, '2026-08-11')).toBe(0)
    })

    it('UTC: el mismo instante ya es día 12, y ahí cuenta desde el 12', () => {
      process.env.TZ = 'UTC'
      expect(diasEnCustodia(NOCTURNA, '2026-08-12')).toBe(0)
      expect(diasEnCustodia(NOCTURNA, '2026-08-13')).toBe(1)
    })

    it('la diferencia entre zonas es exactamente el día de calendario local', () => {
      process.env.TZ = 'America/Guatemala'
      const enGuatemala = diasEnCustodia(NOCTURNA, '2026-08-20')
      process.env.TZ = 'UTC'
      const enUTC = diasEnCustodia(NOCTURNA, '2026-08-20')
      expect(enGuatemala - enUTC).toBe(1)
    })
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

// ── Entrada vs salida ───────────────────────────────────────────────────────
// Lo que sale del condominio no se avisa ni se le presenta al residente como
// algo que tiene que ir a recoger: él es quien lo mandó.
describe('dirección de la pieza', () => {
  it('reconoce las dos formas de salir', () => {
    expect(esPiezaSaliente(correspondencia({ direccion: 'saliente' }))).toBe(true)
    expect(esPiezaSaliente(paquete({ direccion: 'saliente_tercero' }))).toBe(true)
    expect(esPiezaSaliente(paquete({ direccion: 'entrante' }))).toBe(false)
  })

  it('una fila sin direccion se trata como entrada (el default de la columna)', () => {
    expect(esPiezaSaliente(paquete({ direccion: undefined as unknown as 'entrante' }))).toBe(false)
  })

  describe('piezaAvisable', () => {
    it('avisa una ENTRADA dirigida a una unidad', () => {
      expect(piezaAvisable({ direccion: 'entrante', unidad_id: 'u1', destinatario_tipo: 'unidad' })).toBe(true)
    })

    it('NO avisa una SALIDA, aunque tenga unidad', () => {
      // El caso del hallazgo: la pieza tenía unidad_id y se avisaba igual.
      expect(piezaAvisable({ direccion: 'saliente', unidad_id: 'u1', destinatario_tipo: 'unidad' })).toBe(false)
      expect(piezaAvisable({ direccion: 'saliente_tercero', unidad_id: 'u1', destinatario_tipo: 'unidad' })).toBe(false)
    })

    it('NO avisa lo dirigido a la administración', () => {
      expect(piezaAvisable({ direccion: 'entrante', unidad_id: null, destinatario_tipo: 'administracion' })).toBe(false)
      // Ni aunque alguien deje una unidad colgada con destinatario 'administracion'.
      expect(piezaAvisable({ direccion: 'entrante', unidad_id: 'u1', destinatario_tipo: 'administracion' })).toBe(false)
    })
  })

  describe('etiquetaEstadoResidente', () => {
    it('una ENTRADA pendiente está "Pendiente de retiro"', () => {
      expect(etiquetaEstadoResidente(correspondencia({ estado: 'pendiente' }))).toBe('Pendiente de retiro')
      expect(etiquetaEstadoResidente(correspondencia({ estado: 'atendido' }))).toBe('Entregada')
    })

    it('una SALIDA no está pendiente de retiro: está en trámite de envío', () => {
      const salida = correspondencia({ direccion: 'saliente' })
      expect(etiquetaEstadoResidente({ ...salida, estado: 'pendiente' })).toBe('En trámite de envío')
      expect(etiquetaEstadoResidente({ ...salida, estado: 'atendido' })).toBe('Enviada')
      expect(etiquetaEstadoResidente({ ...salida, estado: 'devuelto' })).toBe('No se pudo enviar')
    })

    it('un estado desconocido cae al vocabulario de la clase, no a un vacío', () => {
      expect(etiquetaEstadoResidente(paquete({ estado: 'entregado' }))).toBe('Entregado')
    })
  })
})

// ── Acuse ───────────────────────────────────────────────────────────────────
describe('nombre de quien recibe', () => {
  it('normaliza bordes y espacios repetidos', () => {
    expect(nombreAcuse('  Marta   Solís  ')).toBe('Marta Solís')
    expect(nombreAcuse(null)).toBe('')
  })

  it('rechaza el vacío y los rellenos con los que se salta un campo obligatorio', () => {
    expect(nombreAcuseValido('')).toBe(false)
    expect(nombreAcuseValido('   ')).toBe(false)
    expect(nombreAcuseValido('x')).toBe(false)
    expect(nombreAcuseValido('.')).toBe(false)
  })

  it('acepta un nombre corto de verdad', () => {
    expect(nombreAcuseValido('Ana')).toBe(true)
    expect(nombreAcuseValido(' Ana ')).toBe(true)
  })
})
