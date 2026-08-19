// domain/condominios/recepcion.ts — Modelo común de "algo físico en custodia
// de recepción", compartido por Paquetería y Correspondencia.
//
// POR QUÉ: las dos features modelan el mismo hecho (una pieza que entra o sale
// de portería a nombre de una unidad) en dos tablas distintas, con dos
// vocabularios distintos y en dos secciones distintas del menú (Seguridad vs
// Administración). Para quien busca "¿llegó el sobre con la guía #A1234?" eso
// significa adivinar en cuál de las dos pestañas quedó registrado — y nada
// impide que la misma pieza se registre en ambas.
//
// Este módulo NO fusiona las tablas (eso es la Fase 1). Normaliza las dos
// formas a un `ItemRecepcion` para que la bandeja unificada pueda buscar,
// ordenar y detectar duplicados sobre un solo arreglo. Es puro y sin I/O: los
// datos ya vienen cargados en el contexto de tabs.
import type { CorrespondenciaCondominio, PaqueteRecibido } from '../../types'

export type OrigenRecepcion = 'paqueteria' | 'correspondencia'

/** Vista canónica de una pieza en recepción, venga de donde venga. */
export interface ItemRecepcion {
  id: string
  origen: OrigenRecepcion
  /** Tab donde vive el registro (para el deep link "ver en …"). */
  tabId: 'paqueteria' | 'correspondencia'
  /** Sentido del movimiento, unificado: paquetería dice entrante/saliente_tercero, correspondencia entrada/salida. */
  direccion: 'entrada' | 'salida'
  titulo: string
  /** Etiqueta legible de la subclase (Paquete, Sobre, Notif. Legal…). */
  clase: string
  icono: string
  unidadNombre: string | null
  remitente: string | null
  destinatario: string | null
  guia: string | null
  mensajeria: string | null
  estado: string
  estadoLabel: string
  /** true cuando la pieza ya salió de custodia (entregada o atendida). */
  cerrado: boolean
  urgente: boolean
  /** Fecha/hora de ingreso, ISO. Criterio único de orden de la bandeja. */
  fecha: string
  fechaEntrega: string | null
  fechaLimite: string | null
  conFirma: boolean
  fotos: number
}

const CLASE_PAQUETE: Record<string, { label: string; icono: string }> = {
  paquete:   { label: 'Paquete',   icono: '📦' },
  documento: { label: 'Documento', icono: '📄' },
  sobre:     { label: 'Sobre',     icono: '✉️' },
  otro:      { label: 'Otro',      icono: '🎁' },
}

const CLASE_CORRESPONDENCIA: Record<string, { label: string; icono: string }> = {
  carta:              { label: 'Carta',       icono: '✉️' },
  notificacion_legal: { label: 'Notif. Legal', icono: '⚖️' },
  factura:            { label: 'Factura',     icono: '🧾' },
  circular:           { label: 'Circular',    icono: '📰' },
  otro:               { label: 'Otro',        icono: '📨' },
}

const ESTADO_PAQUETE: Record<string, string> = {
  pendiente: 'Pendiente', entregado: 'Entregado', devuelto: 'Devuelto',
}
const ESTADO_CORRESPONDENCIA: Record<string, string> = {
  pendiente: 'Pendiente', atendido: 'Atendido', archivado: 'Archivado',
}

export function paqueteAItemRecepcion(p: PaqueteRecibido): ItemRecepcion {
  const clase = CLASE_PAQUETE[p.tipo] ?? CLASE_PAQUETE.paquete
  return {
    id: p.id,
    origen: 'paqueteria',
    tabId: 'paqueteria',
    direccion: p.direccion === 'saliente_tercero' ? 'salida' : 'entrada',
    titulo: p.descripcion,
    clase: clase.label,
    icono: clase.icono,
    unidadNombre: p.unidad_nombre ?? null,
    remitente: p.remitente ?? null,
    // En una salida por tercero el "destinatario" real es el autorizado a retirar.
    destinatario: p.autorizado_nombre ?? null,
    guia: p.num_guia ?? null,
    mensajeria: p.empresa_mensajeria ?? null,
    estado: p.estado,
    estadoLabel: ESTADO_PAQUETE[p.estado] ?? p.estado,
    cerrado: p.estado !== 'pendiente',
    urgente: false, // paquetería no tiene prioridad todavía (llega en la Fase 1)
    fecha: p.hora_recepcion ?? p.created_at,
    fechaEntrega: p.hora_entrega ?? null,
    fechaLimite: null,
    conFirma: Boolean(p.firma_path),
    fotos: p.fotos?.length ?? 0,
  }
}

export function correspondenciaAItemRecepcion(c: CorrespondenciaCondominio): ItemRecepcion {
  const clase = CLASE_CORRESPONDENCIA[c.categoria] ?? CLASE_CORRESPONDENCIA.otro
  return {
    id: c.id,
    origen: 'correspondencia',
    tabId: 'correspondencia',
    direccion: c.tipo === 'salida' ? 'salida' : 'entrada',
    titulo: c.asunto,
    clase: clase.label,
    icono: clase.icono,
    unidadNombre: c.unidad_nombre ?? null,
    remitente: c.remitente ?? null,
    destinatario: c.destinatario ?? null,
    guia: c.numero_guia ?? null,
    mensajeria: c.empresa_mensajeria ?? null,
    estado: c.estado,
    estadoLabel: ESTADO_CORRESPONDENCIA[c.estado] ?? c.estado,
    cerrado: c.estado !== 'pendiente',
    urgente: c.prioridad === 'urgente',
    // `fecha` es un date (fecha del documento); created_at da la hora real de
    // registro. Se usa el date para que el orden coincida con lo que la pestaña
    // de Correspondencia muestra, con created_at como desempate implícito.
    fecha: c.fecha,
    fechaEntrega: c.hora_entrega ?? null,
    fechaLimite: c.fecha_limite ?? null,
    conFirma: Boolean(c.firma_path),
    fotos: c.fotos?.length ?? 0,
  }
}

interface BandejaInput {
  paquetes: PaqueteRecibido[]
  correspondencia: CorrespondenciaCondominio[]
  /** Falso cuando el usuario no tiene permiso de ver esa pestaña: sus filas no entran a la bandeja. */
  incluirPaqueteria?: boolean
  incluirCorrespondencia?: boolean
}

/**
 * Bandeja unificada, más reciente primero.
 *
 * El filtro por permiso es explícito y NO se delega solo a la RLS: aunque un
 * usuario sin permiso de correspondencia recibiría el arreglo vacío del
 * servidor, el contexto de tabs es compartido y puede traer datos cargados por
 * otra pestaña de la misma sesión. Aquí se corta en la frontera de la UI.
 */
export function construirBandejaRecepcion({
  paquetes, correspondencia,
  incluirPaqueteria = true, incluirCorrespondencia = true,
}: BandejaInput): ItemRecepcion[] {
  const items: ItemRecepcion[] = []
  if (incluirPaqueteria) for (const p of paquetes) items.push(paqueteAItemRecepcion(p))
  if (incluirCorrespondencia) for (const c of correspondencia) items.push(correspondenciaAItemRecepcion(c))
  return items.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0))
}

/** Minúsculas sin acentos: "Notificación" y "notificacion" son la misma búsqueda. */
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

/**
 * Forma comparable de un número de guía: solo alfanuméricos.
 * Quien busca pega "#A-1234" o "a1234" indistintamente, y la mensajería la
 * imprime con guiones que nadie teclea igual.
 */
export function normalizarGuia(guia: string | null | undefined): string {
  return (guia ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase()
}

/**
 * Búsqueda por texto libre sobre la bandeja. Cada palabra debe aparecer en
 * algún campo (AND entre términos, OR entre campos), y además se prueba contra
 * la guía normalizada para que "#A-1234" encuentre "a1234".
 */
export function buscarEnRecepcion(items: ItemRecepcion[], consulta: string): ItemRecepcion[] {
  const terminos = normalizar(consulta).split(/\s+/).filter(Boolean)
  if (terminos.length === 0) return items
  return items.filter(item => {
    const campos = normalizar([
      item.titulo, item.clase, item.unidadNombre, item.remitente,
      item.destinatario, item.guia, item.mensajeria, item.estadoLabel,
    ].filter(Boolean).join(' '))
    const guia = normalizarGuia(item.guia)
    return terminos.every(t => campos.includes(t) || (guia !== '' && guia.includes(normalizarGuia(t))))
  })
}

/**
 * Posibles duplicados: la misma pieza registrada en las dos pestañas. Se
 * agrupan por guía normalizada cuando hay más de un origen involucrado — la
 * guía es el único identificador que ambos módulos capturan y que viene
 * impreso en el envío.
 */
export function duplicadosPorGuia(items: ItemRecepcion[]): ItemRecepcion[][] {
  const porGuia = new Map<string, ItemRecepcion[]>()
  for (const item of items) {
    const guia = normalizarGuia(item.guia)
    if (!guia) continue
    const grupo = porGuia.get(guia)
    if (grupo) grupo.push(item)
    else porGuia.set(guia, [item])
  }
  return [...porGuia.values()].filter(g => g.length > 1 && new Set(g.map(i => i.origen)).size > 1)
}

/** Días que faltan para `fechaLimite` (negativo = vencido). */
export function diasParaVencer(fechaLimite: string, hoyISO: string): number {
  const limite = Date.parse(`${fechaLimite}T00:00:00`)
  const hoy = Date.parse(`${hoyISO}T00:00:00`)
  if (Number.isNaN(limite) || Number.isNaN(hoy)) return Number.NaN
  return Math.round((limite - hoy) / 86_400_000)
}

/**
 * Correspondencia pendiente cuyo plazo legal ya venció o vence dentro de
 * `diasAviso`. Alimenta la alerta del Panel General.
 */
export function correspondenciaEnRiesgo(
  correspondencia: CorrespondenciaCondominio[],
  hoyISO: string,
  diasAviso = 3,
): { vencidas: CorrespondenciaCondominio[]; porVencer: CorrespondenciaCondominio[] } {
  const vencidas: CorrespondenciaCondominio[] = []
  const porVencer: CorrespondenciaCondominio[] = []
  for (const c of correspondencia) {
    if (c.estado !== 'pendiente' || !c.fecha_limite) continue
    const dias = diasParaVencer(c.fecha_limite, hoyISO)
    if (Number.isNaN(dias)) continue
    if (dias < 0) vencidas.push(c)
    else if (dias <= diasAviso) porVencer.push(c)
  }
  return { vencidas, porVencer }
}
