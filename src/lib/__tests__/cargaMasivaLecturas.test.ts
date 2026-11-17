// Carga masiva de lecturas: lo que se valida antes de mandar, cómo se ven las
// lecturas encadenadas en el preview y el orden en que se registran.
import { describe, it, expect, vi } from 'vitest'
import type { Contador, Registro, Tarifa } from '../../types'
import {
  ejecutarCargaMasiva,
  lecturasExistentes,
  planCargaMasiva,
  resumenCarga,
  ultimasLecturas,
  validarFilaCargaMasiva,
  type ContextoValidacion,
  type FilaCargaMasiva,
  type ResultadoRegistro,
} from '../cargaMasivaLecturas'

const tarifas = [
  { id: 't1', activa: true, precio_m3: 5, precio_m3_exceso: 0, canon_fijo: 0, consumo_minimo: 0 },
  { id: 't-vieja', activa: false, precio_m3: 5, precio_m3_exceso: 0, canon_fijo: 0, consumo_minimo: 0 },
] as unknown as Tarifa[]

const contadores = [
  { id: 'c1', numero_serie: '21B-001', project_id: 'p1', activo: true, tarifa_id: 't1', lectura_inicial: 100 },
  { id: 'c2', numero_serie: '21B-002', project_id: 'p1', activo: true, tarifa_id: 't1', lectura_inicial: 0 },
  { id: 'c3', numero_serie: '21B-003', project_id: 'p1', activo: false, tarifa_id: 't1', lectura_inicial: 0 },
  { id: 'c4', numero_serie: '21B-004', project_id: 'p1', activo: true, tarifa_id: null, lectura_inicial: 0 },
  { id: 'c5', numero_serie: '21B-005', project_id: 'p1', activo: true, tarifa_id: 't-vieja', lectura_inicial: 0 },
  { id: 'c9', numero_serie: '21B-001', project_id: 'p2', activo: true, tarifa_id: 't1', lectura_inicial: 0 },
] as unknown as Contador[]

const registros = [
  { contador_id: 'c1', lectura_actual: 120, fecha: '2026-09-30T18:00:00+00:00', created_at: '2026-09-30T19:00:00Z' },
  { contador_id: 'c1', lectura_actual: 130, fecha: '2026-10-31T18:00:00+00:00', created_at: '2026-10-31T19:00:00Z' },
] as unknown as Registro[]

function ctx(extra: Partial<ContextoValidacion> = {}): ContextoValidacion {
  return {
    contadores, tarifas, projectId: 'p1', fechaDefecto: '2026-11-15', hoy: '2026-11-17',
    ultimas: ultimasLecturas(registros), existentes: lecturasExistentes(registros), ...extra,
  }
}

const errores = (r: ReturnType<typeof validarFilaCargaMasiva>) => (r.ok ? [] : r.errors)

describe('validarFilaCargaMasiva', () => {
  it('busca el contador en el proyecto elegido y usa la fecha por defecto si la fila no trae', () => {
    expect(validarFilaCargaMasiva({ contador: ' 21b-001 ', lectura: '1 45,5', notas: ' ok ' }, 2, ctx())).toEqual({
      ok: true,
      data: { fila: 2, contadorId: 'c1', contador: '21B-001', fecha: '2026-11-15', lectura: 145.5, notas: 'ok' },
    })
    expect(validarFilaCargaMasiva({ contador: '21B-002', fecha: '16/11/2026', lectura: 7 }, 3, ctx()))
      .toMatchObject({ ok: true, data: { contadorId: 'c2', fecha: '2026-11-16' } })
  })

  it('sin proyecto, contador de otro proyecto, inactivo, sin tarifa o con tarifa dada de baja', () => {
    expect(errores(validarFilaCargaMasiva({ contador: '21B-001', lectura: 150 }, 2, ctx({ projectId: '' }))))
      .toEqual(['elija el proyecto'])
    expect(errores(validarFilaCargaMasiva({ contador: 'X-1', lectura: 1 }, 2, ctx())))
      .toEqual(['el contador «X-1» no existe en el proyecto elegido'])
    expect(errores(validarFilaCargaMasiva({ contador: '21B-003', lectura: 1 }, 2, ctx())))
      .toEqual(['el contador «21B-003» está inactivo'])
    expect(errores(validarFilaCargaMasiva({ contador: '21B-004', lectura: 1 }, 2, ctx())))
      .toEqual(['el contador «21B-004» no tiene tarifa asignada'])
    expect(errores(validarFilaCargaMasiva({ contador: '21B-005', lectura: 1 }, 2, ctx())))
      .toEqual(['la tarifa del contador «21B-005» no está vigente'])
  })

  it('la fecha tiene que tener día y no ser futura', () => {
    expect(errores(validarFilaCargaMasiva({ contador: '21B-002', fecha: '2026-11', lectura: 1 }, 2, ctx())))
      .toEqual(['la fecha «2026-11» es sólo el mes: una lectura que se cobra necesita el día'])
    expect(errores(validarFilaCargaMasiva({ contador: '21B-002', fecha: '2026-11-18', lectura: 1 }, 2, ctx())))
      .toEqual(['la fecha 2026-11-18 está en el futuro'])
    expect(errores(validarFilaCargaMasiva({ contador: '21B-002', lectura: 1 }, 2, ctx({ fechaDefecto: '' }))))
      .toEqual(['falta la fecha'])
    expect(errores(validarFilaCargaMasiva({ contador: '21B-002', fecha: 'ayer', lectura: 1 }, 2, ctx())))
      .toEqual(['fecha inválida «ayer» — use AAAA-MM-DD o DD/MM/AAAA'])
  })

  it('lo que el servidor rechazaría: retroactiva, menor que la anterior, ya registrada, sin lectura', () => {
    expect(errores(validarFilaCargaMasiva({ contador: '21B-001', fecha: '2026-10-15', lectura: 140 }, 2, ctx())))
      .toEqual(['fecha anterior a la última lectura del contador (2026-10-31): no se registran lecturas retroactivas'])
    expect(errores(validarFilaCargaMasiva({ contador: '21B-001', lectura: 125 }, 2, ctx())))
      .toEqual(['la lectura (125) es menor que la anterior (130); un cambio de medidor se registra desde Nueva Lectura'])
    expect(errores(validarFilaCargaMasiva({ contador: '21B-001', fecha: '2026-10-31', lectura: 130 }, 2, ctx())))
      .toEqual(['ya está registrada (21B-001, 2026-10-31, 130)'])
    expect(errores(validarFilaCargaMasiva({ contador: '21B-002', lectura: '' }, 2, ctx()))).toEqual(['falta la lectura'])
    expect(errores(validarFilaCargaMasiva({ contador: '21B-002', lectura: 'mucho' }, 2, ctx()))).toEqual(['lectura inválida «mucho»'])
    // Sin lecturas en el sistema la base es la lectura inicial del contador.
    expect(errores(validarFilaCargaMasiva({ contador: '21B-002', lectura: 0 }, 2, ctx()))).toEqual([])
  })
})

const fila = (f: Partial<FilaCargaMasiva> & Pick<FilaCargaMasiva, 'fila' | 'contadorId' | 'fecha' | 'lectura'>): FilaCargaMasiva =>
  ({ contador: f.contadorId.toUpperCase(), notas: null, ...f })

describe('planCargaMasiva', () => {
  const opts = { contadores, tarifas, ultimas: ultimasLecturas(registros) }

  it('encadena las lecturas del mismo contador por fecha y estima consumo e importe', () => {
    const plan = planCargaMasiva([
      fila({ fila: 2, contadorId: 'c1', fecha: '2026-11-30', lectura: 150 }),
      fila({ fila: 3, contadorId: 'c1', fecha: '2026-11-15', lectura: 140 }),
      fila({ fila: 4, contadorId: 'c2', fecha: '2026-11-15', lectura: 8 }),
    ], opts)
    expect(plan.filas.map(f => [f.fila, f.anterior, f.consumo, f.importe, f.error])).toEqual([
      [3, 130, 10, 50, null],
      [2, 140, 10, 50, null],
      [4, 0, 8, 40, null],
    ])
    expect(plan).toMatchObject({ totalConsumo: 28, totalImporte: 140, conError: 0 })
  })

  it('una fila que baja respecto de la anterior del archivo no entra, y las siguientes de ese contador tampoco', () => {
    const plan = planCargaMasiva([
      fila({ fila: 2, contadorId: 'c1', fecha: '2026-11-10', lectura: 160 }),
      fila({ fila: 3, contadorId: 'c1', fecha: '2026-11-12', lectura: 150 }),
      fila({ fila: 4, contadorId: 'c1', fecha: '2026-11-14', lectura: 170 }),
      fila({ fila: 5, contadorId: 'c2', fecha: '2026-11-14', lectura: 3 }),
      fila({ fila: 6, contadorId: 'c2', fecha: '2026-11-14', lectura: 3 }),
    ], opts)
    expect(plan.filas.map(f => [f.fila, f.error])).toEqual([
      [2, null],
      [3, 'menor que la lectura de la fila 2 (160)'],
      [4, 'no se registrará: la fila 3 del mismo contador no entra'],
      [5, null],
      [6, 'repetida en el archivo (igual a la fila 5): se omite'],
    ])
    expect(plan).toMatchObject({ conError: 3, totalConsumo: 33 })
  })

  it('avisa del consumo 3× por encima del promedio del contador y del consumo cero', () => {
    const plan = planCargaMasiva([
      fila({ fila: 2, contadorId: 'c1', fecha: '2026-11-30', lectura: 170 }),
      fila({ fila: 3, contadorId: 'c2', fecha: '2026-11-30', lectura: 0 }),
    ], { ...opts, promedio: id => (id === 'c1' ? 10 : null) })
    expect(plan.filas.map(f => f.aviso)).toEqual(['4× su promedio (10 m³)', 'consumo 0'])
    expect(plan.conAviso).toBe(2)
  })
})

describe('ejecutarCargaMasiva', () => {
  const ok = (f: FilaCargaMasiva): ResultadoRegistro =>
    ({ data: { id: `r${f.fila}`, consumo: 10, monto_calculado: 50 } as unknown as Registro, error: null, duplicado: false })

  it('manda las de cada contador en orden de fecha y deja de mandar las de un contador que falló', async () => {
    const orden: number[] = []
    const registrar = vi.fn(async (f: FilaCargaMasiva): Promise<ResultadoRegistro> => {
      orden.push(f.fila)
      if (f.fila === 3) return { data: null, error: 'la lectura actual (150) es menor que la anterior (160)', duplicado: false }
      if (f.fila === 6) return { data: null, error: 'ya registrada', duplicado: true }
      return ok(f)
    })
    const progreso = vi.fn()
    const res = await ejecutarCargaMasiva([
      fila({ fila: 4, contadorId: 'c1', fecha: '2026-11-20', lectura: 170 }),
      fila({ fila: 3, contadorId: 'c1', fecha: '2026-11-12', lectura: 150 }),
      fila({ fila: 2, contadorId: 'c1', fecha: '2026-11-10', lectura: 160 }),
      fila({ fila: 5, contadorId: 'c2', fecha: '2026-11-14', lectura: 3 }),
      fila({ fila: 6, contadorId: 'c2', fecha: '2026-11-15', lectura: 4 }),
    ], registrar, { concurrencia: 1, onProgreso: progreso })

    expect(orden).toEqual([2, 3, 5, 6])
    expect(res.map(r => [r.fila, r.estado, r.error ?? null])).toEqual([
      [2, 'registrada', null],
      [3, 'rechazada', 'la lectura actual (150) es menor que la anterior (160)'],
      [4, 'omitida', 'no se intentó: falló la fila 3 del mismo contador'],
      [5, 'registrada', null],
      [6, 'ya_estaba', null],
    ])
    expect(progreso).toHaveBeenLastCalledWith(5, 5)
    expect(resumenCarga(res)).toEqual({ registradas: 2, yaEstaban: 1, rechazadas: 1, omitidas: 1, consumo: 20, importe: 100 })
  })

  it('varios contadores a la vez, pero nunca dos lecturas del mismo contador al mismo tiempo', async () => {
    let enCurso = 0
    let maximo = 0
    const porContador = new Map<string, number>()
    const registrar = async (f: FilaCargaMasiva) => {
      enCurso += 1
      maximo = Math.max(maximo, enCurso)
      porContador.set(f.contadorId, (porContador.get(f.contadorId) ?? 0) + 1)
      expect(porContador.get(f.contadorId)).toBe(1)
      await new Promise(r => setTimeout(r, 5))
      porContador.set(f.contadorId, porContador.get(f.contadorId)! - 1)
      enCurso -= 1
      return ok(f)
    }
    const filas = ['a', 'b', 'c', 'd', 'e', 'f'].flatMap((c, i) => [
      fila({ fila: i * 2 + 2, contadorId: c, fecha: '2026-11-10', lectura: 1 }),
      fila({ fila: i * 2 + 3, contadorId: c, fecha: '2026-11-11', lectura: 2 }),
    ])
    const res = await ejecutarCargaMasiva(filas, registrar, { concurrencia: 3 })
    expect(maximo).toBe(3)
    expect(res.every(r => r.estado === 'registrada')).toBe(true)
  })

  it('un error de red cuenta como rechazada, no corta la carga', async () => {
    const res = await ejecutarCargaMasiva(
      [fila({ fila: 2, contadorId: 'c1', fecha: '2026-11-10', lectura: 1 }), fila({ fila: 3, contadorId: 'c2', fecha: '2026-11-10', lectura: 1 })],
      async f => { if (f.fila === 2) throw new Error('Failed to fetch'); return ok(f) },
    )
    expect(res.map(r => [r.estado, r.error ?? null])).toEqual([['rechazada', 'Failed to fetch'], ['registrada', null]])
  })
})
