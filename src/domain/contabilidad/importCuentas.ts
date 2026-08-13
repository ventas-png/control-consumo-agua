// Contabilidad — CARGA MASIVA del catálogo de cuentas (lógica pura, testeable).
//
// El archivo que sube el usuario trae una fila por cuenta y referencia al padre
// por CÓDIGO (no por uuid, que el usuario no conoce). Este módulo hace dos
// cosas, ambas sin tocar la red:
//
//   1. `validarFilaCuenta` — normaliza y valida UNA fila del XLSX/CSV.
//   2. `planificarCatalogo` — cruza las filas válidas contra el catálogo que ya
//      existe en el ledger destino y devuelve el PLAN: qué crear (en orden
//      padres→hijos, con su nivel ya calculado), qué actualizar y qué se omite
//      y por qué.
//
// El plan se calcula UNA VEZ POR LEDGER: el mismo archivo se puede aplicar a la
// contabilidad de la empresa y a la de cada proyecto, y en cada una el código
// padre resuelve contra las cuentas de ESE ledger (unicidad de código es por
// ledger — ver uq_conta_cuentas_ledger_codigo).
import { NATURALEZA_POR_TIPO, type NaturalezaCuenta, type TipoCuenta } from '../../types/contabilidad'
import { normalizarMoneda } from './schemas'

/** Nivel máximo del catálogo (CHECK nivel BETWEEN 1 AND 5 en BD). */
export const NIVEL_MAXIMO = 5

/** Fila del archivo ya normalizada (aún sin ubicar en el árbol). */
export interface CuentaImportFila {
  codigo: string
  nombre: string
  tipo: TipoCuenta
  naturaleza: NaturalezaCuenta
  /** Código del padre tal como vino en el archivo; null = inferir/raíz. */
  padre_codigo: string | null
  es_detalle: boolean
  moneda: string | null
  descripcion: string | null
}

export type FilaCuentaResultado =
  | { ok: true; data: CuentaImportFila }
  | { ok: false; errors: string[] }

/** Cuenta que YA existe en el ledger destino. */
export interface CuentaExistenteRef {
  id: string
  codigo: string
  nivel: number
}

export interface CuentaPlanCrear {
  fila: CuentaImportFila
  /** Nivel calculado (1..5) a partir de la cadena de padres. */
  nivel: number
  /** Código del padre ya resuelto (null = cuenta raíz). */
  padre_codigo: string | null
}

export interface CuentaPlanActualizar {
  id: string
  fila: CuentaImportFila
  /** Nivel actual en BD: una cuenta existente NO se mueve de rama. */
  nivel: number
}

export interface CuentaOmitida {
  codigo: string
  motivo: string
}

export interface PlanCatalogo {
  /** Orden topológico: el padre siempre va antes que sus hijos. */
  crear: CuentaPlanCrear[]
  actualizar: CuentaPlanActualizar[]
  omitidas: CuentaOmitida[]
}

// ── Normalización de celdas ─────────────────────────────────────────────────

const TIPOS_VALIDOS: TipoCuenta[] = ['activo', 'pasivo', 'capital', 'ingreso', 'gasto']

/** Sinónimos aceptados en la columna `tipo` (el plural y el uso local). */
const TIPO_SINONIMOS: Record<string, TipoCuenta> = {
  activos: 'activo',
  pasivos: 'pasivo',
  patrimonio: 'capital',
  capitales: 'capital',
  ingresos: 'ingreso',
  venta: 'ingreso',
  ventas: 'ingreso',
  gastos: 'gasto',
  egreso: 'gasto',
  egresos: 'gasto',
  costo: 'gasto',
  costos: 'gasto',
}

function sinAcentos(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function texto(raw: unknown): string {
  if (raw === null || raw === undefined) return ''
  return String(raw).trim()
}

/** Booleano tolerante: sí/si/s/x/true/1/detalle vs no/n/false/0/agrupadora. */
export function parseBooleano(raw: unknown, porDefecto: boolean): boolean | null {
  if (typeof raw === 'boolean') return raw
  const t = sinAcentos(texto(raw)).toLowerCase()
  if (t === '') return porDefecto
  if (['si', 's', 'x', 'true', 'verdadero', '1', 'detalle', 'y', 'yes'].includes(t)) return true
  if (['no', 'n', 'false', 'falso', '0', 'agrupadora', 'agrupador', 'grupo'].includes(t)) return false
  return null
}

/**
 * Padre implícito según la convención de códigos del catálogo semilla
 * ('1' → '11' → '1102' → '1102-01'). Solo se usa cuando la fila NO trae
 * `padre_codigo` Y el código inferido existe: si no existe, la cuenta se crea
 * como raíz (un `padre_codigo` escrito a mano que no resuelve SÍ es error, ahí
 * la intención del usuario es explícita).
 */
export function inferirPadreCodigo(codigo: string): string | null {
  const c = codigo.trim()
  if (c.includes('-')) {
    const padre = c.slice(0, c.lastIndexOf('-'))
    return padre || null
  }
  // Sin guion la convención es posicional y solo aplica a códigos numéricos;
  // un código alfabético ('CAJA') se toma como raíz salvo padre_codigo explícito.
  if (!/^\d+$/.test(c) || c.length <= 1) return null
  if (c.length === 2) return c.slice(0, 1)
  return c.slice(0, 2)
}

/** Valida y normaliza una fila cruda del archivo. */
export function validarFilaCuenta(row: Record<string, unknown>): FilaCuentaResultado {
  const errors: string[] = []

  const codigo = texto(row['codigo'])
  if (!codigo) errors.push('codigo es obligatorio')
  else if (codigo.length > 20) errors.push('codigo no puede exceder 20 caracteres')
  else if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(codigo))
    errors.push(`codigo inválido: "${codigo}" — use letras, números, punto o guion (ej. 1102-01)`)

  const nombre = texto(row['nombre'])
  if (nombre.length < 2) errors.push('nombre es obligatorio (mín. 2 caracteres)')
  else if (nombre.length > 120) errors.push('nombre no puede exceder 120 caracteres')

  const tipoRaw = sinAcentos(texto(row['tipo'])).toLowerCase()
  const tipo = (TIPOS_VALIDOS as string[]).includes(tipoRaw)
    ? (tipoRaw as TipoCuenta)
    : TIPO_SINONIMOS[tipoRaw]
  if (!tipo) errors.push(`tipo inválido: "${texto(row['tipo'])}" — use: ${TIPOS_VALIDOS.join(', ')}`)

  const naturalezaRaw = sinAcentos(texto(row['naturaleza'])).toLowerCase()
  let naturaleza: NaturalezaCuenta | undefined
  if (naturalezaRaw === '') naturaleza = tipo ? NATURALEZA_POR_TIPO[tipo] : undefined
  else if (['deudora', 'deudor', 'debito', 'debe'].includes(naturalezaRaw)) naturaleza = 'deudora'
  else if (['acreedora', 'acreedor', 'credito', 'haber'].includes(naturalezaRaw)) naturaleza = 'acreedora'
  else errors.push(`naturaleza inválida: "${texto(row['naturaleza'])}" — use deudora o acreedora`)

  const esDetalle = parseBooleano(row['es_detalle'], true)
  if (esDetalle === null)
    errors.push(`es_detalle inválido: "${texto(row['es_detalle'])}" — use sí/no`)

  const monedaRaw = texto(row['moneda'])
  const moneda = monedaRaw === '' ? null : normalizarMoneda(monedaRaw)
  if (moneda !== null && !/^[A-Z]{3}$/.test(moneda))
    errors.push(`moneda inválida: "${monedaRaw}" — código ISO de 3 letras (ej. USD) o vacío`)

  const descripcion = texto(row['descripcion'])
  if (descripcion.length > 500) errors.push('descripcion no puede exceder 500 caracteres')

  const padreCodigo = texto(row['padre_codigo'])
  if (padreCodigo && padreCodigo === codigo) errors.push('padre_codigo no puede ser la misma cuenta')
  if (padreCodigo.length > 20) errors.push('padre_codigo no puede exceder 20 caracteres')

  if (errors.length > 0 || !tipo || !naturaleza || esDetalle === null) {
    return { ok: false, errors: errors.length > 0 ? errors : ['Fila inválida'] }
  }

  return {
    ok: true,
    data: {
      codigo,
      nombre,
      tipo,
      naturaleza,
      padre_codigo: padreCodigo || null,
      es_detalle: esDetalle,
      moneda,
      descripcion: descripcion || null,
    },
  }
}

// ── Planificación contra el catálogo del ledger ─────────────────────────────

type ResolucionNivel = { ok: true; nivel: number } | { ok: false; motivo: string }

export interface OpcionesPlan {
  /**
   * true = las cuentas cuyo código YA existe en el ledger se actualizan
   * (nombre, tipo, naturaleza, detalle, moneda, descripción). Nunca se mueven
   * de rama: cambiar el padre de una cuenta con movimientos rompe los saldos
   * históricos, eso se hace a mano desde la ficha de la cuenta.
   */
  actualizarExistentes?: boolean
}

/**
 * Cruza las filas del archivo con el catálogo existente y devuelve el plan de
 * escritura. No hace I/O: el caller decide cómo aplicarlo.
 */
export function planificarCatalogo(
  filas: CuentaImportFila[],
  existentes: CuentaExistenteRef[],
  opciones: OpcionesPlan = {},
): PlanCatalogo {
  const omitidas: CuentaOmitida[] = []
  const existentesPorCodigo = new Map(existentes.map((c) => [c.codigo, c]))

  // Duplicados dentro del archivo: gana la primera aparición.
  const porCodigo = new Map<string, CuentaImportFila>()
  for (const fila of filas) {
    if (porCodigo.has(fila.codigo)) {
      omitidas.push({ codigo: fila.codigo, motivo: 'código repetido en el archivo (se usó la primera fila)' })
      continue
    }
    porCodigo.set(fila.codigo, fila)
  }

  // Padre efectivo de cada fila. El declarado manda siempre (si no resuelve es
  // un error, no una cuenta raíz por accidente). El inferido por convención de
  // código solo se usa cuando EXISTE: así el archivo que arranca en '52' sin
  // traer la clase '5' crea '52' como raíz en vez de fallar.
  const padreResuelto = new Map<string, string | null>()
  for (const fila of porCodigo.values()) {
    const explicito = fila.padre_codigo?.trim()
    if (explicito) {
      padreResuelto.set(fila.codigo, explicito)
      continue
    }
    const inferido = inferirPadreCodigo(fila.codigo)
    const resuelve = !!inferido && (porCodigo.has(inferido) || existentesPorCodigo.has(inferido))
    padreResuelto.set(fila.codigo, resuelve ? inferido : null)
  }

  // Códigos que son padre de alguna otra fila del archivo: una cuenta con
  // hijos AGRUPA, no recibe movimientos (la publicación de pólizas exige
  // cuenta de detalle, así que el dato incoherente se corrige aquí).
  const conHijos = new Set<string>()
  for (const codigo of porCodigo.keys()) {
    const padre = padreResuelto.get(codigo)
    if (padre && porCodigo.has(padre)) conHijos.add(padre)
  }

  const cache = new Map<string, ResolucionNivel>()

  function resolverNivel(codigo: string, enCurso: Set<string>): ResolucionNivel {
    const cacheado = cache.get(codigo)
    if (cacheado) return cacheado
    if (enCurso.has(codigo)) {
      // Ciclo: no se cachea (el resultado depende del punto de entrada).
      return { ok: false, motivo: 'referencia circular entre cuentas padre' }
    }

    const fila = porCodigo.get(codigo)
    const existente = existentesPorCodigo.get(codigo)

    let resultado: ResolucionNivel
    if (existente) {
      // Ya está en el árbol del ledger: conserva su nivel.
      resultado = { ok: true, nivel: existente.nivel }
    } else if (!fila) {
      resultado = {
        ok: false,
        motivo: `la cuenta padre "${codigo}" no existe en el catálogo ni viene en el archivo`,
      }
    } else {
      const padre = padreResuelto.get(codigo) ?? null
      if (!padre) {
        resultado = { ok: true, nivel: 1 }
      } else {
        enCurso.add(codigo)
        const rp = resolverNivel(padre, enCurso)
        enCurso.delete(codigo)
        if (!rp.ok) {
          resultado = { ok: false, motivo: rp.motivo }
        } else if (rp.nivel >= NIVEL_MAXIMO) {
          resultado = {
            ok: false,
            motivo: `excede el nivel máximo (${NIVEL_MAXIMO}): su padre "${padre}" ya está en el nivel ${rp.nivel}`,
          }
        } else {
          resultado = { ok: true, nivel: rp.nivel + 1 }
        }
      }
    }

    cache.set(codigo, resultado)
    return resultado
  }

  const crear: CuentaPlanCrear[] = []
  const actualizar: CuentaPlanActualizar[] = []

  for (const fila of porCodigo.values()) {
    const existente = existentesPorCodigo.get(fila.codigo)
    const normalizada: CuentaImportFila = conHijos.has(fila.codigo)
      ? { ...fila, es_detalle: false }
      : fila

    if (existente) {
      if (opciones.actualizarExistentes) {
        actualizar.push({ id: existente.id, fila: normalizada, nivel: existente.nivel })
      } else {
        omitidas.push({ codigo: fila.codigo, motivo: 'ya existe en esta contabilidad' })
      }
      continue
    }

    const nivel = resolverNivel(fila.codigo, new Set())
    if (!nivel.ok) {
      omitidas.push({ codigo: fila.codigo, motivo: nivel.motivo })
      continue
    }
    crear.push({ fila: normalizada, nivel: nivel.nivel, padre_codigo: padreResuelto.get(fila.codigo) ?? null })
  }

  // Padres primero: el insert por niveles ascendentes garantiza que el
  // padre_id ya está disponible cuando toca insertar a los hijos.
  crear.sort((a, b) => a.nivel - b.nivel || a.fila.codigo.localeCompare(b.fila.codigo, 'es'))
  actualizar.sort((a, b) => a.fila.codigo.localeCompare(b.fila.codigo, 'es'))

  return { crear, actualizar, omitidas }
}
