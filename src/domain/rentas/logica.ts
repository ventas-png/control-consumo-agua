// Manejo de Rentas — lógica pura (sin red ni React): etiquetas, ocupación
// derivada, reservas unificadas, solapes y los números del panel.
import type {
  ArticuloInventarioRenta, CategoriaInventarioRenta, ContratoRenta, EstadoArticuloRenta,
  EstadoContratoRenta, EstadoPropiedadRenta, EstadoReservaRenta, PlataformaRenta,
  PropiedadRenta, ReservaRenta, ReservaSTR, ReservaUnificada, TipoPropiedadRenta,
} from '../../types'

export const TIPOS_RENTA: readonly TipoPropiedadRenta[] = ['corto_plazo', 'largo_plazo', 'local_comercial', 'otro']
export const TIPO_RENTA_LABEL: Record<TipoPropiedadRenta, string> = {
  corto_plazo: 'Corto plazo (STR)',
  largo_plazo: 'Largo plazo',
  local_comercial: 'Local comercial',
  otro: 'Otro',
}
export const TIPO_RENTA_ICONO: Record<TipoPropiedadRenta, string> = {
  corto_plazo: '🏖️', largo_plazo: '🏠', local_comercial: '🏬', otro: '📦',
}

export const ESTADO_PROPIEDAD_LABEL: Record<EstadoPropiedadRenta, string> = {
  activa: 'Activa', mantenimiento: 'En mantenimiento', inactiva: 'Inactiva',
}

export const ESTADOS_RESERVA: readonly EstadoReservaRenta[] = ['confirmada', 'en_curso', 'completada', 'cancelada']
export const ESTADO_RESERVA_LABEL: Record<EstadoReservaRenta, string> = {
  confirmada: 'Confirmada', en_curso: 'En curso', completada: 'Completada', cancelada: 'Cancelada',
}
export const PLATAFORMAS: readonly PlataformaRenta[] = ['directo', 'airbnb', 'booking', 'vrbo', 'otro']
export const PLATAFORMA_LABEL: Record<PlataformaRenta, string> = {
  directo: 'Directo', airbnb: 'Airbnb', booking: 'Booking', vrbo: 'Vrbo', otro: 'Otro',
}

export const ESTADOS_CONTRATO: readonly EstadoContratoRenta[] = ['vigente', 'finalizado', 'cancelado']
export const ESTADO_CONTRATO_LABEL: Record<EstadoContratoRenta, string> = {
  vigente: 'Vigente', finalizado: 'Finalizado', cancelado: 'Cancelado',
}

export const CATEGORIAS_INVENTARIO: readonly CategoriaInventarioRenta[] =
  ['mobiliario', 'electrodomestico', 'electronica', 'blancos', 'menaje', 'decoracion', 'otro']
export const CATEGORIA_INVENTARIO_LABEL: Record<CategoriaInventarioRenta, string> = {
  mobiliario: 'Mobiliario', electrodomestico: 'Electrodomésticos', electronica: 'Electrónica',
  blancos: 'Blancos', menaje: 'Menaje y cocina', decoracion: 'Decoración', otro: 'Otro',
}
export const ESTADOS_ARTICULO: readonly EstadoArticuloRenta[] = ['bueno', 'regular', 'danado', 'faltante']
export const ESTADO_ARTICULO_LABEL: Record<EstadoArticuloRenta, string> = {
  bueno: 'Bueno', regular: 'Regular', danado: 'Dañado', faltante: 'Faltante',
}

/** Días que faltan para que un contrato cuente como «por vencer». */
export const DIAS_AVISO_VENCIMIENTO = 60

const MS_DIA = 86_400_000
/** Días de calendario entre dos fechas `AAAA-MM-DD` (b − a). NaN si alguna no es fecha. */
export function diasEntre(a: string, b: string): number {
  const da = Date.parse(`${a.slice(0, 10)}T00:00:00Z`)
  const db = Date.parse(`${b.slice(0, 10)}T00:00:00Z`)
  return Math.round((db - da) / MS_DIA)
}

export function noches(entrada: string, salida: string): number {
  const n = diasEntre(entrada, salida)
  return Number.isFinite(n) && n > 0 ? n : 0
}

const PLATAFORMAS_SET = new Set<string>(PLATAFORMAS)
const ESTADOS_RESERVA_SET = new Set<string>(ESTADOS_RESERVA)

/**
 * Junta en una sola lista las reservas de las propiedades independientes
 * (`rentas_reservas`) y las de `reservas_str` cuya unidad está enlazada a una
 * propiedad. Una reserva STR de una unidad que no es propiedad en renta no
 * entra: no es de esta cartera.
 */
export function unificarReservas(
  propiedades: PropiedadRenta[],
  reservasRentas: ReservaRenta[],
  reservasStr: ReservaSTR[],
): ReservaUnificada[] {
  const porUnidad = new Map<string, string>()
  for (const p of propiedades) if (p.unidad_id) porUnidad.set(p.unidad_id, p.id)
  const ids = new Set(propiedades.map(p => p.id))

  const propias: ReservaUnificada[] = reservasRentas
    .filter(r => ids.has(r.propiedad_id))
    .map(r => ({
      id: r.id, origen: 'rentas', propiedad_id: r.propiedad_id,
      huesped_nombre: r.huesped_nombre, huesped_email: r.huesped_email, huesped_telefono: r.huesped_telefono,
      fecha_entrada: r.fecha_entrada, fecha_salida: r.fecha_salida, num_huespedes: r.num_huespedes,
      plataforma: r.plataforma, codigo_confirmacion: r.codigo_confirmacion,
      monto_noche: r.monto_noche, monto_total: r.monto_total, estado: r.estado, notas: r.notas,
    }))

  const enlazadas: ReservaUnificada[] = []
  for (const r of reservasStr) {
    const propiedadId = r.unidad_id ? porUnidad.get(r.unidad_id) : undefined
    if (!propiedadId) continue
    enlazadas.push({
      id: r.id, origen: 'condominio', propiedad_id: propiedadId,
      huesped_nombre: r.huesped_nombre, huesped_email: r.huesped_email ?? null, huesped_telefono: r.huesped_telefono ?? null,
      fecha_entrada: r.fecha_entrada, fecha_salida: r.fecha_salida,
      num_huespedes: (r.num_adultos ?? 0) + (r.num_ninos ?? 0) + (r.num_bebes ?? 0),
      plataforma: PLATAFORMAS_SET.has(r.plataforma) ? (r.plataforma as PlataformaRenta) : 'otro',
      codigo_confirmacion: r.codigo_confirmacion ?? null,
      monto_noche: r.monto_noche ?? null, monto_total: r.monto_total ?? null,
      estado: ESTADOS_RESERVA_SET.has(r.estado) ? (r.estado as EstadoReservaRenta) : 'confirmada',
      notas: r.notas ?? null,
    })
  }

  return [...propias, ...enlazadas].sort((a, b) => b.fecha_entrada.localeCompare(a.fecha_entrada))
}

/** ¿La estancia cubre el día `hoy`? El día de salida ya no cuenta como ocupado. */
export function reservaCubre(r: Pick<ReservaUnificada, 'fecha_entrada' | 'fecha_salida' | 'estado'>, hoy: string): boolean {
  if (r.estado === 'cancelada' || r.estado === 'completada') return false
  return r.fecha_entrada <= hoy && hoy < r.fecha_salida
}

/**
 * Reservas no canceladas de la misma propiedad cuyas noches se cruzan con
 * [entrada, salida). Salir y entrar el mismo día NO es solape.
 */
export function reservasSolapadas(
  reservas: ReservaUnificada[], propiedadId: string, entrada: string, salida: string, excluirId?: string,
): ReservaUnificada[] {
  if (!entrada || !salida) return []
  return reservas.filter(r =>
    r.propiedad_id === propiedadId && r.id !== excluirId && r.estado !== 'cancelada'
    && r.fecha_entrada < salida && entrada < r.fecha_salida)
}

export type Ocupacion = 'ocupada' | 'disponible' | 'mantenimiento' | 'inactiva'
export const OCUPACION_LABEL: Record<Ocupacion, string> = {
  ocupada: 'Ocupada', disponible: 'Disponible', mantenimiento: 'En mantenimiento', inactiva: 'Inactiva',
}

/** Vigente y dentro de sus fechas el día `hoy` (un contrato vencido sin cerrar no ocupa). */
export function contratoActivo(c: ContratoRenta, hoy: string): boolean {
  return c.estado === 'vigente' && c.fecha_inicio <= hoy && (c.fecha_fin === null || hoy <= c.fecha_fin)
}

/**
 * Ocupación de una propiedad el día `hoy`. El estado operativo manda
 * (inactiva / mantenimiento); si está activa, la ocupa una reserva que cubre
 * el día o un contrato vigente dentro de sus fechas.
 */
export function ocupacionDePropiedad(
  p: PropiedadRenta, reservas: ReservaUnificada[], contratos: ContratoRenta[], hoy: string,
): Ocupacion {
  if (p.estado === 'inactiva') return 'inactiva'
  if (p.estado === 'mantenimiento') return 'mantenimiento'
  if (reservas.some(r => r.propiedad_id === p.id && reservaCubre(r, hoy))) return 'ocupada'
  if (contratos.some(c => c.propiedad_id === p.id && contratoActivo(c, hoy))) return 'ocupada'
  return 'disponible'
}

/** Días hasta el fin del contrato (negativo = ya venció). null si es indefinido o no está vigente. */
export function diasParaVencer(c: ContratoRenta, hoy: string): number | null {
  if (c.estado !== 'vigente' || !c.fecha_fin) return null
  return diasEntre(hoy, c.fecha_fin)
}

export interface ResumenInventario {
  articulos: number
  unidades: number
  valor: number
  danados: number
  faltantes: number
}

export function resumenInventario(articulos: ArticuloInventarioRenta[]): ResumenInventario {
  const r: ResumenInventario = { articulos: articulos.length, unidades: 0, valor: 0, danados: 0, faltantes: 0 }
  for (const a of articulos) {
    r.unidades += a.cantidad
    // Lo que falta no está: no suma al valor de lo que hay en la propiedad.
    if (a.estado !== 'faltante') r.valor += a.cantidad * (a.valor_unitario ?? 0)
    if (a.estado === 'danado') r.danados += 1
    if (a.estado === 'faltante') r.faltantes += 1
  }
  return r
}

export interface ResumenCartera {
  propiedades: number
  porTipo: Record<TipoPropiedadRenta, number>
  ocupadas: number
  disponibles: number
  fueraDeServicio: number
  /** Ocupadas / (ocupadas + disponibles), 0–100. null si no hay ninguna en servicio. */
  ocupacionPct: number | null
  reservasEnCurso: number
  proximasLlegadas: number
  /** Reservas no canceladas que ENTRAN este mes + renta de los contratos activos hoy. */
  ingresoMes: number
  contratosVigentes: number
  contratosPorVencer: number
  contratosVencidos: number
  inventario: ResumenInventario
}

export function resumenCartera(
  propiedades: PropiedadRenta[], reservas: ReservaUnificada[], contratos: ContratoRenta[],
  inventario: ArticuloInventarioRenta[], hoy: string,
): ResumenCartera {
  const porTipo: Record<TipoPropiedadRenta, number> = { corto_plazo: 0, largo_plazo: 0, local_comercial: 0, otro: 0 }
  let ocupadas = 0, disponibles = 0, fuera = 0
  for (const p of propiedades) {
    porTipo[p.tipo_renta] += 1
    const o = ocupacionDePropiedad(p, reservas, contratos, hoy)
    if (o === 'ocupada') ocupadas += 1
    else if (o === 'disponible') disponibles += 1
    else fuera += 1
  }
  const mes = hoy.slice(0, 7)
  let ingresoMes = 0, enCurso = 0, proximas = 0
  for (const r of reservas) {
    if (r.estado === 'cancelada') continue
    if (r.fecha_entrada.slice(0, 7) === mes) ingresoMes += r.monto_total ?? 0
    if (reservaCubre(r, hoy)) enCurso += 1
    const faltan = diasEntre(hoy, r.fecha_entrada)
    if (r.estado === 'confirmada' && faltan >= 1 && faltan <= 7) proximas += 1
  }
  let vigentes = 0, porVencer = 0, vencidos = 0
  for (const c of contratos) {
    if (c.estado !== 'vigente') continue
    vigentes += 1
    if (contratoActivo(c, hoy)) ingresoMes += c.renta_mensual
    const d = diasParaVencer(c, hoy)
    if (d !== null && d < 0) vencidos += 1
    else if (d !== null && d <= DIAS_AVISO_VENCIMIENTO) porVencer += 1
  }
  const enServicio = ocupadas + disponibles
  return {
    propiedades: propiedades.length, porTipo, ocupadas, disponibles, fueraDeServicio: fuera,
    ocupacionPct: enServicio > 0 ? Math.round((ocupadas / enServicio) * 100) : null,
    reservasEnCurso: enCurso, proximasLlegadas: proximas, ingresoMes,
    contratosVigentes: vigentes, contratosPorVencer: porVencer, contratosVencidos: vencidos,
    inventario: resumenInventario(inventario),
  }
}

/**
 * Mensaje para la persona a partir de un error del servidor: quita el código
 * `RENTAS_…:` y traduce los rechazos por índice único y por permisos.
 */
export function mensajeErrorRentas(e: unknown, porDefecto: string): string {
  const texto = e instanceof Error ? e.message : typeof e === 'string' ? e : ''
  if (!texto) return porDefecto
  if (texto.includes('rentas_propiedades_unidad_uq')) return 'Esa unidad ya está registrada como propiedad en renta.'
  if (texto.includes('rentas_contratos_vigente_uq')) return 'La propiedad ya tiene un contrato vigente. Finalízalo antes de registrar otro.'
  if (/row-level security|permission denied/i.test(texto)) return 'No tienes permiso para hacer este cambio.'
  const m = /^RENTAS_[A-Z_]+:\s*(.+)$/.exec(texto)
  if (m) return m[1].charAt(0).toUpperCase() + m[1].slice(1)
  return texto
}

/** Texto → número ≥ 0 o null (vacío). undefined si no es un número válido. */
export function numeroONulo(v: string): number | null | undefined {
  const t = v.trim().replace(',', '.')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}
