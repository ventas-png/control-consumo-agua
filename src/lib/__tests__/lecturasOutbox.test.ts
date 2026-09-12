import { describe, it, expect, vi } from 'vitest'
import {
  leerPendientes,
  encolarLectura,
  quitarPendiente,
  sincronizarPendientes,
  nuevaClaveIdempotencia,
  type OutboxStorage,
} from '../lecturasOutbox'
import type { LecturaCaptura } from '../../domain/agua/mutations'

/** Storage in-memory para testear sin browser. */
function memStorage(inicial: string | null = null): OutboxStorage {
  let valor = inicial
  return {
    leer: () => valor,
    escribir: (v) => { valor = v },
  }
}

const cap = (contador: string, lectura: number, clave: string, fecha = '2026-07-12'): LecturaCaptura => ({
  contadorId: contador,
  lecturaActual: lectura,
  fecha,
  idempotencyKey: clave,
})

describe('nuevaClaveIdempotencia', () => {
  it('devuelve llaves distintas para capturas distintas', () => {
    expect(nuevaClaveIdempotencia()).not.toBe(nuevaClaveIdempotencia())
  })
  it('la llave es lo bastante larga para el mínimo que exige la RPC', () => {
    expect(nuevaClaveIdempotencia().length).toBeGreaterThanOrEqual(8)
  })
})

describe('encolarLectura', () => {
  it('encola y persiste', () => {
    const s = memStorage()
    const cola = encolarLectura(s, cap('c1', 120, 'op-1'), 'Juan · c1', 1000)
    expect(cola).toHaveLength(1)
    expect(leerPendientes(s)).toHaveLength(1)
    expect(cola[0]).toMatchObject({ clave: 'op-1', etiqueta: 'Juan · c1', encoladaEn: 1000 })
  })

  it('dedupe por llave de idempotencia: reencolar la MISMA operación no la duplica', () => {
    const s = memStorage()
    encolarLectura(s, cap('c1', 120, 'op-1'), 'Juan', 1000)
    const cola = encolarLectura(s, cap('c1', 120, 'op-1'), 'Juan otra vez', 2000)
    expect(cola).toHaveLength(1)
    expect(cola[0].etiqueta).toBe('Juan') // conserva la primera
  })

  it('DOS capturas iguales de verdad son dos operaciones: la cola ya no las confunde', () => {
    // Es la regresión que motiva la llave: mismo contador, misma fecha y el
    // MISMO número (el medidor no se movió) son indistinguibles por clave
    // natural, y la cola vieja descartaba una lectura real como si fuera un
    // reintento.
    const s = memStorage()
    encolarLectura(s, cap('c1', 120, 'op-1'), 'primera', 1000)
    const cola = encolarLectura(s, cap('c1', 120, 'op-2'), 'segunda', 2000)
    expect(cola).toHaveLength(2)
  })
})

describe('leerPendientes', () => {
  it('vacío/nulo → []', () => {
    expect(leerPendientes(memStorage())).toEqual([])
  })
  it('JSON corrupto → [] (no lanza)', () => {
    expect(leerPendientes(memStorage('{no es json'))).toEqual([])
  })

  it('migra la cola del formato VIEJO sin perder la lectura de campo', () => {
    // Lo que dejó en localStorage una app anterior a la captura autoritativa.
    const viejo = JSON.stringify([{
      clave: 'c1|120|2026-07-12T18:00:00.000Z',
      encoladaEn: 1000,
      etiqueta: 'Juan · c1',
      registro: {
        contador_id: 'c1', lectura_actual: 120, fecha: '2026-07-12T18:00:00.000Z',
        // Todo esto lo decidía el navegador y ahora se DESCARTA a propósito.
        consumo: 5, monto_calculado: 50, tarifa_aplicada: 3.5, estado: 'pagado',
        project_id: 'proyecto-de-otro', notas: 'Medidor con humedad',
      },
    }])
    const [p] = leerPendientes(memStorage(viejo))
    expect(p.captura.contadorId).toBe('c1')
    expect(p.captura.lecturaActual).toBe(120)
    expect(p.captura.notas).toBe('Medidor con humedad')
    expect(p.etiqueta).toBe('Juan · c1')
    // Ni el importe, ni el estado, ni el proyecto sobreviven a la migración.
    expect(Object.keys(p.captura)).not.toContain('monto_calculado')
    expect(Object.keys(p.captura)).not.toContain('estado')
    expect(Object.keys(p.captura)).not.toContain('project_id')
  })

  it('la llave que se le inventa a una pendiente legada es DETERMINISTA', () => {
    // Si cambiara entre lecturas de la cola, dos intentos de sincronizar la
    // misma pendiente serían dos operaciones distintas y duplicarían la lectura.
    const viejo = JSON.stringify([{
      encoladaEn: 1, etiqueta: 'x',
      registro: { contador_id: 'c1', lectura_actual: 120, fecha: '2026-07-12T18:00:00.000Z' },
    }])
    const s = memStorage(viejo)
    expect(leerPendientes(s)[0].captura.idempotencyKey)
      .toBe(leerPendientes(s)[0].captura.idempotencyKey)
    expect(leerPendientes(s)[0].captura.idempotencyKey).toMatch(/^legado-c1-120-/)
  })

  it('descarta la pendiente legada que no tiene ni contador ni lectura utilizables', () => {
    const viejo = JSON.stringify([
      { encoladaEn: 1, etiqueta: 'sin contador', registro: { lectura_actual: 10, fecha: '2026-07-12' } },
      { encoladaEn: 1, etiqueta: 'sin nada' },
    ])
    expect(leerPendientes(memStorage(viejo))).toEqual([])
  })
})

describe('quitarPendiente', () => {
  it('elimina por llave', () => {
    const s = memStorage()
    encolarLectura(s, cap('c1', 120, 'op-1'), 'a', 1000)
    encolarLectura(s, cap('c2', 50, 'op-2'), 'b', 1000)
    expect(quitarPendiente(s, 'op-1').map((x) => x.clave)).toEqual(['op-2'])
  })
})

describe('sincronizarPendientes', () => {
  it('registra todas y vacía la cola', async () => {
    const s = memStorage()
    encolarLectura(s, cap('c1', 120, 'op-1'), 'a', 1000)
    encolarLectura(s, cap('c2', 50, 'op-2'), 'b', 1000)
    const registrar = vi.fn().mockResolvedValue(null)
    const res = await sincronizarPendientes(s, { registrar })
    expect(res).toEqual({ ok: 2, yaExistian: 0, fallidas: 0 })
    expect(registrar).toHaveBeenCalledTimes(2)
    expect(leerPendientes(s)).toHaveLength(0)
  })

  it('REPLAY: reintentar la cola entera no vuelve a preguntar nada, manda la misma llave', async () => {
    const s = memStorage()
    encolarLectura(s, cap('c1', 120, 'op-1'), 'a', 1000)
    const vistas: string[] = []
    await sincronizarPendientes(s, {
      registrar: async (c) => { vistas.push(c.idempotencyKey); return 'fallo de red' },
    })
    await sincronizarPendientes(s, {
      registrar: async (c) => { vistas.push(c.idempotencyKey); return null },
    })
    expect(vistas).toEqual(['op-1', 'op-1'])
    expect(leerPendientes(s)).toHaveLength(0)
  })

  it('las que fallan quedan en la cola para reintentar; las que pasan salen', async () => {
    const s = memStorage()
    encolarLectura(s, cap('c1', 120, 'op-1'), 'ok', 1000)
    encolarLectura(s, cap('c2', 50, 'op-2'), 'falla', 1000)
    const registrar = vi.fn(async (c: LecturaCaptura) =>
      c.contadorId === 'c2' ? 'error de red' : null)
    const res = await sincronizarPendientes(s, { registrar })
    expect(res).toEqual({ ok: 1, yaExistian: 0, fallidas: 1 })
    expect(leerPendientes(s).map((x) => x.clave)).toEqual(['op-2'])
  })

  it('rechazo por llave natural (23505) → cuenta yaExistía y sale de la cola', async () => {
    // Esa lectura ya está por OTRA operación: reintentar no la va a meter nunca.
    const s = memStorage()
    encolarLectura(s, cap('c1', 120, 'op-1'), 'a', 1000)
    const res = await sincronizarPendientes(s, { registrar: async () => 'duplicado' as const })
    expect(res).toEqual({ ok: 0, yaExistian: 1, fallidas: 0 })
    expect(leerPendientes(s)).toHaveLength(0) // no queda atascada reintentando
  })

  it('una excepción cuenta como fallida y conserva la pendiente', async () => {
    const s = memStorage()
    encolarLectura(s, cap('c1', 120, 'op-1'), 'a', 1000)
    const res = await sincronizarPendientes(s, {
      registrar: async () => { throw new Error('boom') },
    })
    expect(res).toEqual({ ok: 0, yaExistian: 0, fallidas: 1 })
    expect(leerPendientes(s)).toHaveLength(1)
  })

  it('cola vacía → todo en cero', async () => {
    const res = await sincronizarPendientes(memStorage(), { registrar: async () => null })
    expect(res).toEqual({ ok: 0, yaExistian: 0, fallidas: 0 })
  })
})
