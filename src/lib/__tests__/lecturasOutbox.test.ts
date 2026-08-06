import { describe, it, expect, vi } from 'vitest'
import {
  claveNatural,
  leerPendientes,
  encolarLectura,
  quitarPendiente,
  sincronizarPendientes,
  type OutboxStorage,
} from '../lecturasOutbox'

/** Storage in-memory para testear sin browser. */
function memStorage(inicial: string | null = null): OutboxStorage {
  let valor = inicial
  return {
    leer: () => valor,
    escribir: (v) => { valor = v },
  }
}

const reg = (contador: string, lectura: number, fecha = '2026-07-12') => ({
  contador_id: contador, lectura_actual: lectura, fecha, consumo: 5, monto_calculado: 50,
})

describe('claveNatural', () => {
  it('combina contador · lectura · fecha', () => {
    expect(claveNatural(reg('c1', 120))).toBe('c1|120|2026-07-12')
  })
})

describe('encolarLectura', () => {
  it('encola y persiste', () => {
    const s = memStorage()
    const cola = encolarLectura(s, reg('c1', 120), 'Juan · c1', 1000)
    expect(cola).toHaveLength(1)
    expect(leerPendientes(s)).toHaveLength(1)
    expect(cola[0]).toMatchObject({ clave: 'c1|120|2026-07-12', etiqueta: 'Juan · c1', encoladaEn: 1000 })
  })

  it('dedupe por clave natural: no encola dos veces la misma lectura', () => {
    const s = memStorage()
    encolarLectura(s, reg('c1', 120), 'Juan', 1000)
    const cola = encolarLectura(s, reg('c1', 120), 'Juan otra vez', 2000)
    expect(cola).toHaveLength(1)
    expect(cola[0].etiqueta).toBe('Juan') // conserva la primera
  })

  it('lecturas distintas del mismo contador se encolan por separado', () => {
    const s = memStorage()
    encolarLectura(s, reg('c1', 120), 'a', 1000)
    const cola = encolarLectura(s, reg('c1', 130), 'b', 2000)
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
})

describe('quitarPendiente', () => {
  it('elimina por clave', () => {
    const s = memStorage()
    encolarLectura(s, reg('c1', 120), 'a', 1000)
    encolarLectura(s, reg('c2', 50), 'b', 1000)
    const cola = quitarPendiente(s, 'c1|120|2026-07-12')
    expect(cola.map((x) => x.clave)).toEqual(['c2|50|2026-07-12'])
  })
})

describe('sincronizarPendientes', () => {
  it('inserta las que no existen y vacía la cola', async () => {
    const s = memStorage()
    encolarLectura(s, reg('c1', 120), 'a', 1000)
    encolarLectura(s, reg('c2', 50), 'b', 1000)
    const insertar = vi.fn().mockResolvedValue(null)
    const res = await sincronizarPendientes(s, { existe: async () => false, insertar })
    expect(res).toEqual({ ok: 2, yaExistian: 0, fallidas: 0 })
    expect(insertar).toHaveBeenCalledTimes(2)
    expect(leerPendientes(s)).toHaveLength(0)
  })

  it('IDEMPOTENCIA: descarta (no reinserta) las que ya existen en la BD', async () => {
    const s = memStorage()
    encolarLectura(s, reg('c1', 120), 'a', 1000)
    const insertar = vi.fn().mockResolvedValue(null)
    const res = await sincronizarPendientes(s, { existe: async () => true, insertar })
    expect(res).toEqual({ ok: 0, yaExistian: 1, fallidas: 0 })
    expect(insertar).not.toHaveBeenCalled() // nunca duplica
    expect(leerPendientes(s)).toHaveLength(0)
  })

  it('las que fallan quedan en la cola para reintentar; las que pasan salen', async () => {
    const s = memStorage()
    encolarLectura(s, reg('c1', 120), 'ok', 1000)
    encolarLectura(s, reg('c2', 50), 'falla', 1000)
    const insertar = vi.fn(async (r: Record<string, unknown>) =>
      r.contador_id === 'c2' ? 'error de red' : null)
    const res = await sincronizarPendientes(s, { existe: async () => false, insertar })
    expect(res).toEqual({ ok: 1, yaExistian: 0, fallidas: 1 })
    const restantes = leerPendientes(s)
    expect(restantes.map((x) => x.clave)).toEqual(['c2|50|2026-07-12'])
  })

  it('E1: insert rechazado por llave natural (duplicado) → cuenta yaExistía y sale de la cola', async () => {
    // La carrera TOCTOU: existe() dijo false, pero otro dispositivo insertó
    // antes que nosotros — la BD rechaza con 23505 y el caller devuelve
    // 'duplicado'. La lectura YA está en el sistema: descartar, no reintentar.
    const s = memStorage()
    encolarLectura(s, reg('c1', 120), 'a', 1000)
    const insertar = vi.fn().mockResolvedValue('duplicado' as const)
    const res = await sincronizarPendientes(s, { existe: async () => false, insertar })
    expect(res).toEqual({ ok: 0, yaExistian: 1, fallidas: 0 })
    expect(leerPendientes(s)).toHaveLength(0) // no queda atascada reintentando
  })

  it('una excepción en insertar cuenta como fallida y conserva la pendiente', async () => {
    const s = memStorage()
    encolarLectura(s, reg('c1', 120), 'a', 1000)
    const res = await sincronizarPendientes(s, {
      existe: async () => false,
      insertar: async () => { throw new Error('boom') },
    })
    expect(res).toEqual({ ok: 0, yaExistian: 0, fallidas: 1 })
    expect(leerPendientes(s)).toHaveLength(1)
  })

  it('cola vacía → todo en cero', async () => {
    const res = await sincronizarPendientes(memStorage(), { existe: async () => false, insertar: async () => null })
    expect(res).toEqual({ ok: 0, yaExistian: 0, fallidas: 0 })
  })
})
