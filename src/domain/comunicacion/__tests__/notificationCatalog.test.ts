// Contrato de la clasificación del feed de la campana: cada `tipo` que emite un
// productor cae en su grupo, lo desconocido nunca se pierde, y `seccion` sólo
// navega cuando es un AppSection real.
import { describe, it, expect } from 'vitest'
import type { UserNotification } from '../../../types'
import {
  groupOf,
  groupCounts,
  resumenNoLeidas,
  toAppSection,
} from '../notificationCatalog'

function notif(tipo: string, leido = false): UserNotification {
  return {
    id: `${tipo}-${leido}-${Math.random()}`,
    user_id: 'u1',
    tipo,
    titulo: tipo,
    leido,
    created_at: '2026-08-14T00:00:00Z',
  }
}

describe('groupOf', () => {
  it('clasifica los tipos que emiten los productores', () => {
    expect(groupOf('mensaje')).toBe('mensajes')
    expect(groupOf('difusion')).toBe('difusiones')
    expect(groupOf('anuncio')).toBe('difusiones')
    expect(groupOf('solicitud')).toBe('solicitudes')
    expect(groupOf('reserva')).toBe('reservas')
    expect(groupOf('seguridad')).toBe('cuenta')
    expect(groupOf('ruta_recordatorio')).toBe('operacion')
    expect(groupOf('cierre_ciclo_automatico')).toBe('operacion')
    expect(groupOf('alerta_notificaciones')).toBe('operacion')
  })

  // Las familias crecen (paquete_pendiente, paquete_retirado, …): el prefijo
  // evita tener que tocar el catálogo por cada variante nueva.
  it('agrupa por prefijo las familias de tipos', () => {
    expect(groupOf('paquete_pendiente')).toBe('paquetes')
    expect(groupOf('paquete_retirado')).toBe('paquetes')
    // La correspondencia es su propio grupo: un aviso de notificación legal no
    // se lee igual que "llegó una caja".
    expect(groupOf('correspondencia_pendiente')).toBe('correspondencia')
    expect(groupOf('cuota_emitida')).toBe('cobros')
    expect(groupOf('cuota_recordatorio')).toBe('cobros')
    expect(groupOf('recibo_agua_emitido')).toBe('cobros')
  })

  // Un `tipo` nuevo en la BD no puede hacer que la fila desaparezca de la campana.
  it('manda lo desconocido y lo vacío a "otros"', () => {
    expect(groupOf('algo_que_no_existe')).toBe('otros')
    expect(groupOf('notificacion')).toBe('otros')
    expect(groupOf('')).toBe('otros')
    expect(groupOf(null)).toBe('otros')
    expect(groupOf(undefined)).toBe('otros')
  })

  // `tipo` es texto libre en la BD: una clave heredada de Object.prototype no
  // puede devolver una función disfrazada de grupo.
  it('no confunde propiedades heredadas de Object con grupos', () => {
    expect(groupOf('constructor')).toBe('otros')
    expect(groupOf('hasOwnProperty')).toBe('otros')
  })
})

describe('groupCounts', () => {
  it('separa no leídas de total y ordena por prioridad del grupo', () => {
    const counts = groupCounts([
      notif('paquete_pendiente'),
      notif('mensaje'),
      notif('mensaje', true),
      notif('solicitud'),
      notif('reserva'),
    ])
    expect(counts.map(c => c.group)).toEqual(['mensajes', 'solicitudes', 'reservas', 'paquetes'])
    expect(counts[0]).toMatchObject({ group: 'mensajes', unread: 1, total: 2 })
    expect(counts[2]).toMatchObject({ group: 'reservas', unread: 1, total: 1 })
    expect(counts[3]).toMatchObject({ group: 'paquetes', unread: 1, total: 1 })
  })

  it('omite los grupos sin notificaciones', () => {
    expect(groupCounts([notif('mensaje')]).map(c => c.group)).toEqual(['mensajes'])
    expect(groupCounts([])).toEqual([])
  })
})

describe('resumenNoLeidas', () => {
  it('lista sólo lo no leído, en singular o plural según el conteo', () => {
    const resumen = resumenNoLeidas([
      notif('mensaje'), notif('mensaje'), notif('mensaje'),
      notif('difusion'),
      notif('solicitud', true),
    ])
    expect(resumen).toBe('3 mensajes · 1 difusión')
  })

  it('es cadena vacía cuando está todo leído', () => {
    expect(resumenNoLeidas([notif('mensaje', true)])).toBe('')
    expect(resumenNoLeidas([])).toBe('')
  })
})

describe('toAppSection', () => {
  it('deja pasar las secciones reales de la app', () => {
    expect(toAppSection('comunicacion')).toBe('comunicacion')
    expect(toAppSection('condominios')).toBe('condominios')
    expect(toAppSection('paquetes')).toBe('paquetes')
  })

  // El bug que arregla: 'anuncios' es un tab del portal del residente, no un
  // AppSection. sectionToPath devolvía undefined y se navegaba a la nada.
  it('rechaza lo que no es AppSection', () => {
    expect(toAppSection('anuncios')).toBeNull()
    expect(toAppSection('no_existe')).toBeNull()
    expect(toAppSection('')).toBeNull()
    expect(toAppSection(null)).toBeNull()
    expect(toAppSection(undefined)).toBeNull()
  })

  // `seccion` es texto libre en la BD: una clave de Object.prototype no puede
  // colarse como sección válida.
  it('no confunde propiedades heredadas de Object con secciones', () => {
    expect(toAppSection('constructor')).toBeNull()
    expect(toAppSection('toString')).toBeNull()
  })
})
