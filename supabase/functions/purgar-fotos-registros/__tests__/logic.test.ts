// Tests de la purga por retención de fotos (20260723000000 + 20260908000100).
// Corre bajo vitest, no Deno: la lógica se extrajo a logic.ts justamente para
// poder ejercerla contra un cliente falso.
//
// LO QUE MÁS IMPORTA aquí no es cuántos objetos se borran, sino dos cosas que
// solo se ven mirando el ORDEN y el PATCH:
//
//   · la fila SOBREVIVE. Un marcaje es dato de planilla: purgar su prueba no
//     puede convertirse nunca en borrar el hecho. Se comprueba que el barrido
//     use `update` y jamás `delete`, y que el patch toque solo las columnas de
//     la evidencia.
//   · el objeto se borra ANTES de anular la columna. Al revés, un fallo del
//     remove dejaría la fila sin path y el archivo vivo para siempre:
//     invisible y no purgable. Hay una prueba que fuerza ese fallo.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  corte, diasDelBody, purgarObjetivo, type ClientePurga, type ObjetivoPurga,
} from '../logic.ts'

const PRESENCIA: ObjetivoPurga = {
  nombre: 'presencia',
  tabla: 'presencia_personal',
  bucket: 'presencia-evidencias',
  columnaFecha: 'fecha',
  columnasFoto: ['foto_entrada', 'foto_salida'],
  columnasAcompanantes: ['gps_entrada', 'gps_salida'],
  diasRetencion: 365,
}

const REGISTROS: ObjetivoPurga = {
  nombre: 'registros',
  tabla: 'registros',
  bucket: 'registro-fotos',
  columnaFecha: 'fecha',
  columnasFoto: ['foto'],
  excluirLike: 'data:%',
  diasRetencion: 90,
}

interface Llamadas {
  selects: { tabla: string; cols: string; or?: string; not?: unknown[]; lt?: unknown[] }[]
  removes: { bucket: string; paths: string[] }[]
  updates: { tabla: string; patch: Record<string, null>; ids: string[] }[]
  deletes: string[]
}

/**
 * Cliente falso: devuelve `paginas` una por llamada a select (una página vacía
 * al final corta el bucle) y registra todo lo que se le pidió.
 */
function clienteFalso(paginas: Record<string, unknown>[][], fallos: { remove?: string; update?: string; select?: string } = {}) {
  const ll: Llamadas = { selects: [], removes: [], updates: [], deletes: [] }
  let i = 0
  const admin = {
    from(tabla: string) {
      return {
        select(cols: string) {
          const reg = { tabla, cols } as Llamadas['selects'][number]
          ll.selects.push(reg)
          const q = {
            not: (...a: unknown[]) => { reg.not = a; return q },
            or: (f: string) => { reg.or = f; return q },
            lt: (...a: unknown[]) => { reg.lt = a; return q },
            limit: () => q,
            then: (res: (v: unknown) => unknown) => res(
              fallos.select
                ? { data: null, error: { message: fallos.select } }
                : { data: paginas[i++] ?? [], error: null },
            ),
          }
          return q
        },
        update(patch: Record<string, null>) {
          return {
            in: async (_col: string, ids: string[]) => {
              ll.updates.push({ tabla, patch, ids })
              return { error: fallos.update ? { message: fallos.update } : null }
            },
          }
        },
        // Si el barrido llamara a delete, este espía lo delata.
        delete() { ll.deletes.push(tabla); throw new Error('la purga no borra filas') },
      }
    },
    storage: {
      from(bucket: string) {
        return {
          remove: async (paths: string[]) => {
            ll.removes.push({ bucket, paths })
            return { error: fallos.remove ? { message: fallos.remove } : null }
          },
        }
      },
    },
  }
  return { admin: admin as unknown as ClientePurga, ll }
}

describe('purgarObjetivo · la fila sobrevive a su foto', () => {
  it('anula SOLO las columnas de la evidencia; nunca borra el marcaje', async () => {
    const { admin, ll } = clienteFalso([[
      { id: 'r1', foto_entrada: 'p/e/1.jpg', foto_salida: 'p/e/2.jpg' },
    ]])
    const res = await purgarObjetivo(admin, PRESENCIA)

    expect(ll.deletes).toEqual([])
    expect(ll.updates).toHaveLength(1)
    // La hora, el estado y las horas trabajadas ni se mencionan.
    expect(ll.updates[0].patch).toEqual({
      foto_entrada: null, foto_salida: null, gps_entrada: null, gps_salida: null,
    })
    expect(ll.updates[0].tabla).toBe('presencia_personal')
    expect(res.filas_actualizadas).toBe(1)
    expect(res.errores).toEqual([])
  })

  it('el GPS cae junto con la foto, no después', async () => {
    const { admin, ll } = clienteFalso([[{ id: 'r1', foto_entrada: 'p/e/1.jpg', foto_salida: null }]])
    await purgarObjetivo(admin, PRESENCIA)
    expect(Object.keys(ll.updates[0].patch).sort())
      .toEqual(['foto_entrada', 'foto_salida', 'gps_entrada', 'gps_salida'])
  })

  it('una fila con solo una de las dos fotos también se barre', async () => {
    const { admin, ll } = clienteFalso([[{ id: 'r1', foto_entrada: null, foto_salida: 'p/e/2.jpg' }]])
    const res = await purgarObjetivo(admin, PRESENCIA)
    // El filtro pide "cualquiera de las dos puesta", no "las dos".
    expect(ll.selects[0].or).toBe('foto_entrada.not.is.null,foto_salida.not.is.null')
    expect(ll.removes[0].paths).toEqual(['p/e/2.jpg'])
    expect(res.objetos_borrados).toBe(1)
  })
})

describe('purgarObjetivo · el orden es la garantía', () => {
  it('si el remove falla, la columna NO se anula (el mes que viene se reintenta)', async () => {
    const { admin, ll } = clienteFalso(
      [[{ id: 'r1', foto_entrada: 'p/e/1.jpg', foto_salida: null }]],
      { remove: 'storage caído' },
    )
    const res = await purgarObjetivo(admin, PRESENCIA)

    expect(ll.removes).toHaveLength(1)
    expect(ll.updates).toEqual([])   // ← el path sobrevive; el archivo es recuperable
    expect(res.filas_actualizadas).toBe(0)
    expect(res.errores).toEqual(['remove: storage caído'])
  })

  it('un fallo del update se reporta y corta el barrido', async () => {
    const { admin } = clienteFalso(
      [[{ id: 'r1', foto_entrada: 'p/e/1.jpg', foto_salida: null }]],
      { update: 'permiso denegado' },
    )
    const res = await purgarObjetivo(admin, PRESENCIA)
    expect(res.errores).toEqual(['update: permiso denegado'])
    expect(res.iteraciones).toBe(1)
  })

  it('un fallo del select no deja el resultado a medias sin decirlo', async () => {
    const { admin } = clienteFalso([[]], { select: 'timeout' })
    const res = await purgarObjetivo(admin, PRESENCIA)
    expect(res.errores).toEqual(['select: timeout'])
    expect(res.objetos_borrados).toBe(0)
  })
})

describe('purgarObjetivo · cada bucket con su plazo', () => {
  it('presencia mide 365 días contra su propio bucket', async () => {
    const ahora = Date.UTC(2027, 0, 1)
    const { admin, ll } = clienteFalso([[{ id: 'r1', foto_entrada: 'p/e/1.jpg', foto_salida: null }]])
    const res = await purgarObjetivo(admin, PRESENCIA, ahora)
    expect(ll.selects[0].lt).toEqual(['fecha', corte(365, ahora)])
    expect(ll.removes[0].bucket).toBe('presencia-evidencias')
    expect(res.dias).toBe(365)
  })

  it('registros conserva sus 90 días y su exclusión del base64', async () => {
    const ahora = Date.UTC(2027, 0, 1)
    const { admin, ll } = clienteFalso([[{ id: 'r1', foto: 'cli/1' }]])
    await purgarObjetivo(admin, REGISTROS, ahora)
    expect(ll.selects[0].lt).toEqual(['fecha', corte(90, ahora)])
    // El data-URI inline no es un objeto de Storage: lo limpia el paso SQL.
    expect(ll.selects[0].not).toEqual(['foto', 'like', 'data:%'])
    expect(ll.removes[0].bucket).toBe('registro-fotos')
  })

  it('sin filas viejas no toca nada', async () => {
    const { admin, ll } = clienteFalso([[]])
    const res = await purgarObjetivo(admin, PRESENCIA)
    expect(ll.removes).toEqual([])
    expect(ll.updates).toEqual([])
    expect(res.iteraciones).toBe(0)
  })

  it('pagina hasta agotar y se detiene', async () => {
    const pagina = (n: number) => [{ id: `r${n}`, foto_entrada: `p/e/${n}.jpg`, foto_salida: null }]
    const { admin } = clienteFalso([pagina(1), pagina(2), []])
    const res = await purgarObjetivo(admin, PRESENCIA)
    expect(res.iteraciones).toBe(2)
    expect(res.filas_actualizadas).toBe(2)
  })
})

describe('diasDelBody · nadie purga con "0 días" por un typo', () => {
  it('toma el valor del body cuando es un número positivo', () => {
    expect(diasDelBody({ dias_presencia: 30 }, ['dias_presencia'], 365)).toBe(30)
  })

  it('ignora 0, negativos, texto y ausencia → cae al default', () => {
    for (const v of [0, -5, '30', null, undefined, NaN]) {
      expect(diasDelBody({ dias_presencia: v }, ['dias_presencia'], 365)).toBe(365)
    }
    expect(diasDelBody({}, ['dias_presencia'], 365)).toBe(365)
  })

  it('acepta la clave histórica `dias` como alias de dias_registros', () => {
    expect(diasDelBody({ dias: 45 }, ['dias_registros', 'dias'], 90)).toBe(45)
    // Pero la específica gana sobre la histórica.
    expect(diasDelBody({ dias_registros: 10, dias: 45 }, ['dias_registros', 'dias'], 90)).toBe(10)
  })
})

describe('la política de retención está escrita donde se puede auditar', () => {
  it('el cron manda los dos plazos explícitos', () => {
    const sql = readFileSync('supabase/migrations/20260908000100_purga_fotos_presencia.sql', 'utf8')
    expect(sql).toMatch(/'dias_registros',\s*90/)
    expect(sql).toMatch(/'dias_presencia',\s*365/)
    // Y sigue siendo un no-op seguro sin los secretos del Vault.
    expect(sql).toMatch(/IF v_url IS NOT NULL AND v_key IS NOT NULL THEN/)
  })

  it('el plazo del fichaje está documentado con su razón', () => {
    const doc = readFileSync('docs/PURGA_FOTOS_SCHEDULE.md', 'utf8')
    expect(doc).toContain('presencia-evidencias')
    expect(doc).toMatch(/365|1 año|un año/)
  })
})
