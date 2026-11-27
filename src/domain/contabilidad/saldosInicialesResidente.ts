// Saldos iniciales por residente: lee lo que el contador pega desde Excel
// (una cuota pendiente por renglón) y lo deja listo para el RPC
// conta_cuotas_saldo_inicial. Aquí solo se resuelve lo que el navegador sabe
// —leer números y fechas, reconocer la unidad por su nombre—; las reglas de
// negocio (responsable, tipo de cargo, duplicados) las decide el servidor.
import type { CuotaSaldoInicialInput } from '../../types/contabilidad'

/** Orden de las columnas esperadas al pegar. */
export const COLUMNAS_SALDO_INICIAL = ['Unidad', 'Periodo', 'Monto', 'Vencimiento', 'Mora', 'Tipo'] as const

export interface CuotaPegada {
  /** Número de renglón en lo pegado (desde 1, contando el encabezado si lo hay). */
  linea: number
  unidadTexto: string
  /** null si hay un error local: el renglón no se envía. */
  input: CuotaSaldoInicialInput | null
  error: string | null
}

const normalizar = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toLowerCase()

/** '1,250.50', 'Q 1250.5', '1250' → número; null si no se puede leer. */
export function leerMonto(texto: string): number | null {
  const limpio = texto.replace(/[^\d.,-]/g, '')
  if (!limpio) return null
  // La coma es separador de miles (formato de Guatemala): se descarta.
  const n = Number(limpio.replace(/,/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

/** '2026-02', '02/2026', '2/2026', '2026/02' → 'YYYY-MM'; null si no es un mes. */
export function leerPeriodo(texto: string): string | null {
  const t = texto.trim()
  let m = /^(\d{4})[-/](\d{1,2})$/.exec(t)
  if (!m) {
    const inv = /^(\d{1,2})[-/](\d{4})$/.exec(t)
    if (inv) m = [inv[0], inv[2], inv[1]] as unknown as RegExpExecArray
  }
  if (!m) return null
  const mes = Number(m[2])
  return mes >= 1 && mes <= 12 ? `${m[1]}-${String(mes).padStart(2, '0')}` : null
}

/** '2026-02-15' o '15/02/2026' (día/mes/año) → 'YYYY-MM-DD'; null si no es una fecha real. */
export function leerFecha(texto: string): string | null {
  const t = texto.trim()
  let a: number, m: number, d: number
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t)
  if (iso) { a = Number(iso[1]); m = Number(iso[2]); d = Number(iso[3]) }
  else if (dmy) { a = Number(dmy[3]); m = Number(dmy[2]); d = Number(dmy[1]) }
  else return null
  const f = new Date(a, m - 1, d)
  if (f.getFullYear() !== a || f.getMonth() !== m - 1 || f.getDate() !== d) return null
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * Convierte lo pegado en renglones. Columnas separadas por tabulador (lo que
 * copia Excel) o por punto y coma: Unidad · Periodo · Monto · Vencimiento ·
 * Mora · Tipo. Las tres últimas son opcionales. Un primer renglón que empiece
 * con «Unidad» se toma como encabezado.
 */
export function parsearCuotasPegadas(texto: string, unidades: Array<{ id: string; nombre: string }>): CuotaPegada[] {
  const porNombre = new Map<string, string | null>()
  for (const u of unidades) {
    const k = normalizar(u.nombre)
    // Dos unidades con el mismo nombre: no se adivina cuál.
    porNombre.set(k, porNombre.has(k) ? null : u.id)
  }

  const salida: CuotaPegada[] = []
  texto.split(/\r?\n/).forEach((renglon, i) => {
    if (!renglon.trim()) return
    const c = renglon.split(renglon.includes('\t') ? '\t' : ';').map((x) => x.trim())
    if (i === 0 && normalizar(c[0] ?? '') === 'unidad') return
    const [unidadTexto = '', periodoTxt = '', montoTxt = '', vencTxt = '', moraTxt = '', tipoTxt = ''] = c
    const fila: CuotaPegada = { linea: i + 1, unidadTexto, input: null, error: null }
    salida.push(fila)

    const clave = normalizar(unidadTexto)
    const unidadId = porNombre.get(clave)
    const periodo = leerPeriodo(periodoTxt)
    const monto = leerMonto(montoTxt)
    const venc = vencTxt ? leerFecha(vencTxt) : null
    const mora = moraTxt ? leerMonto(moraTxt) : 0
    const tipo = normalizar(tipoTxt)

    if (!unidadTexto) fila.error = 'Falta la unidad.'
    else if (unidadId === undefined) fila.error = `No hay una unidad llamada «${unidadTexto}» en este proyecto.`
    else if (unidadId === null) fila.error = `Hay más de una unidad llamada «${unidadTexto}»: no se puede saber cuál es.`
    else if (!periodo) fila.error = 'El periodo va como AAAA-MM o MM/AAAA.'
    else if (monto === null || monto <= 0) fila.error = 'El monto pendiente debe ser un número mayor que cero.'
    else if (vencTxt && !venc) fila.error = 'El vencimiento va como DD/MM/AAAA o AAAA-MM-DD.'
    else if (mora === null || mora < 0) fila.error = 'La mora debe ser un número, cero o mayor.'
    else if (tipo && !/^(mantenimiento|ordinaria|extraordinaria|cuota[ _]extraordinaria)$/.test(tipo)) {
      fila.error = 'El tipo es «mantenimiento» o «extraordinaria».'
    } else {
      fila.input = {
        unidad_id: unidadId,
        periodo,
        monto,
        fecha_vencimiento: venc,
        mora,
        tipo_cargo: tipo.includes('extraordinaria') ? 'cuota_extraordinaria' : 'mantenimiento',
      }
    }
  })
  return salida
}
