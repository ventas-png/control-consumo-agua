// Carga masiva de lecturas desde Excel: las lecturas REALES del mes (las que
// se cobran), no el historial de referencia.
//
// Cada fila entra por `registrar_lectura`, la misma RPC de «Nueva Lectura»: la
// lectura anterior, el consumo, la tarifa y el importe los decide el servidor
// bajo el bloqueo del contador. Lo de aquí es lo que se puede saber ANTES de
// mandar nada —para que el preview diga qué va a pasar— y el orden en que se
// mandan: por contador y por fecha, porque cada lectura encadena con la
// anterior del mismo contador.
import type { Contador, Registro, Tarifa } from '../types'
import { calcularCostoTarifa } from './business'
import { claveSerie, leerNumeroHistorial, normalizarFechaHistorial } from './historialConsumo'

/** Igual que el aviso de «Nueva Lectura» (validarLectura): 3× el promedio. */
export const FACTOR_CONSUMO_ANORMAL = 3

/** Una fila ya validada, lista para registrarse. */
export interface FilaCargaMasiva {
  /** Número de fila en la hoja, para que el resultado diga cuál. */
  fila: number
  contadorId: string
  /** Número de serie del contador, como está en Contadores. */
  contador: string
  /** AAAA-MM-DD */
  fecha: string
  lectura: number
  notas: string | null
}

export interface UltimaLectura {
  lectura: number
  /** AAAA-MM-DD */
  fecha: string
}

type RegistroMin = Pick<Registro, 'contador_id' | 'lectura_actual' | 'fecha'> & { created_at?: string | null }
type ContadorMin = Pick<Contador, 'id' | 'numero_serie' | 'project_id' | 'activo' | 'tarifa_id' | 'lectura_inicial'>
  & Partial<Pick<Contador, 'cantidad_derecho_servicio_m3'>>
type TarifaMin = Pick<Tarifa, 'id' | 'activa'>
/** Misma forma que `RowValidationResult` del ImportModal (lib no depende de components). */
type Validacion<T> = { ok: true; data: T } | { ok: false; errors: string[] }

const dia = (fecha: string) => fecha.slice(0, 10)
const llaveNatural = (contadorId: string, fecha: string, lectura: number) => `${contadorId}|${fecha}|${lectura}`

/** La lectura vigente de cada contador según lo que la pantalla ya tiene cargado. */
export function ultimasLecturas(registros: RegistroMin[]): Map<string, UltimaLectura> {
  const ultimas = new Map<string, UltimaLectura & { orden: string }>()
  for (const r of registros) {
    if (!r.contador_id || typeof r.lectura_actual !== 'number') continue
    const orden = `${r.fecha ?? ''}|${r.created_at ?? ''}`
    const prev = ultimas.get(r.contador_id)
    if (!prev || orden > prev.orden) {
      ultimas.set(r.contador_id, { lectura: r.lectura_actual, fecha: dia(r.fecha), orden })
    }
  }
  return new Map([...ultimas].map(([id, u]) => [id, { lectura: u.lectura, fecha: u.fecha }]))
}

/** Las lecturas que ya existen, por (contador · día · lectura): la llave anti-duplicado de la base. */
export function lecturasExistentes(registros: RegistroMin[]): Set<string> {
  const set = new Set<string>()
  for (const r of registros) {
    if (r.contador_id && typeof r.lectura_actual === 'number') set.add(llaveNatural(r.contador_id, dia(r.fecha), r.lectura_actual))
  }
  return set
}

export interface ContextoValidacion {
  contadores: ContadorMin[]
  tarifas: TarifaMin[]
  /** Proyecto elegido; vacío = todavía no se eligió. */
  projectId: string
  /** Fecha para las filas que no traen la suya (AAAA-MM-DD). */
  fechaDefecto: string
  ultimas: Map<string, UltimaLectura>
  existentes: Set<string>
  /** Hoy, AAAA-MM-DD. */
  hoy: string
}

const SOLO_MES = /^\s*(\d{4}-\d{1,2}|\d{1,2}[/-]\d{4})\s*$/

/**
 * Valida una fila contra lo que se sabe en el navegador. No reemplaza al
 * servidor (que vuelve a decidir todo bajo el bloqueo del contador): sirve para
 * que lo que seguro va a fallar se vea en el preview, antes de mandar nada.
 */
export function validarFilaCargaMasiva(
  row: Record<string, unknown>,
  rowNumber: number,
  ctx: ContextoValidacion,
): Validacion<FilaCargaMasiva> {
  const errors: string[] = []

  const serie = String(row['contador'] ?? '').trim()
  let contador: ContadorMin | null = null
  if (!serie) {
    errors.push('contador es obligatorio (el número como aparece en Contadores)')
  } else if (!ctx.projectId) {
    errors.push('elija el proyecto')
  } else {
    const candidatos = ctx.contadores.filter(c => c.project_id === ctx.projectId && claveSerie(c.numero_serie) === claveSerie(serie))
    if (candidatos.length === 0) {
      errors.push(`el contador «${serie}» no existe en el proyecto elegido`)
    } else if (candidatos.length > 1) {
      errors.push(`hay ${candidatos.length} contadores «${serie}» en el proyecto: corrija el número repetido`)
    } else {
      contador = candidatos[0]
      if (!contador.activo) {
        errors.push(`el contador «${contador.numero_serie}» está inactivo`)
      } else if (!contador.tarifa_id) {
        errors.push(`el contador «${contador.numero_serie}» no tiene tarifa asignada`)
      } else {
        const tarifa = ctx.tarifas.find(t => t.id === contador!.tarifa_id)
        if (tarifa && !tarifa.activa) errors.push(`la tarifa del contador «${contador.numero_serie}» no está vigente`)
      }
    }
  }

  const rawFecha = row['fecha']
  const sinFecha = rawFecha === undefined || rawFecha === null || String(rawFecha).trim() === ''
  let fecha: string | null = null
  if (sinFecha) {
    if (ctx.fechaDefecto) fecha = ctx.fechaDefecto
    else errors.push('falta la fecha')
  } else if (typeof rawFecha === 'string' && SOLO_MES.test(rawFecha)) {
    errors.push(`la fecha «${rawFecha.trim()}» es sólo el mes: una lectura que se cobra necesita el día`)
  } else {
    fecha = normalizarFechaHistorial(rawFecha)
    if (!fecha) errors.push(`fecha inválida «${String(rawFecha)}» — use AAAA-MM-DD o DD/MM/AAAA`)
  }
  if (fecha && fecha > ctx.hoy) {
    errors.push(`la fecha ${fecha} está en el futuro`)
    fecha = null
  }

  const lectura = leerNumeroHistorial(row['lectura'])
  if (lectura === null) errors.push('falta la lectura')
  else if (Number.isNaN(lectura) || lectura < 0) errors.push(`lectura inválida «${String(row['lectura'])}»`)

  const lecturaOk = lectura !== null && !Number.isNaN(lectura) && lectura >= 0
  if (contador && fecha && lecturaOk) {
    const ultima = ctx.ultimas.get(contador.id)
    if (ctx.existentes.has(llaveNatural(contador.id, fecha, lectura))) {
      errors.push(`ya está registrada (${contador.numero_serie}, ${fecha}, ${lectura})`)
    } else if (ultima && fecha < ultima.fecha) {
      errors.push(`fecha anterior a la última lectura del contador (${ultima.fecha}): no se registran lecturas retroactivas`)
    } else {
      const anterior = ultima ? ultima.lectura : Number(contador.lectura_inicial ?? 0)
      if (lectura < anterior) {
        errors.push(`la lectura (${lectura}) es menor que la anterior (${anterior}); un cambio de medidor se registra desde Nueva Lectura`)
      }
    }
  }

  if (errors.length) return { ok: false, errors }
  const notas = String(row['notas'] ?? '').trim()
  return {
    ok: true,
    data: {
      fila: rowNumber,
      contadorId: contador!.id,
      contador: contador!.numero_serie,
      fecha: fecha!,
      lectura: lectura!,
      notas: notas || null,
    },
  }
}

/** Por contador y, dentro de cada uno, por fecha y lectura: el orden en que encadenan. */
export function ordenarFilas<F extends Pick<FilaCargaMasiva, 'contadorId' | 'fecha' | 'lectura' | 'fila'>>(filas: F[]): F[] {
  return [...filas].sort((a, b) =>
    a.contadorId.localeCompare(b.contadorId) || a.fecha.localeCompare(b.fecha) || a.lectura - b.lectura || a.fila - b.fila)
}

export interface FilaPlan extends FilaCargaMasiva {
  anterior: number
  consumo: number
  /** Estimado con la tarifa que la pantalla tiene; el importe real lo calcula el servidor. */
  importe: number | null
  promedio: number | null
  /** Aviso que no impide registrar (consumo anómalo). */
  aviso: string | null
  /** Lo que el servidor va a rechazar por cómo encadena con otra fila del archivo. */
  error: string | null
}

export interface PlanCargaMasiva {
  filas: FilaPlan[]
  totalConsumo: number
  totalImporte: number
  conAviso: number
  conError: number
}

/**
 * Cómo quedaría cada fila: encadena las del mismo contador en orden de fecha
 * (la segunda parte de la primera) y estima consumo e importe. Marca lo que el
 * servidor va a rechazar por encadenamiento y avisa del consumo anómalo.
 */
export function planCargaMasiva(
  filas: FilaCargaMasiva[],
  opts: {
    contadores: ContadorMin[]
    tarifas: Tarifa[]
    ultimas: Map<string, UltimaLectura>
    /** Promedio reciente del contador a la fecha de la fila (historial + sistema). */
    promedio?: (contadorId: string, fecha: string) => number | null
  },
): PlanCargaMasiva {
  const porId = new Map(opts.contadores.map(c => [c.id, c]))
  const tarifaPorId = new Map(opts.tarifas.map(t => [t.id, t]))
  const plan: FilaPlan[] = []
  // El estado del contador mientras se recorre el archivo: de qué lectura parte
  // la fila siguiente y si alguna anterior no va a entrar.
  let actual: { contadorId: string; lectura: number; fecha: string | null; fila: number | null; fallo: number | null } | null = null
  for (const f of ordenarFilas(filas)) {
    const c = porId.get(f.contadorId)
    if (!actual || actual.contadorId !== f.contadorId) {
      const ultima = opts.ultimas.get(f.contadorId)
      actual = { contadorId: f.contadorId, lectura: ultima ? ultima.lectura : Number(c?.lectura_inicial ?? 0), fecha: null, fila: null, fallo: null }
    }
    const anterior = actual.lectura
    let error: string | null = null
    if (actual.fallo !== null) {
      error = `no se registrará: la fila ${actual.fallo} del mismo contador no entra`
    } else if (actual.fecha === f.fecha && actual.lectura === f.lectura) {
      error = `repetida en el archivo (igual a la fila ${actual.fila}): se omite`
    } else if (f.lectura < anterior) {
      error = `menor que la lectura de la fila ${actual.fila} (${anterior})`
      actual.fallo = f.fila
    }
    const consumo = error ? 0 : Math.round((f.lectura - anterior) * 10000) / 10000
    const tarifa = c?.tarifa_id ? tarifaPorId.get(c.tarifa_id) : undefined
    const importe = !error && tarifa
      ? calcularCostoTarifa(consumo, tarifa, c?.cantidad_derecho_servicio_m3 ?? null).total
      : null
    const promedio = opts.promedio?.(f.contadorId, f.fecha) ?? null
    let aviso: string | null = null
    if (!error && promedio && promedio > 0 && consumo > promedio * FACTOR_CONSUMO_ANORMAL) {
      aviso = `${Math.round((consumo / promedio) * 10) / 10}× su promedio (${Math.round(promedio * 100) / 100} m³)`
    } else if (!error && consumo === 0) {
      aviso = 'consumo 0'
    }
    plan.push({ ...f, anterior, consumo, importe, promedio, aviso, error })
    if (!error) Object.assign(actual, { lectura: f.lectura, fecha: f.fecha, fila: f.fila })
  }
  const validas = plan.filter(p => !p.error)
  return {
    filas: plan,
    totalConsumo: Math.round(validas.reduce((a, p) => a + p.consumo, 0) * 10000) / 10000,
    totalImporte: Math.round(validas.reduce((a, p) => a + (p.importe ?? 0), 0) * 100) / 100,
    conAviso: validas.filter(p => p.aviso).length,
    conError: plan.length - validas.length,
  }
}

export type EstadoCarga = 'registrada' | 'ya_estaba' | 'rechazada' | 'omitida'

export interface ResultadoFila extends FilaCargaMasiva {
  estado: EstadoCarga
  registro?: Registro
  error?: string
}

export interface ResultadoRegistro {
  data: Registro | null
  error: string | null
  duplicado: boolean
}

/**
 * Registra las filas: un contador a la vez por «carril» (sus lecturas en orden,
 * porque cada una parte de la anterior) y varios contadores en paralelo. Si una
 * lectura de un contador falla, las siguientes de ESE contador no se mandan:
 * partirían de una lectura que no quedó y el consumo saldría mal.
 *
 * No se detiene por un error: cada lectura es independiente de las de otros
 * contadores, y el resultado dice fila por fila qué pasó. Volver a subir el
 * mismo archivo es seguro: lo que ya entró vuelve como «ya estaba».
 */
export async function ejecutarCargaMasiva(
  filas: FilaCargaMasiva[],
  registrar: (fila: FilaCargaMasiva) => Promise<ResultadoRegistro>,
  opts: { concurrencia?: number; onProgreso?: (hechas: number, total: number) => void } = {},
): Promise<ResultadoFila[]> {
  const grupos = new Map<string, FilaCargaMasiva[]>()
  for (const f of ordenarFilas(filas)) {
    const g = grupos.get(f.contadorId)
    if (g) g.push(f)
    else grupos.set(f.contadorId, [f])
  }
  const cola = [...grupos.values()]
  const resultados: ResultadoFila[] = []
  let hechas = 0
  const avanzar = (r: ResultadoFila) => {
    resultados.push(r)
    hechas += 1
    opts.onProgreso?.(hechas, filas.length)
  }

  async function carril() {
    for (let grupo = cola.shift(); grupo; grupo = cola.shift()) {
      let fallo: FilaCargaMasiva | null = null
      for (const f of grupo) {
        if (fallo) {
          avanzar({ ...f, estado: 'omitida', error: `no se intentó: falló la fila ${fallo.fila} del mismo contador` })
          continue
        }
        let r: ResultadoRegistro
        try {
          r = await registrar(f)
        } catch (e) {
          r = { data: null, error: e instanceof Error ? e.message : String(e), duplicado: false }
        }
        if (r.duplicado) avanzar({ ...f, estado: 'ya_estaba' })
        else if (r.error || !r.data) {
          fallo = f
          avanzar({ ...f, estado: 'rechazada', error: r.error ?? 'el servidor no devolvió la lectura' })
        } else avanzar({ ...f, estado: 'registrada', registro: r.data })
      }
    }
  }

  const n = Math.max(1, Math.min(opts.concurrencia ?? 4, cola.length))
  await Promise.all(Array.from({ length: n }, carril))
  return resultados.sort((a, b) => a.fila - b.fila)
}

/** Las cuentas del final. */
export function resumenCarga(resultados: ResultadoFila[]) {
  const por = (e: EstadoCarga) => resultados.filter(r => r.estado === e)
  const registradas = por('registrada')
  return {
    registradas: registradas.length,
    yaEstaban: por('ya_estaba').length,
    rechazadas: por('rechazada').length,
    omitidas: por('omitida').length,
    consumo: Math.round(registradas.reduce((a, r) => a + Number(r.registro?.consumo ?? 0), 0) * 10000) / 10000,
    importe: Math.round(registradas.reduce((a, r) => a + Number(r.registro?.monto_calculado ?? 0), 0) * 100) / 100,
  }
}
