// Contabilidad — CARGA MASIVA del catálogo de cuentas (lógica pura, testeable).
//
// FORMATO DEL ARCHIVO (el de la plantilla): una COLUMNA POR NIVEL, `n_1`..`n_8`,
// con 0 en los niveles que la cuenta no usa. La jerarquía se lee sola y el
// código de la cuenta sale de unir los niveles con punto:
//
//   n_1 n_2 n_3 n_4 n_5 …  nombre                     → código   nivel  padre
//    1   0   0   0   0      ACTIVO                       1          1     —
//    1   1   0   0   0      NO CORRIENTE                 1.1        2     1
//    1   1   1   0   0      PROPIEDAD PLANTA Y EQUIPO    1.1.1      3     1.1
//    1   1   1   1   0      Vehículos                    1.1.1.1    4     1.1.1
//    1   1   1   1   1      Pick-up Toyota 2020          1.1.1.1.1  5     1.1.1.1
//
// El árbol llega hasta `n_8`; las columnas que sobran se dejan en 0.
//
// Por qué así y no una columna `codigo` con guiones: Excel convierte `1102-03`
// en una FECHA en cuanto la celda se toca, y el catálogo entraba corrupto sin
// que nadie lo notara. Con columnas numéricas no hay nada que autoformatear, y
// de paso el padre deja de escribirse a mano (era la otra fuente de errores).
//
// `tipo` y `naturaleza` se HEREDAN del padre cuando la celda va vacía: en un
// catálogo real solo el nivel 1 declara el tipo, y la naturaleza únicamente se
// escribe donde va contra-natura (depreciación acumulada y sus hijas).
//
// Se sigue aceptando el formato viejo (`codigo` + `padre_codigo`) para los
// archivos ya armados; ver `validarFilaCuenta`.
//
// Este módulo no toca la red. Hace dos cosas:
//   1. `validarFilaCuenta` — normaliza y valida UNA fila del XLSX/CSV.
//   2. `planificarCatalogo` — cruza las filas con el catálogo que ya existe en
//      el ledger destino y devuelve el PLAN: qué crear (en orden padres→hijos,
//      con nivel, tipo y naturaleza ya resueltos), qué actualizar, y qué se
//      omite y por qué.
//
// El plan se calcula UNA VEZ POR LEDGER: el mismo archivo se puede aplicar a la
// contabilidad de la empresa y a la de cada proyecto, y en cada una los códigos
// resuelven contra las cuentas de ESE ledger (la unicidad de código es por
// ledger — ver uq_conta_cuentas_ledger_codigo).
import { NATURALEZA_POR_TIPO, type NaturalezaCuenta, type TipoCuenta } from '../../types/contabilidad'
import { normalizarMoneda } from './schemas'

/** Nivel máximo del catálogo (CHECK nivel BETWEEN 1 AND 8 en BD). */
export const NIVEL_MAXIMO = 8

/** Cabeceras de las columnas por nivel, en orden. */
export const COLUMNAS_NIVEL = ['n_1', 'n_2', 'n_3', 'n_4', 'n_5', 'n_6', 'n_7', 'n_8'] as const

/** Une los niveles del código: 1 · 1 · 3 → "1.1.3". */
export const SEPARADOR_NIVEL = '.'

/** Fila del archivo ya normalizada (aún sin ubicar en el árbol). */
export interface CuentaImportFila {
  codigo: string
  nombre: string
  /** null = se hereda de la cuenta padre (o de la cuenta ya existente). */
  tipo: TipoCuenta | null
  /** null = se hereda del padre; sin padre, se deriva del tipo. */
  naturaleza: NaturalezaCuenta | null
  /** Código del padre; null = raíz o (formato viejo) inferir del código. */
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
  tipo: TipoCuenta
  naturaleza: NaturalezaCuenta
}

/** Cuenta lista para escribir: sin nada pendiente de heredar. */
export interface CuentaResuelta {
  codigo: string
  nombre: string
  tipo: TipoCuenta
  naturaleza: NaturalezaCuenta
  es_detalle: boolean
  moneda: string | null
  descripcion: string | null
}

export interface CuentaPlanCrear {
  cuenta: CuentaResuelta
  /** Nivel calculado (1..8) a partir de la cadena de padres. */
  nivel: number
  /** Código del padre ya resuelto (null = cuenta raíz). */
  padre_codigo: string | null
}

export interface CuentaPlanActualizar {
  id: string
  cuenta: CuentaResuelta
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
 * Padre implícito del FORMATO VIEJO, según la convención del catálogo semilla
 * ('1' → '11' → '1102' → '1102-01'). Solo se usa cuando la fila no trae
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
  if (c.includes(SEPARADOR_NIVEL)) {
    const padre = c.slice(0, c.lastIndexOf(SEPARADOR_NIVEL))
    return padre || null
  }
  // Sin separador la convención es posicional y solo aplica a códigos numéricos;
  // un código alfabético ('CAJA') se toma como raíz salvo padre_codigo explícito.
  if (!/^\d+$/.test(c) || c.length <= 1) return null
  if (c.length === 2) return c.slice(0, 1)
  return c.slice(0, 2)
}

/**
 * Celda del nivel `i` (1-based). Se aceptan las tres cabeceras que aparecen en
 * los catálogos que ya circulan por la empresa: `n_1`, `nivel_1` y `n1`.
 */
function celdaNivel(row: Record<string, unknown>, i: number): string {
  for (const clave of [`n_${i}`, `nivel_${i}`, `n${i}`]) {
    const v = texto(row[clave])
    if (v !== '') return v
  }
  return ''
}

/** ¿La fila trae la jerarquía en columnas por nivel? */
function usaColumnasNivel(row: Record<string, unknown>): boolean {
  return COLUMNAS_NIVEL.some((_, i) => celdaNivel(row, i + 1) !== '')
}

interface Jerarquia {
  codigo: string
  padre_codigo: string | null
  nivel: number
}

/**
 * Lee `n_1`..`n_8` y arma código, padre y nivel. El 0 (o la celda vacía) marca
 * "esta cuenta no llega a este nivel", y una vez que aparece ya no puede volver
 * a haber número: 1·0·2 no describe ninguna cuenta.
 */
export function jerarquiaDesdeNiveles(
  row: Record<string, unknown>,
): { ok: true; data: Jerarquia } | { ok: false; errors: string[] } {
  const segmentos: number[] = []
  for (let i = 1; i <= COLUMNAS_NIVEL.length; i++) {
    const crudo = celdaNivel(row, i)
    if (crudo === '') {
      segmentos.push(0)
      continue
    }
    const n = Number(crudo)
    if (!Number.isInteger(n) || n < 0) {
      return { ok: false, errors: [`n_${i} debe ser un número entero ≥ 0 (0 = nivel no usado)`] }
    }
    segmentos.push(n)
  }

  const ultimo = segmentos.reduce((acc, n, i) => (n !== 0 ? i : acc), -1)
  if (ultimo < 0) {
    return { ok: false, errors: ['indica al menos el nivel 1 (columna n_1)'] }
  }
  if (segmentos.slice(0, ultimo).some((n) => n === 0)) {
    return {
      ok: false,
      errors: ['no puede quedar un nivel en 0 entre dos niveles con número (ej. 1 · 0 · 2)'],
    }
  }

  const partes = segmentos.slice(0, ultimo + 1).map(String)
  const codigo = partes.join(SEPARADOR_NIVEL)
  if (codigo.length > 20) {
    return { ok: false, errors: [`el código "${codigo}" excede los 20 caracteres`] }
  }
  return {
    ok: true,
    data: {
      codigo,
      padre_codigo: ultimo > 0 ? partes.slice(0, ultimo).join(SEPARADOR_NIVEL) : null,
      nivel: ultimo + 1,
    },
  }
}

/**
 * Valida y normaliza una fila cruda del archivo. Acepta los dos formatos:
 * columnas por nivel (`n_1`..`n_8`, el de la plantilla) o el viejo `codigo` +
 * `padre_codigo`. Si la fila trae ambos, mandan las columnas por nivel.
 */
export function validarFilaCuenta(row: Record<string, unknown>): FilaCuentaResultado {
  const errors: string[] = []
  const porNivel = usaColumnasNivel(row)

  let codigo = ''
  let padreCodigo: string | null = null
  let nivelDeclarado: number | null = null

  if (porNivel) {
    const jerarquia = jerarquiaDesdeNiveles(row)
    if (!jerarquia.ok) errors.push(...jerarquia.errors)
    else {
      codigo = jerarquia.data.codigo
      padreCodigo = jerarquia.data.padre_codigo
      nivelDeclarado = jerarquia.data.nivel
      if (nivelDeclarado > NIVEL_MAXIMO) {
        errors.push(`el catálogo admite hasta ${NIVEL_MAXIMO} niveles`)
      }
    }
  } else {
    codigo = texto(row['codigo'])
    const padre = texto(row['padre_codigo'])
    if (!codigo) errors.push('indica el nivel en las columnas n_1…n_8 (o un codigo)')
    else if (codigo.length > 20) errors.push('codigo no puede exceder 20 caracteres')
    else if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(codigo))
      errors.push(`codigo inválido: "${codigo}" — use letras, números, punto o guion (ej. 1102-01)`)
    if (padre && padre === codigo) errors.push('padre_codigo no puede ser la misma cuenta')
    if (padre.length > 20) errors.push('padre_codigo no puede exceder 20 caracteres')
    padreCodigo = padre || null
  }

  const nombre = texto(row['nombre'])
  if (nombre.length < 2) errors.push('nombre es obligatorio (mín. 2 caracteres)')
  else if (nombre.length > 120) errors.push('nombre no puede exceder 120 caracteres')

  // Vacío = se hereda del padre. Una cuenta RAÍZ no tiene de quién heredar, así
  // que ahí el tipo sí es obligatorio y se avisa en el archivo de errores.
  const tipoRaw = sinAcentos(texto(row['tipo'])).toLowerCase()
  let tipo: TipoCuenta | null = null
  if (tipoRaw !== '') {
    tipo = (TIPOS_VALIDOS as string[]).includes(tipoRaw)
      ? (tipoRaw as TipoCuenta)
      : TIPO_SINONIMOS[tipoRaw] ?? null
    if (!tipo) errors.push(`tipo inválido: "${texto(row['tipo'])}" — use: ${TIPOS_VALIDOS.join(', ')}`)
  } else if (padreCodigo === null && nivelDeclarado !== null) {
    errors.push(`tipo es obligatorio en el nivel 1 — use: ${TIPOS_VALIDOS.join(', ')}`)
  }

  const naturalezaRaw = sinAcentos(texto(row['naturaleza'])).toLowerCase()
  let naturaleza: NaturalezaCuenta | null = null
  if (naturalezaRaw === '') naturaleza = null
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

  if (errors.length > 0 || esDetalle === null) {
    return { ok: false, errors: errors.length > 0 ? errors : ['Fila inválida'] }
  }

  return {
    ok: true,
    data: {
      codigo,
      nombre,
      tipo,
      naturaleza,
      padre_codigo: padreCodigo,
      es_detalle: esDetalle,
      moneda,
      descripcion: descripcion || null,
    },
  }
}

// ── Planificación contra el catálogo del ledger ─────────────────────────────

type Resolucion =
  | { ok: true; nivel: number; tipo: TipoCuenta; naturaleza: NaturalezaCuenta }
  | { ok: false; motivo: string }

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

  // Padre efectivo de cada fila. Con columnas por nivel siempre viene explícito;
  // en el formato viejo el declarado manda (si no resuelve es error, no una
  // cuenta raíz por accidente) y el inferido por convención de código solo se
  // usa cuando EXISTE: así un archivo que arranca en '52' sin traer la clase
  // '5' crea '52' como raíz en vez de fallar.
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

  const cache = new Map<string, Resolucion>()

  /** Nivel + tipo + naturaleza de un código, heredando por la cadena de padres. */
  function resolver(codigo: string, enCurso: Set<string>): Resolucion {
    const cacheado = cache.get(codigo)
    if (cacheado) return cacheado
    if (enCurso.has(codigo)) {
      // Ciclo: no se cachea (el resultado depende del punto de entrada).
      return { ok: false, motivo: 'referencia circular entre cuentas padre' }
    }

    const fila = porCodigo.get(codigo)
    const existente = existentesPorCodigo.get(codigo)

    let resultado: Resolucion
    if (existente) {
      // Ya está en el árbol del ledger: conserva nivel, tipo y naturaleza.
      resultado = {
        ok: true,
        nivel: existente.nivel,
        tipo: fila?.tipo ?? existente.tipo,
        naturaleza: fila?.naturaleza ?? existente.naturaleza,
      }
    } else if (!fila) {
      resultado = {
        ok: false,
        motivo: `la cuenta padre "${codigo}" no existe en el catálogo ni viene en el archivo`,
      }
    } else {
      const padre = padreResuelto.get(codigo) ?? null
      const rp = padre ? conCurso(codigo, padre, enCurso) : null
      if (rp && !rp.ok) {
        resultado = rp
      } else if (rp && rp.nivel >= NIVEL_MAXIMO) {
        resultado = {
          ok: false,
          motivo: `excede el nivel máximo (${NIVEL_MAXIMO}): su padre "${padre}" ya está en el nivel ${rp.nivel}`,
        }
      } else {
        const tipo = fila.tipo ?? rp?.tipo ?? null
        if (!tipo) {
          resultado = { ok: false, motivo: 'falta el tipo (activo, pasivo, capital, ingreso o gasto)' }
        } else {
          resultado = {
            ok: true,
            nivel: rp ? rp.nivel + 1 : 1,
            tipo,
            // Sin naturaleza propia hereda la del padre — así las hijas de una
            // cuenta contra-natura (depreciación acumulada) siguen siendo
            // acreedoras — y si no hay padre, sale del tipo.
            naturaleza: fila.naturaleza ?? rp?.naturaleza ?? NATURALEZA_POR_TIPO[tipo],
          }
        }
      }
    }

    cache.set(codigo, resultado)
    return resultado
  }

  function conCurso(codigo: string, padre: string, enCurso: Set<string>): Resolucion {
    enCurso.add(codigo)
    const r = resolver(padre, enCurso)
    enCurso.delete(codigo)
    return r
  }

  const crear: CuentaPlanCrear[] = []
  const actualizar: CuentaPlanActualizar[] = []

  for (const fila of porCodigo.values()) {
    const existente = existentesPorCodigo.get(fila.codigo)
    const resuelta = resolver(fila.codigo, new Set())
    if (!resuelta.ok) {
      omitidas.push({ codigo: fila.codigo, motivo: resuelta.motivo })
      continue
    }

    const cuenta: CuentaResuelta = {
      codigo: fila.codigo,
      nombre: fila.nombre,
      tipo: resuelta.tipo,
      naturaleza: resuelta.naturaleza,
      es_detalle: conHijos.has(fila.codigo) ? false : fila.es_detalle,
      moneda: fila.moneda,
      descripcion: fila.descripcion,
    }

    if (existente) {
      if (opciones.actualizarExistentes) {
        actualizar.push({ id: existente.id, cuenta, nivel: existente.nivel })
      } else {
        omitidas.push({ codigo: fila.codigo, motivo: 'ya existe en esta contabilidad' })
      }
      continue
    }

    crear.push({ cuenta, nivel: resuelta.nivel, padre_codigo: padreResuelto.get(fila.codigo) ?? null })
  }

  // Padres primero: el insert por niveles ascendentes garantiza que el
  // padre_id ya está disponible cuando toca insertar a los hijos.
  crear.sort((a, b) => a.nivel - b.nivel || a.cuenta.codigo.localeCompare(b.cuenta.codigo, 'es'))
  actualizar.sort((a, b) => a.cuenta.codigo.localeCompare(b.cuenta.codigo, 'es'))

  return { crear, actualizar, omitidas }
}
