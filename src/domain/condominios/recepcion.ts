// domain/condominios/recepcion.ts — Vocabulario del motor único de recepción.
//
// Desde la unificación (migración 20260829000000) paquetería y correspondencia
// son la misma tabla y el mismo tipo (`PiezaRecepcion`), distinguidas por
// `clase`. Este módulo concentra lo que ambas pestañas necesitan por igual:
// etiquetas legibles, la bandeja combinada, búsqueda tolerante a cómo la gente
// teclea una guía, detección de duplicados y el cálculo de plazos.
//
// Es puro y sin I/O: los datos ya vienen cargados en el contexto de tabs.
import type {
  ClasePieza, EstadoPieza, PiezaRecepcion, SubtipoPieza,
} from '../../types'

export type OrigenRecepcion = ClasePieza

/** Vista de una pieza lista para pintar en la bandeja, sin ramas por clase. */
export interface ItemRecepcion {
  id: string
  origen: OrigenRecepcion
  /** Tab donde se administra la pieza (para el salto "abrir …"). */
  tabId: 'paqueteria' | 'correspondencia'
  direccion: 'entrada' | 'salida'
  titulo: string
  /** Etiqueta legible del subtipo (Paquete, Sobre, Notif. Legal…). */
  clase: string
  icono: string
  unidadNombre: string | null
  remitente: string | null
  destinatario: string | null
  guia: string | null
  mensajeria: string | null
  estado: string
  estadoLabel: string
  /** true cuando la pieza ya salió de custodia. */
  cerrado: boolean
  urgente: boolean
  /** Instante de ingreso, ISO. Criterio único de orden de la bandeja. */
  fecha: string
  fechaEntrega: string | null
  fechaLimite: string | null
  conFirma: boolean
  fotos: number
}

/** Subtipos por clase, con su etiqueta e ícono. Espeja el CHECK `paquetes_tipo_chk`. */
export const SUBTIPOS: Record<ClasePieza, Record<string, { label: string; icono: string }>> = {
  paquete: {
    paquete:   { label: 'Paquete',   icono: '📦' },
    documento: { label: 'Documento', icono: '📄' },
    sobre:     { label: 'Sobre',     icono: '✉️' },
    otro:      { label: 'Otro',      icono: '🎁' },
  },
  correspondencia: {
    carta:              { label: 'Carta',        icono: '✉️' },
    notificacion_legal: { label: 'Notif. Legal', icono: '⚖️' },
    factura:            { label: 'Factura',      icono: '🧾' },
    circular:           { label: 'Circular',     icono: '📰' },
    otro:               { label: 'Otro',         icono: '📨' },
  },
}

/** Estados por clase. Espeja el CHECK `paquetes_estado_chk`. */
export const ESTADOS: Record<ClasePieza, Record<string, string>> = {
  paquete:         { pendiente: 'Pendiente', entregado: 'Entregado', devuelto: 'Devuelto' },
  correspondencia: { pendiente: 'Pendiente', atendido: 'Atendido', archivado: 'Archivado' },
}

/** Subtipo por defecto de cada clase, para formularios y filas incompletas. */
export const SUBTIPO_POR_DEFECTO: Record<ClasePieza, SubtipoPieza> = {
  paquete: 'paquete',
  correspondencia: 'carta',
}

export function claseDePieza(p: Pick<PiezaRecepcion, 'clase'>): ClasePieza {
  // Filas anteriores a la unificación pueden llegar sin `clase` desde un caché
  // viejo; el default de la columna es 'paquete' y aquí se respeta.
  return p.clase === 'correspondencia' ? 'correspondencia' : 'paquete'
}

export function subtipoDePieza(p: PiezaRecepcion): { label: string; icono: string } {
  const clase = claseDePieza(p)
  return SUBTIPOS[clase][p.tipo] ?? SUBTIPOS[clase][SUBTIPO_POR_DEFECTO[clase]]
}

export function estadoLabel(p: PiezaRecepcion): string {
  return ESTADOS[claseDePieza(p)][p.estado] ?? p.estado
}

/** Una pieza está cerrada cuando salió de custodia, sea cual sea su clase. */
export function piezaCerrada(p: Pick<PiezaRecepcion, 'estado'>): boolean {
  return p.estado !== 'pendiente'
}

export function piezaAItemRecepcion(p: PiezaRecepcion): ItemRecepcion {
  const clase = claseDePieza(p)
  const subtipo = subtipoDePieza(p)
  return {
    id: p.id,
    origen: clase,
    tabId: clase === 'correspondencia' ? 'correspondencia' : 'paqueteria',
    direccion: p.direccion === 'saliente' || p.direccion === 'saliente_tercero' ? 'salida' : 'entrada',
    titulo: p.descripcion,
    clase: subtipo.label,
    icono: subtipo.icono,
    unidadNombre: p.unidad_nombre ?? null,
    remitente: p.remitente ?? null,
    // En una salida por tercero el destinatario real es quien está autorizado
    // a retirar; en correspondencia, a quién va dirigida.
    destinatario: p.destinatario ?? p.autorizado_nombre ?? null,
    guia: p.num_guia ?? null,
    mensajeria: p.empresa_mensajeria ?? null,
    estado: p.estado,
    estadoLabel: estadoLabel(p),
    cerrado: piezaCerrada(p),
    urgente: p.prioridad === 'urgente',
    fecha: p.hora_recepcion ?? p.created_at,
    fechaEntrega: p.hora_entrega ?? null,
    fechaLimite: p.fecha_limite ?? null,
    conFirma: Boolean(p.firma_path),
    fotos: p.fotos?.length ?? 0,
  }
}

interface BandejaInput {
  piezas: PiezaRecepcion[]
  /** Falso cuando el usuario no tiene permiso de ver esa clase: sus filas no entran a la bandeja. */
  incluirPaqueteria?: boolean
  incluirCorrespondencia?: boolean
}

/**
 * Bandeja unificada, más reciente primero.
 *
 * El filtro por permiso es explícito y NO se delega solo a la RLS: aunque la
 * policy resuelve el permiso por `clase` y no devolvería esas filas, el
 * contexto de tabs es compartido y puede traer datos cargados por otra pestaña
 * de la misma sesión. Aquí se corta también en la frontera de la UI.
 */
export function construirBandejaRecepcion({
  piezas, incluirPaqueteria = true, incluirCorrespondencia = true,
}: BandejaInput): ItemRecepcion[] {
  return piezas
    .filter(p => claseDePieza(p) === 'correspondencia' ? incluirCorrespondencia : incluirPaqueteria)
    .map(piezaAItemRecepcion)
    .sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0))
}

// Marcas de acento que deja `normalize('NFD')` al separar la letra de su tilde.
// Se usa la propiedad Unicode en vez del rango de codepoints: el rango se
// escribe con caracteres invisibles en el fuente y cualquier edición lo rompe
// sin que se note.
const SIGNOS_DIACRITICOS = /\p{Diacritic}/gu

/** Minúsculas sin acentos: "Notificación" y "notificacion" son la misma búsqueda. */
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(SIGNOS_DIACRITICOS, '').toLowerCase().trim()
}

/**
 * Forma comparable de un número de guía: solo alfanuméricos.
 * Quien busca pega "#A-1234" o "a1234" indistintamente, y la mensajería la
 * imprime con guiones que nadie teclea igual.
 */
export function normalizarGuia(guia: string | null | undefined): string {
  return (guia ?? '').normalize('NFD').replace(SIGNOS_DIACRITICOS, '').replace(/[^a-z0-9]/gi, '').toLowerCase()
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
 * Posibles duplicados: la misma pieza anotada dos veces con distinta clase. Se
 * agrupan por guía normalizada cuando hay más de una clase involucrada — la
 * guía es el único identificador que viene impreso en el envío.
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
 * Piezas pendientes cuyo plazo ya venció o vence dentro de `diasAviso`.
 * Alimenta la alerta del Panel General. Aplica a cualquier clase: hoy solo la
 * correspondencia captura `fecha_limite`, pero la regla no depende de eso.
 */
export function piezasEnRiesgo(
  piezas: PiezaRecepcion[],
  hoyISO: string,
  diasAviso = 3,
): { vencidas: PiezaRecepcion[]; porVencer: PiezaRecepcion[] } {
  const vencidas: PiezaRecepcion[] = []
  const porVencer: PiezaRecepcion[] = []
  for (const p of piezas) {
    if (piezaCerrada(p) || !p.fecha_limite) continue
    const dias = diasParaVencer(p.fecha_limite, hoyISO)
    if (Number.isNaN(dias)) continue
    if (dias < 0) vencidas.push(p)
    else if (dias <= diasAviso) porVencer.push(p)
  }
  return { vencidas, porVencer }
}

/** Estados válidos de una clase, para los filtros de cada pestaña. */
export function estadosDe(clase: ClasePieza): EstadoPieza[] {
  return Object.keys(ESTADOS[clase]) as EstadoPieza[]
}
