// Importación de reservas con su desglose de cobro desde una hoja (Excel o CSV)
// — lógica pura: qué columnas lleva la plantilla y cómo se lee cada fila.
import type { ConceptoRenta, EstadoReservaRenta, ImportesRenta, PlataformaRenta, PoliticaCancelacionRenta } from '../../types'
import { conceptosDeBloque, POLITICA_CANCELACION_LABEL, POLITICAS_CANCELACION, r2 } from './finanzas'
import { PLATAFORMAS } from './logica'
import type { DatosReserva } from './mutations'

export const COL = {
  codigo: 'Código de reserva', huesped: 'Huésped', entrada: 'Entrada', salida: 'Salida', huespedes: 'Huéspedes',
  plataforma: 'Plataforma', politica: 'Política de cancelación', mascotas: 'Mascotas',
} as const

/** Encabezado de la columna de un concepto: «Cobro huésped · Tarifa de limpieza». */
export function columnaDeConcepto(c: Pick<ConceptoRenta, 'bloque' | 'nombre'>): string {
  return `${c.bloque === 'huesped' ? 'Cobro huésped' : 'Recibido'} · ${c.nombre}`
}

/** Conceptos que entran en la plantilla: los activos, huésped primero. */
export function conceptosDePlantilla(conceptos: ConceptoRenta[]): ConceptoRenta[] {
  return [...conceptosDeBloque(conceptos, 'huesped'), ...conceptosDeBloque(conceptos, 'anfitrion')].filter(c => c.activo)
}

/** Sin acentos, minúsculas y sin signos: para casar encabezados escritos a mano. */
export const normalizar = (v: string): string =>
  v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const dos = (n: number) => String(n).padStart(2, '0')
const fechaValida = (a: number, m: number, d: number): string | null => {
  const f = new Date(Date.UTC(a, m - 1, d))
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d ? `${a}-${dos(m)}-${dos(d)}` : null
}

/** `AAAA-MM-DD`, `DD/MM/AAAA`, `DD-MM-AAAA` o una fecha de Excel → `AAAA-MM-DD`. null si no es fecha. */
export function leerFecha(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : fechaValida(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate())
  const t = String(v ?? '').trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t)
  if (m) return fechaValida(Number(m[1]), Number(m[2]), Number(m[3]))
  m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(t)
  if (m) return fechaValida(Number(m[3]), Number(m[2]), Number(m[1]))
  return null
}

/** «$ 1,037.75», «1037,75», 1037.75 → número ≥ 0. null = vacío; undefined = no es un monto. */
export function leerMonto(v: unknown): number | null | undefined {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? r2(v) : undefined
  let t = String(v ?? '').replace(/[$\s]/g, '')
  if (t === '' || t === '-') return null
  // Coma de miles («1,037.75») o coma decimal («1037,75»).
  if (t.includes(',') && t.includes('.')) t = t.replace(/,/g, '')
  else t = t.replace(',', '.')
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? r2(n) : undefined
}

export interface FilaReservaImportada {
  datos: DatosReserva
  importes: ImportesRenta
}

const POLITICA_POR_TEXTO = new Map<string, PoliticaCancelacionRenta>(
  POLITICAS_CANCELACION.flatMap(p => [[normalizar(p), p], [normalizar(POLITICA_CANCELACION_LABEL[p]), p]]))
POLITICA_POR_TEXTO.set('no reembolsable', 'no_reembolsable')
const PLATAFORMA_SET = new Set<string>(PLATAFORMAS)

/**
 * Una fila de la hoja → la reserva y su desglose, o la lista de lo que falta.
 * `estado` nace de las fechas: lo que ya salió es «completada».
 */
export function leerFilaReserva(
  fila: Record<string, unknown>, conceptos: ConceptoRenta[], hoy: string,
): { ok: true; data: FilaReservaImportada } | { ok: false; errors: string[] } {
  const porClave = new Map(Object.entries(fila).map(([k, v]) => [normalizar(k), v]))
  const celda = (col: string) => porClave.get(normalizar(col))
  const texto = (col: string) => String(celda(col) ?? '').trim()
  const errores: string[] = []

  const huesped = texto(COL.huesped)
  const codigo = texto(COL.codigo)
  if (!huesped && !codigo) errores.push('Falta el huésped o el código de reserva')
  const entrada = leerFecha(celda(COL.entrada))
  const salida = leerFecha(celda(COL.salida))
  if (!entrada) errores.push('Entrada: fecha inválida (usa AAAA-MM-DD o DD/MM/AAAA)')
  if (!salida) errores.push('Salida: fecha inválida (usa AAAA-MM-DD o DD/MM/AAAA)')
  if (entrada && salida && salida <= entrada) errores.push('La salida debe ser posterior a la entrada')

  const huespedesTxt = texto(COL.huespedes)
  const huespedes = huespedesTxt === '' ? 1 : Number(huespedesTxt)
  if (!Number.isInteger(huespedes) || huespedes < 1) errores.push('Huéspedes: debe ser un número entero mayor que cero')
  const mascotasTxt = normalizar(texto(COL.mascotas))
  const mascotas = mascotasTxt === '' || mascotasTxt === 'no' ? 0 : mascotasTxt === 'si' ? 1 : Number(mascotasTxt)
  if (!Number.isInteger(mascotas) || mascotas < 0) errores.push('Mascotas: debe ser un número entero')

  const plataformaTxt = normalizar(texto(COL.plataforma))
  const plataforma: PlataformaRenta = plataformaTxt === '' ? 'airbnb' : PLATAFORMA_SET.has(plataformaTxt) ? plataformaTxt as PlataformaRenta : 'otro'
  const politicaTxt = normalizar(texto(COL.politica))
  const politica = politicaTxt === '' ? null : POLITICA_POR_TEXTO.get(politicaTxt) ?? 'otra'

  const importes: ImportesRenta = {}
  for (const c of conceptosDePlantilla(conceptos)) {
    const monto = leerMonto(celda(columnaDeConcepto(c)))
    if (monto === undefined) errores.push(`${columnaDeConcepto(c)}: no es un monto válido`)
    else if (monto !== null) importes[c.id] = monto
  }

  if (errores.length > 0 || !entrada || !salida) return { ok: false, errors: errores }
  const estado: EstadoReservaRenta = salida <= hoy ? 'completada' : entrada <= hoy ? 'en_curso' : 'confirmada'
  return {
    ok: true,
    data: {
      importes,
      datos: {
        huesped_nombre: huesped || codigo, huesped_email: null, huesped_telefono: null,
        fecha_entrada: entrada, fecha_salida: salida, num_huespedes: huespedes, plataforma,
        codigo_confirmacion: codigo || null, monto_noche: null, monto_total: null, estado, notas: null,
        politica_cancelacion: politica, num_mascotas: mascotas,
      },
    },
  }
}
