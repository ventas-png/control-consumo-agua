// Drenaje de la cola de archivos de housekeeping (_shared/housekeepingLimpieza.ts).
// Corre bajo vitest con un cliente falso. Lo que se vigila aquí no es el camino feliz, sino:
//   · un fallo de Storage NO saca la fila de la cola (se reintenta) y deja el error registrado;
//   · «cero filas afectadas» al confirmar/fallar se REPORTA, no se da por éxito;
//   · lo que no es del bucket de housekeeping jamás llega a `remove`;
//   · nada lanza: cada fallo queda en `errores` y el resto de lotes sigue.
import { describe, it, expect } from 'vitest'
import {
  BUCKET_HOUSEKEEPING, MAX_LOTES, drenarColaHousekeeping, type ClienteLimpieza, type FilaCola,
} from '../housekeepingLimpieza.ts'

type Llamada = { nombre: string; args?: Record<string, unknown> }

interface Guion {
  /** Lotes que devuelve `hk_limpieza_tomar`, en orden; luego [] (o `siempre` si se indica). */
  lotes?: FilaCola[][]
  siempre?: FilaCola[]
  errorTomar?: string
  /** Resultado de cada `remove`, en orden; por defecto éxito. */
  remove?: Array<{ data?: unknown; error?: { message: string } | null } | 'lanza'>
  /** Qué devuelve confirmar / fallar / huérfanas (por defecto «todas» / n). */
  confirmar?: (ids: number[]) => { data: unknown; error: { message: string } | null }
  fallar?: (ids: number[]) => { data: unknown; error: { message: string } | null }
  huerfanas?: { data: unknown; error: { message: string } | null }
}

function fila(id: number, bucket = BUCKET_HOUSEKEEPING): FilaCola {
  return { id, bucket, path: `p/s/${id}.jpg`, intentos: 0 }
}

function cliente(g: Guion) {
  const llamadas: Llamada[] = []
  const borrados: Array<{ bucket: string; paths: string[] }> = []
  let iLote = 0, iRemove = 0
  const admin: ClienteLimpieza = {
    rpc: async (nombre, args) => {
      llamadas.push({ nombre, args })
      if (nombre === 'hk_limpieza_encolar_huerfanas') return g.huerfanas ?? { data: 0, error: null }
      if (nombre === 'hk_limpieza_tomar') {
        if (g.errorTomar) return { data: null, error: { message: g.errorTomar } }
        if (g.siempre) return { data: g.siempre, error: null }
        return { data: g.lotes?.[iLote++] ?? [], error: null }
      }
      const ids = (args?.p_ids as number[]) ?? []
      if (nombre === 'hk_limpieza_confirmar') return g.confirmar ? g.confirmar(ids) : { data: ids.length, error: null }
      if (nombre === 'hk_limpieza_fallar') return g.fallar ? g.fallar(ids) : { data: ids.length, error: null }
      return { data: null, error: { message: `rpc inesperada ${nombre}` } }
    },
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          borrados.push({ bucket, paths })
          const r = g.remove?.[iRemove++]
          if (r === 'lanza') throw new Error('fetch failed')
          return { data: r?.data ?? paths.map(name => ({ name })), error: r?.error ?? null }
        },
      }),
    },
  }
  return { admin, llamadas, borrados }
}
const nombres = (l: Llamada[]) => l.map(x => x.nombre)

describe('drenarColaHousekeeping', () => {
  it('camino feliz: borra los objetos y SOLO después confirma la cola', async () => {
    const { admin, llamadas, borrados } = cliente({ lotes: [[fila(1), fila(2), fila(3)]] })
    const r = await drenarColaHousekeeping(admin)
    expect(r).toMatchObject({ tomadas: 3, borradas: 3, fallidas: 0, errores: [], lotes: 1 })
    expect(borrados).toEqual([{ bucket: BUCKET_HOUSEKEEPING, paths: ['p/s/1.jpg', 'p/s/2.jpg', 'p/s/3.jpg'] }])
    // el orden es la regla: tomar → remove → confirmar (confirmar nunca antes de borrar)
    expect(nombres(llamadas)).toEqual(['hk_limpieza_tomar', 'hk_limpieza_confirmar', 'hk_limpieza_tomar'])
    expect(llamadas[1].args).toEqual({ p_ids: [1, 2, 3] })
  })

  it('FALLO DE STORAGE: la fila NO sale de la cola; se registra el error para el reintento', async () => {
    const { admin, llamadas } = cliente({ lotes: [[fila(1), fila(2)]], remove: [{ error: { message: '503 Service Unavailable' } }] })
    const r = await drenarColaHousekeeping(admin)
    expect(r.borradas).toBe(0)
    expect(r.fallidas).toBe(2)
    expect(r.errores.join('|')).toContain('storage: 503 Service Unavailable')
    expect(nombres(llamadas)).not.toContain('hk_limpieza_confirmar')
    const fallar = llamadas.find(l => l.nombre === 'hk_limpieza_fallar')
    expect(fallar?.args).toEqual({ p_ids: [1, 2], p_error: 'storage: 503 Service Unavailable' })
  })

  it('Storage que LANZA (red caída) se trata igual: sin confirmar, con fallo registrado, sin lanzar', async () => {
    const { admin, llamadas } = cliente({ lotes: [[fila(7)]], remove: ['lanza'] })
    const r = await drenarColaHousekeeping(admin)
    expect(r.fallidas).toBe(1)
    expect(r.errores.join('|')).toContain('fetch failed')
    expect(nombres(llamadas)).toContain('hk_limpieza_fallar')
    expect(nombres(llamadas)).not.toContain('hk_limpieza_confirmar')
  })

  it('un lote que falla no impide el siguiente', async () => {
    const { admin } = cliente({
      lotes: [[fila(1)], [fila(2)]],
      remove: [{ error: { message: 'boom' } }, {}],
    })
    const r = await drenarColaHousekeeping(admin)
    expect(r).toMatchObject({ tomadas: 2, borradas: 1, fallidas: 1, lotes: 2 })
  })

  it('un objeto que ya no existe NO es error (Storage devuelve lista vacía): se confirma', async () => {
    const { admin, llamadas } = cliente({ lotes: [[fila(1), fila(2)]], remove: [{ data: [] }] })
    const r = await drenarColaHousekeeping(admin)
    expect(r.errores).toEqual([])
    expect(r.borradas).toBe(2)
    expect(nombres(llamadas)).toContain('hk_limpieza_confirmar')
  })

  it('CERO FILAS AFECTADAS al confirmar se reporta (otra pasada ya se las llevó)', async () => {
    const { admin } = cliente({ lotes: [[fila(1), fila(2)]], confirmar: () => ({ data: 1, error: null }) })
    const r = await drenarColaHousekeeping(admin)
    expect(r.borradas).toBe(1)
    expect(r.errores.join('|')).toContain('salieron 1 de 2 filas de la cola')
  })

  it('confirmar con respuesta vacía (0) también se reporta y no cuenta como borrado', async () => {
    const { admin } = cliente({ lotes: [[fila(1)]], confirmar: () => ({ data: 0, error: null }) })
    const r = await drenarColaHousekeeping(admin)
    expect(r.borradas).toBe(0)
    expect(r.errores.join('|')).toContain('salieron 0 de 1')
  })

  it('error al confirmar: se cuenta como fallida y se reporta (la fila reaparece al vencer el arrendamiento)', async () => {
    const { admin } = cliente({ lotes: [[fila(1)]], confirmar: () => ({ data: null, error: { message: 'db caída' } }) })
    const r = await drenarColaHousekeeping(admin)
    expect(r.fallidas).toBe(1)
    expect(r.borradas).toBe(0)
    expect(r.errores.join('|')).toContain('confirmar: db caída')
  })

  it('CERO FILAS AFECTADAS al registrar el fallo se reporta (la fila no se pudo marcar para reintento)', async () => {
    const { admin } = cliente({
      lotes: [[fila(1), fila(2)]], remove: [{ error: { message: 'boom' } }],
      fallar: () => ({ data: 0, error: null }),
    })
    const r = await drenarColaHousekeeping(admin)
    expect(r.errores.join('|')).toContain('fallar: se actualizaron 0 de 2 filas')
  })

  it('un error al registrar el fallo también queda en errores', async () => {
    const { admin } = cliente({
      lotes: [[fila(1)]], remove: [{ error: { message: 'boom' } }],
      fallar: () => ({ data: null, error: { message: 'sin permiso' } }),
    })
    const r = await drenarColaHousekeeping(admin)
    expect(r.errores.join('|')).toContain('fallar: sin permiso')
  })

  it('NUNCA llama a Storage con un bucket ajeno: la fila se marca fallida y queda en la cola', async () => {
    const { admin, borrados, llamadas } = cliente({ lotes: [[fila(1, 'condominios-media'), fila(2)]] })
    const r = await drenarColaHousekeeping(admin)
    expect(borrados).toEqual([{ bucket: BUCKET_HOUSEKEEPING, paths: ['p/s/2.jpg'] }])
    expect(r.errores.join('|')).toContain('bucket no permitido: condominios-media')
    const fallar = llamadas.find(l => l.nombre === 'hk_limpieza_fallar')
    expect(fallar?.args?.p_ids).toEqual([1])
    expect(r.borradas).toBe(1)
  })

  it('si tomar() falla se corta el bucle con el error (no gira sobre una consulta rota)', async () => {
    const { admin, llamadas } = cliente({ errorTomar: 'permission denied' })
    const r = await drenarColaHousekeeping(admin)
    expect(r.errores).toEqual(['tomar: permission denied'])
    expect(nombres(llamadas).filter(n => n === 'hk_limpieza_tomar')).toHaveLength(1)
  })

  it('pasa la empresa al tomar (el usuario solo drena su cola) y por defecto no filtra', async () => {
    const a = cliente({ lotes: [[]] })
    await drenarColaHousekeeping(a.admin, { company: 'empresa-1' })
    expect(a.llamadas[0].args).toMatchObject({ p_company: 'empresa-1' })
    const b = cliente({ lotes: [[]] })
    await drenarColaHousekeeping(b.admin)
    expect(b.llamadas[0].args).toMatchObject({ p_company: null })
  })

  it('el barrido de huérfanas va ANTES de tomar y un fallo suyo no frena el drenaje', async () => {
    const { admin, llamadas } = cliente({ lotes: [[fila(1)]], huerfanas: { data: null, error: { message: 'timeout' } } })
    const r = await drenarColaHousekeeping(admin, { barrerHuerfanas: true })
    expect(nombres(llamadas)[0]).toBe('hk_limpieza_encolar_huerfanas')
    expect(r.errores.join('|')).toContain('huerfanas: timeout')
    expect(r.borradas).toBe(1)
    const ok = cliente({ lotes: [[]], huerfanas: { data: 4, error: null } })
    expect((await drenarColaHousekeeping(ok.admin, { barrerHuerfanas: true })).huerfanas_encoladas).toBe(4)
  })

  it('sin barrerHuerfanas no toca el barrido (lo dispara el cron, no el usuario)', async () => {
    const { admin, llamadas } = cliente({ lotes: [[]] })
    await drenarColaHousekeeping(admin)
    expect(nombres(llamadas)).not.toContain('hk_limpieza_encolar_huerfanas')
  })

  it('tiene tope de lotes: una cola que nunca se vacía no cuelga la corrida', async () => {
    const { admin, llamadas } = cliente({ siempre: [fila(1)] })
    const r = await drenarColaHousekeeping(admin)
    expect(r.lotes).toBe(MAX_LOTES)
    expect(nombres(llamadas).filter(n => n === 'hk_limpieza_tomar')).toHaveLength(MAX_LOTES)
  })

  it('una excepción del cliente RPC no escapa: queda en errores', async () => {
    const admin: ClienteLimpieza = {
      rpc: async () => { throw new Error('socket hang up') },
      storage: { from: () => ({ remove: async () => ({ data: [], error: null }) }) },
    }
    const r = await drenarColaHousekeeping(admin)
    expect(r.errores.join('|')).toContain('socket hang up')
  })
})
