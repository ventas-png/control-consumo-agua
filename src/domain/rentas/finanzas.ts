// Manejo de Rentas · Finanzas — lógica pura (sin red ni React): totales del
// desglose de una reserva, calendario y resumen del mes de una propiedad, y el
// estado mensual del propietario. Es la hoja de Excel que las administradoras
// llevan por apartamento, calculada.
import type {
  BloqueConceptoRenta, CargoGastoRenta, CategoriaGastoRenta, ConceptoRenta, ContratoRenta, GastoRenta,
  ImportesRenta, LiquidacionRenta, PoliticaCancelacionRenta, PropiedadRenta, ReservaUnificada,
} from '../../types'
import { MONEDAS_ISO } from '../../lib/monedas'
import { diasEntre } from './logica'

export const BLOQUES: readonly BloqueConceptoRenta[] = ['huesped', 'anfitrion']
export const BLOQUE_LABEL: Record<BloqueConceptoRenta, string> = {
  huesped: 'Cobro al huésped', anfitrion: 'Recibido por el anfitrión',
}
export const BLOQUE_TOTAL_LABEL: Record<BloqueConceptoRenta, string> = {
  huesped: 'Total pagado por el huésped', anfitrion: 'Total recibido',
}

export const POLITICAS_CANCELACION: readonly PoliticaCancelacionRenta[] =
  ['flexible', 'moderada', 'estricta', 'no_reembolsable', 'na', 'otra']
export const POLITICA_CANCELACION_LABEL: Record<PoliticaCancelacionRenta, string> = {
  flexible: 'Flexible', moderada: 'Moderada', estricta: 'Estricta',
  no_reembolsable: 'No reembolsable', na: 'No aplica', otra: 'Otra',
}

export const CATEGORIAS_GASTO: readonly CategoriaGastoRenta[] =
  ['limpieza', 'mantenimiento', 'servicios', 'suministros', 'impuestos', 'otro']
export const CATEGORIA_GASTO_LABEL: Record<CategoriaGastoRenta, string> = {
  limpieza: 'Limpieza', mantenimiento: 'Mantenimiento', servicios: 'Servicios (luz, agua, internet)',
  suministros: 'Suministros', impuestos: 'Impuestos', otro: 'Otro',
}
export const CARGO_GASTO_LABEL: Record<CargoGastoRenta, string> = {
  propietario: 'Propietario', administradora: 'Administradora',
}

/** Moneda de una reserva, un gasto o un contrato que no dice otra. */
export const MONEDA_DEFECTO = 'USD'

/** Códigos ISO que se ofrecen en los formularios (USD primero). */
export const MONEDAS_RENTA: readonly string[] = [
  'USD', ...MONEDAS_ISO.map(m => m.code.toUpperCase()).filter(c => c !== 'USD'),
]
export const esMoneda = (v: string): boolean => /^[A-Z]{3}$/.test(v)

/** Moneda de una reserva: la de su ficha de liquidación; sin ficha, USD. */
export function monedaDeReserva(r: Pick<ReservaUnificada, 'id' | 'origen'>, liquidaciones: Map<string, LiquidacionRenta>): string {
  return liquidaciones.get(claveReserva(r))?.moneda ?? MONEDA_DEFECTO
}

/** Redondeo a centavos (evita 0.1 + 0.2). */
export const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

/** Conceptos de un bloque en el orden en que se muestran. */
export function conceptosDeBloque(conceptos: ConceptoRenta[], bloque: BloqueConceptoRenta): ConceptoRenta[] {
  return conceptos.filter(c => c.bloque === bloque)
    .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))
}

export interface TotalesDesglose {
  /** Lo que pagó el huésped. */
  huesped: number
  /** Lo que recibió el anfitrión (lo acreditado). */
  anfitrion: number
  /** Parte de lo recibido sobre la que se calcula la comisión de administración. */
  baseComision: number
}

/** Totales de un desglose con los conceptos VIGENTES (un concepto que ya no existe no suma). */
export function totalesDesglose(conceptos: ConceptoRenta[], importes: ImportesRenta | null | undefined): TotalesDesglose {
  const t: TotalesDesglose = { huesped: 0, anfitrion: 0, baseComision: 0 }
  if (!importes) return t
  for (const c of conceptos) {
    const monto = importes[c.id]
    if (typeof monto !== 'number' || !Number.isFinite(monto)) continue
    const firmado = c.signo * monto
    if (c.bloque === 'huesped') t.huesped += firmado
    else {
      t.anfitrion += firmado
      if (c.comisionable) t.baseComision += firmado
    }
  }
  return { huesped: r2(t.huesped), anfitrion: r2(t.anfitrion), baseComision: r2(t.baseComision) }
}

/** ¿El desglose tiene algún monto capturado? Uno vacío equivale a no tenerlo. */
export function tieneDesglose(importes: ImportesRenta | null | undefined): boolean {
  return !!importes && Object.values(importes).some(v => typeof v === 'number' && v !== 0)
}

/** Clave con la que se busca la liquidación de una reserva unificada. */
export const claveReserva = (r: Pick<ReservaUnificada, 'id' | 'origen'>): string => `${r.origen}:${r.id}`

export function liquidacionesPorReserva(liquidaciones: LiquidacionRenta[]): Map<string, LiquidacionRenta> {
  const m = new Map<string, LiquidacionRenta>()
  for (const l of liquidaciones) {
    if (l.reserva_id) m.set(`rentas:${l.reserva_id}`, l)
    else if (l.reserva_str_id) m.set(`condominio:${l.reserva_str_id}`, l)
  }
  return m
}

// ── El mes ───────────────────────────────────────────────────────────────────

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/
export const esMes = (v: string): boolean => MES_RE.test(v)

/** Días que tiene el mes `AAAA-MM`. */
export function diasDelMes(mes: string): number {
  const [a, m] = mes.split('-').map(Number)
  return new Date(Date.UTC(a, m, 0)).getUTCDate()
}
const dia2 = (d: number) => String(d).padStart(2, '0')
export const primerDia = (mes: string): string => `${mes}-01`
export const ultimoDia = (mes: string): string => `${mes}-${dia2(diasDelMes(mes))}`

/** Mes `AAAA-MM` desplazado `delta` meses. */
export function mesDesplazado(mes: string, delta: number): string {
  const [a, m] = mes.split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${dia2(d.getUTCMonth() + 1)}`
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
/** `2026-02` → «febrero de 2026». */
export function nombreMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number)
  return `${MESES[m - 1] ?? mes} de ${a}`
}

/** Noches de [entrada, salida) que caen dentro del mes. */
export function nochesEnMes(entrada: string, salida: string, mes: string): number {
  const desde = entrada > primerDia(mes) ? entrada : primerDia(mes)
  const finMes = primerDia(mesDesplazado(mes, 1))
  const hasta = salida < finMes ? salida : finMes
  const n = diasEntre(desde, hasta)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export interface DiaCalendario {
  dia: number
  fecha: string
  /** Reserva que ocupa la noche de ese día (null = libre). */
  reserva: ReservaUnificada | null
  /** Es el día de entrada de esa reserva: ahí se anotan sus montos, como en la hoja. */
  esEntrada: boolean
}

/**
 * El mes día por día para UNA propiedad. La noche del día de salida ya no es
 * de la reserva: si otra entra ese día, el día es de la que entra.
 */
export function calendarioMes(mes: string, reservas: ReservaUnificada[]): DiaCalendario[] {
  const vivas = reservas.filter(r => r.estado !== 'cancelada')
    .sort((a, b) => a.fecha_entrada.localeCompare(b.fecha_entrada))
  const dias: DiaCalendario[] = []
  for (let d = 1; d <= diasDelMes(mes); d++) {
    const fecha = `${mes}-${dia2(d)}`
    const reserva = vivas.find(r => r.fecha_entrada <= fecha && fecha < r.fecha_salida) ?? null
    dias.push({ dia: d, fecha, reserva, esEntrada: reserva?.fecha_entrada === fecha })
  }
  return dias
}

export interface ResumenMes {
  mes: string
  dias: number
  nochesOcupadas: number
  nochesLibres: number
  /** 0–100. */
  ocupacionPct: number
  /** Reservas no canceladas que ENTRAN en el mes. */
  estadias: number
  personas: number
  /** Personas por estadía; null sin estadías. */
  personasPromedio: number | null
  /** Suma del mes por concepto (sin signo), en el orden de los conceptos. */
  porConcepto: { concepto: ConceptoRenta; total: number }[]
  totalHuesped: number
  /** Lo recibido por las reservas que entran en el mes. */
  acreditadoReservas: number
  /** Renta de los contratos que cubren algún día del mes. */
  rentaContratos: number
  /** acreditadoReservas + rentaContratos: la «Acreditación del mes». */
  acreditado: number
  baseComision: number
  comisionPct: number
  comision: number
  gastosPropietario: number
  gastosAdministradora: number
  /** acreditado − comisión − gastos a cargo del propietario. */
  pagoPropietario: number
  /** comisión − gastos que absorbe la administradora. */
  ingresoAdministradora: number
  /** acreditado − todos los gastos: lo que dejó la propiedad. */
  utilidad: number
  /** Estadías del mes sin desglose: suman su «monto total» tal cual. */
  reservasSinDesglose: number
  /** Moneda en la que están todos los montos de este resumen. */
  moneda: string
  /** Otras monedas con montos en el mes (reservas, contratos o gastos) que este resumen NO suma. */
  otrasMonedas: string[]
}

/** ¿El contrato cubre algún día del mes? Uno cancelado no cuenta. */
export function contratoCubreMes(c: ContratoRenta, mes: string): boolean {
  if (c.estado === 'cancelado') return false
  return c.fecha_inicio <= ultimoDia(mes) && (c.fecha_fin === null || c.fecha_fin >= primerDia(mes))
}

export interface DatosMes {
  propiedad: PropiedadRenta
  mes: string
  /** Reservas de ESA propiedad. */
  reservas: ReservaUnificada[]
  /** Contratos de ESA propiedad. */
  contratos: ContratoRenta[]
  /** Gastos de ESA propiedad (de cualquier fecha: se filtran por mes aquí). */
  gastos: GastoRenta[]
  conceptos: ConceptoRenta[]
  liquidaciones: Map<string, LiquidacionRenta>
  /** Moneda del resumen (por defecto USD). No hay tipo de cambio: lo que está en otra moneda no se suma. */
  moneda?: string
}

/**
 * Los números del mes de una propiedad. El dinero de una reserva se anota
 * entero en el mes en que ENTRA (igual que la hoja); la ocupación, en cambio,
 * cuenta sólo las noches que caen dentro del mes.
 */
export function resumenMes({ propiedad, mes, reservas, contratos, gastos, conceptos, liquidaciones, moneda = MONEDA_DEFECTO }: DatosMes): ResumenMes {
  const dias = diasDelMes(mes)
  const otras = new Set<string>()
  const totalPorConcepto = new Map<string, number>()
  let noches = 0, estadias = 0, personas = 0, sinDesglose = 0
  let totalHuesped = 0, acreditadoReservas = 0, base = 0

  for (const r of reservas) {
    if (r.estado === 'cancelada') continue
    noches += nochesEnMes(r.fecha_entrada, r.fecha_salida, mes)
    if (r.fecha_entrada.slice(0, 7) !== mes) continue
    estadias += 1
    personas += r.num_huespedes
    const importes = liquidaciones.get(claveReserva(r))?.importes
    // La estadía cuenta (ocupación, personas); su dinero sólo si está en la moneda del resumen.
    const suMoneda = monedaDeReserva(r, liquidaciones)
    if (suMoneda !== moneda) {
      if (tieneDesglose(importes) || (r.monto_total ?? 0) !== 0) otras.add(suMoneda)
      continue
    }
    if (tieneDesglose(importes)) {
      const t = totalesDesglose(conceptos, importes)
      totalHuesped += t.huesped
      acreditadoReservas += t.anfitrion
      base += t.baseComision
      for (const c of conceptos) {
        const monto = importes?.[c.id]
        if (typeof monto === 'number') totalPorConcepto.set(c.id, (totalPorConcepto.get(c.id) ?? 0) + monto)
      }
    } else {
      sinDesglose += 1
      acreditadoReservas += r.monto_total ?? 0
      base += r.monto_total ?? 0
    }
  }

  let rentaContratos = 0, diasContrato = 0
  for (const c of contratos) {
    if (!contratoCubreMes(c, mes)) continue
    const enMoneda = (c.moneda ?? MONEDA_DEFECTO) === moneda
    if (enMoneda) rentaContratos += c.renta_mensual
    else otras.add(c.moneda)
    const fin = c.fecha_fin === null ? '9999-12-31' : c.fecha_fin
    // El contrato ocupa también su último día: se cuenta hasta el día siguiente.
    const finExclusivo = fin >= ultimoDia(mes) ? primerDia(mesDesplazado(mes, 1)) : sumarUnDia(fin)
    diasContrato += nochesEnMes(c.fecha_inicio, finExclusivo, mes)
  }
  base += rentaContratos

  let gastosPropietario = 0, gastosAdministradora = 0
  for (const g of gastos) {
    if (g.fecha.slice(0, 7) !== mes) continue
    if ((g.moneda ?? MONEDA_DEFECTO) !== moneda) { otras.add(g.moneda); continue }
    if (g.a_cargo_de === 'administradora') gastosAdministradora += g.monto
    else gastosPropietario += g.monto
  }

  const nochesOcupadas = Math.min(dias, noches + diasContrato)
  const acreditado = r2(acreditadoReservas + rentaContratos)
  const comisionPct = propiedad.comision_pct ?? 0
  const comision = r2(Math.max(0, base) * comisionPct / 100)
  return {
    mes, dias, nochesOcupadas, nochesLibres: dias - nochesOcupadas,
    ocupacionPct: Math.round((nochesOcupadas / dias) * 100),
    estadias, personas,
    personasPromedio: estadias > 0 ? Math.round((personas / estadias) * 10) / 10 : null,
    porConcepto: conceptos
      .filter(c => totalPorConcepto.has(c.id) || c.activo)
      .map(c => ({ concepto: c, total: r2(totalPorConcepto.get(c.id) ?? 0) })),
    totalHuesped: r2(totalHuesped),
    acreditadoReservas: r2(acreditadoReservas), rentaContratos: r2(rentaContratos), acreditado,
    baseComision: r2(base), comisionPct, comision,
    gastosPropietario: r2(gastosPropietario), gastosAdministradora: r2(gastosAdministradora),
    pagoPropietario: r2(acreditado - comision - gastosPropietario),
    ingresoAdministradora: r2(comision - gastosAdministradora),
    utilidad: r2(acreditado - gastosPropietario - gastosAdministradora),
    reservasSinDesglose: sinDesglose,
    moneda, otrasMonedas: [...otras].sort(),
  }
}

function sumarUnDia(fecha: string): string {
  const d = new Date(Date.parse(`${fecha}T00:00:00Z`) + 86_400_000)
  return `${d.getUTCFullYear()}-${dia2(d.getUTCMonth() + 1)}-${dia2(d.getUTCDate())}`
}

export interface FilaCartera { propiedad: PropiedadRenta; resumen: ResumenMes }

/** El mes de TODA la cartera: una fila por propiedad y los totales. */
export function resumenCarteraMes(
  propiedades: PropiedadRenta[], mes: string, reservas: ReservaUnificada[], contratos: ContratoRenta[],
  gastos: GastoRenta[], conceptos: ConceptoRenta[], liquidaciones: Map<string, LiquidacionRenta>, moneda: string = MONEDA_DEFECTO,
): { filas: FilaCartera[]; otrasMonedas: string[]; total: Pick<ResumenMes, 'dias' | 'nochesOcupadas' | 'ocupacionPct' | 'estadias' | 'acreditado' | 'comision' | 'gastosPropietario' | 'gastosAdministradora' | 'pagoPropietario' | 'ingresoAdministradora'> } {
  const filas = propiedades.map(propiedad => ({
    propiedad,
    resumen: resumenMes({
      propiedad, mes, conceptos, liquidaciones, moneda,
      reservas: reservas.filter(r => r.propiedad_id === propiedad.id),
      contratos: contratos.filter(c => c.propiedad_id === propiedad.id),
      gastos: gastos.filter(g => g.propiedad_id === propiedad.id),
    }),
  }))
  const suma = (f: (r: ResumenMes) => number) => r2(filas.reduce((a, x) => a + f(x.resumen), 0))
  // La ocupación de la cartera sólo cuenta propiedades en servicio.
  const enServicio = filas.filter(f => f.propiedad.estado !== 'inactiva')
  const dias = enServicio.reduce((a, x) => a + x.resumen.dias, 0)
  const ocupadas = enServicio.reduce((a, x) => a + x.resumen.nochesOcupadas, 0)
  return {
    filas,
    otrasMonedas: [...new Set(filas.flatMap(f => f.resumen.otrasMonedas))].sort(),
    total: {
      dias, nochesOcupadas: ocupadas, ocupacionPct: dias > 0 ? Math.round((ocupadas / dias) * 100) : 0,
      estadias: suma(r => r.estadias), acreditado: suma(r => r.acreditado), comision: suma(r => r.comision),
      gastosPropietario: suma(r => r.gastosPropietario), gastosAdministradora: suma(r => r.gastosAdministradora),
      pagoPropietario: suma(r => r.pagoPropietario), ingresoAdministradora: suma(r => r.ingresoAdministradora),
    },
  }
}

// ── Captura ──────────────────────────────────────────────────────────────────

/**
 * Los campos de texto del formulario (concepto → texto) a importes. Vacío no
 * viaja. Devuelve `null` si algún campo no es un número ≥ 0.
 */
export function importesDeFormulario(campos: Record<string, string>): ImportesRenta | null {
  const out: ImportesRenta = {}
  for (const [id, texto] of Object.entries(campos)) {
    const t = texto.trim().replace(/[$\s]/g, '').replace(',', '.')
    if (t === '') continue
    const n = Number(t)
    if (!Number.isFinite(n) || n < 0) return null
    out[id] = r2(n)
  }
  return out
}

/** Código estable para un concepto nuevo a partir de su nombre («Propina extra» → `propina_extra`). */
export function codigoDeConcepto(nombre: string, usados: ReadonlySet<string>): string {
  const base = nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50) || 'concepto'
  if (!usados.has(base)) return base
  for (let i = 2; ; i++) if (!usados.has(`${base}_${i}`)) return `${base}_${i}`
}

// ── Tendencia ────────────────────────────────────────────────────────────────

export interface PuntoTendencia {
  mes: string
  dias: number
  nochesOcupadas: number
  /** 0–100. */
  ocupacionPct: number
  estadias: number
  acreditado: number
  comision: number
  /** Gastos a cargo del propietario + los que absorbe la administradora. */
  gastos: number
  pagoPropietario: number
  /** Acreditado por noche ocupada; null si el mes no tuvo noches ocupadas. */
  ingresoPorNoche: number | null
}

/**
 * El desempeño mes a mes de una o varias propiedades: los `meses` meses que
 * terminan en `mesFin`, del más antiguo al más reciente. Cada punto es el
 * mismo cálculo de `resumenCarteraMes` (misma moneda, sin tipo de cambio).
 */
export function tendenciaMeses(
  propiedades: PropiedadRenta[], mesFin: string, meses: number, reservas: ReservaUnificada[], contratos: ContratoRenta[],
  gastos: GastoRenta[], conceptos: ConceptoRenta[], liquidaciones: Map<string, LiquidacionRenta>, moneda: string = MONEDA_DEFECTO,
): PuntoTendencia[] {
  const ids = new Set(propiedades.map(p => p.id))
  const suyas = reservas.filter(r => ids.has(r.propiedad_id))
  const puntos: PuntoTendencia[] = []
  for (let i = meses - 1; i >= 0; i--) {
    const mes = mesDesplazado(mesFin, -i)
    const { total: t } = resumenCarteraMes(propiedades, mes, suyas, contratos, gastos, conceptos, liquidaciones, moneda)
    puntos.push({
      mes, dias: t.dias, nochesOcupadas: t.nochesOcupadas, ocupacionPct: t.ocupacionPct, estadias: t.estadias,
      acreditado: t.acreditado, comision: t.comision, gastos: r2(t.gastosPropietario + t.gastosAdministradora),
      pagoPropietario: t.pagoPropietario,
      ingresoPorNoche: t.nochesOcupadas > 0 ? r2(t.acreditado / t.nochesOcupadas) : null,
    })
  }
  return puntos
}

export interface ResumenTendencia {
  acreditado: number
  gastos: number
  pagoPropietario: number
  nochesOcupadas: number
  dias: number
  /** Ocupación de todo el periodo (noches ocupadas / noches disponibles), 0–100. */
  ocupacionPct: number
  estadias: number
  ingresoPorNoche: number | null
  /** Mes con más acreditado; null si ninguno tuvo ingresos. */
  mejorMes: PuntoTendencia | null
}

export function resumenTendencia(puntos: PuntoTendencia[]): ResumenTendencia {
  const suma = (f: (p: PuntoTendencia) => number) => r2(puntos.reduce((a, p) => a + f(p), 0))
  const acreditado = suma(p => p.acreditado), noches = suma(p => p.nochesOcupadas), dias = suma(p => p.dias)
  const mejor = puntos.reduce<PuntoTendencia | null>((m, p) => (p.acreditado > (m?.acreditado ?? 0) ? p : m), null)
  return {
    acreditado, gastos: suma(p => p.gastos), pagoPropietario: suma(p => p.pagoPropietario),
    nochesOcupadas: noches, dias, ocupacionPct: dias > 0 ? Math.round((noches / dias) * 100) : 0,
    estadias: suma(p => p.estadias), ingresoPorNoche: noches > 0 ? r2(acreditado / noches) : null, mejorMes: mejor,
  }
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
/** `2026-02` → «feb 26». */
export function mesCorto(mes: string): string {
  const [a, m] = mes.split('-').map(Number)
  return `${MESES_CORTOS[m - 1] ?? mes} ${String(a).slice(2)}`
}
