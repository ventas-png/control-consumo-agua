// domain/condominios/minutas.ts — Minutas de reunión (pestaña «Minutas», tabla
// notas_admin · 20261110000000).
//
// Una minuta dice QUIÉNES participaron (empleados, propietarios/inquilinos,
// proveedores u otros, y quién la gestionó), QUÉ puntos se abordaron y, por
// cada punto, los ACUERDOS (lo decidido) y los COMPROMISOS (lo que alguien
// asume, con fecha límite). Aquí vive lo que no es pantalla: normalizar los
// JSON que llegan de la base, armar las listas de candidatos a participante,
// validar cada paso del asistente y resumir el seguimiento de compromisos.
import { db } from '../../lib/supabase'
import { reportDegradedQuery } from '../queryFetch'
import { diasHastaFechaCalendario, diaLocalDeInstante, esFechaCalendario } from '../../lib/format'
import { normalizarNombre } from '../proveedores/identidad'
import type {
  AcuerdoMinuta, CategoriaNota, ContratoArrendamiento, ContratoProveedor, FirmaMinuta, NotaAdmin, ParticipanteMinuta,
  PersonalCondominio, PrioridadNota, PuntoMinuta, TipoAcuerdoMinuta, TipoParticipanteMinuta, TipoResidente, Unidad,
} from '../../types'
import type { ProveedorCatalogo } from '../../types/proveedores'
import type { Json } from '../../types/database.types'

// ── Catálogos de etiquetas ───────────────────────────────────────────────────

export const TIPOS_PARTICIPANTE: readonly TipoParticipanteMinuta[] = ['empleado', 'residente', 'proveedor', 'otro']

export const TIPO_PARTICIPANTE_INFO: Record<TipoParticipanteMinuta, { label: string; plural: string; icon: string }> = {
  empleado:  { label: 'Empleado',               plural: 'Empleados',                 icon: '👷' },
  residente: { label: 'Propietario / inquilino', plural: 'Propietarios e inquilinos', icon: '🏠' },
  proveedor: { label: 'Proveedor',              plural: 'Proveedores',               icon: '🏢' },
  otro:      { label: 'Otro',                   plural: 'Otros',                     icon: '👤' },
}

/** `arrendatario` se muestra como «Inquilino» (igual que en Cuotas y el portal). */
export const ROL_RESIDENTE_LABEL: Record<TipoResidente, string> = {
  propietario: 'Propietario', arrendatario: 'Inquilino', familiar: 'Familiar', otro: 'Residente',
}

export const TIPO_ACUERDO_INFO: Record<TipoAcuerdoMinuta, { label: string; icon: string }> = {
  acuerdo:    { label: 'Acuerdo',    icon: '🤝' },
  compromiso: { label: 'Compromiso', icon: '📌' },
}

const TIPOS_PARTICIPANTE_SET = new Set<string>(TIPOS_PARTICIPANTE)
const TIPOS_ACUERDO_SET = new Set<string>(['acuerdo', 'compromiso'])

// ── Identificadores locales ──────────────────────────────────────────────────

/** Id local de participantes, puntos y acuerdos (los compromisos citan al responsable por él). */
export function nuevoIdMinuta(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

// ── Normalización de lo que llega de la base ─────────────────────────────────
// Las columnas son JSON: una fila anterior a la migración, una prueba o una
// edición a mano pueden traer `null`, un objeto o elementos incompletos. La
// pantalla recorre listas limpias y nunca revienta por eso.

function texto(v: unknown): string {
  return typeof v === 'string' ? v : ''
}
function textoONull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

export function participantesDe(nota: Pick<NotaAdmin, 'participantes'> | null | undefined): ParticipanteMinuta[] {
  const lista = nota?.participantes
  if (!Array.isArray(lista)) return []
  const out: ParticipanteMinuta[] = []
  for (const raw of lista as unknown[]) {
    if (!raw || typeof raw !== 'object') continue
    const p = raw as Record<string, unknown>
    const nombre = texto(p.nombre).trim()
    if (!nombre) continue
    out.push({
      id: texto(p.id) || nuevoIdMinuta(),
      tipo: TIPOS_PARTICIPANTE_SET.has(texto(p.tipo)) ? (p.tipo as TipoParticipanteMinuta) : 'otro',
      ref_id: textoONull(p.ref_id),
      nombre,
      detalle: textoONull(p.detalle),
      gestiona: p.gestiona === true,
    })
  }
  return out
}

export function puntosDe(nota: Pick<NotaAdmin, 'puntos'> | null | undefined): PuntoMinuta[] {
  const lista = nota?.puntos
  if (!Array.isArray(lista)) return []
  const out: PuntoMinuta[] = []
  for (const raw of lista as unknown[]) {
    if (!raw || typeof raw !== 'object') continue
    const p = raw as Record<string, unknown>
    const titulo = texto(p.titulo).trim()
    if (!titulo) continue
    const acuerdos: AcuerdoMinuta[] = []
    if (Array.isArray(p.acuerdos)) {
      for (const ra of p.acuerdos as unknown[]) {
        if (!ra || typeof ra !== 'object') continue
        const a = ra as Record<string, unknown>
        const t = texto(a.texto).trim()
        if (!t) continue
        acuerdos.push({
          id: texto(a.id) || nuevoIdMinuta(),
          tipo: TIPOS_ACUERDO_SET.has(texto(a.tipo)) ? (a.tipo as TipoAcuerdoMinuta) : 'acuerdo',
          texto: t,
          responsable_id: textoONull(a.responsable_id),
          fecha_limite: esFechaCalendario(a.fecha_limite) ? a.fecha_limite : null,
          cumplido: a.cumplido === true,
          cumplido_at: textoONull(a.cumplido_at),
        })
      }
    }
    out.push({ id: texto(p.id) || nuevoIdMinuta(), titulo, descripcion: textoONull(p.descripcion), acuerdos })
  }
  return out
}

// ── Fotos (20261112000000) y documentos (20261112000100) ────────────────────

/** Fotos por minuta: lo mismo que el CHECK de la base y que ofrece el uploader. */
export const MAX_FOTOS_MINUTA = 10
/** Documentos por minuta: lo mismo que el CHECK de la base y que ofrece el uploader. */
export const MAX_DOCUMENTOS_MINUTA = 10

/** Rutas sin vacíos ni repetidas, y nunca más de las que admite la base. */
function rutasDe(lista: unknown, max: number): string[] {
  if (!Array.isArray(lista)) return []
  const vistas = new Set<string>()
  for (const f of lista as unknown[]) {
    if (typeof f !== 'string') continue
    const ruta = f.trim()
    if (ruta) vistas.add(ruta)
  }
  return [...vistas].slice(0, max)
}

export function fotosDe(nota: Pick<NotaAdmin, 'fotos'> | null | undefined): string[] {
  return rutasDe(nota?.fotos, MAX_FOTOS_MINUTA)
}

export function documentosDe(nota: Pick<NotaAdmin, 'documentos'> | null | undefined): string[] {
  return rutasDe(nota?.documentos, MAX_DOCUMENTOS_MINUTA)
}

/** Las rutas de `antes` que ya no están en `despues`. */
export function rutasQuitadas(antes: readonly string[], despues: readonly string[]): string[] {
  const quedan = new Set(despues)
  return antes.filter(f => !quedan.has(f))
}

/** Mismas rutas en el mismo orden. */
export function mismasRutas(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((r, i) => r === b[i])
}

/**
 * Qué archivos borrar del bucket cuando el asistente se cierra. El uploader no
 * borra nada al quitar: una minuta nunca debe apuntar a un archivo borrado, y
 * hasta que se guarda no se sabe cuáles quedan.
 *
 *   - `guardadas` — lo que quedó en la fila; `null` si no se guardó (cancelar,
 *     Esc, «Atrás» del sistema).
 *   - `originales` — lo que la fila tenía al abrir.
 *   - `vistas` — toda ruta que pasó por la lista en esta edición, incluidas las
 *     subidas que después se quitaron.
 *
 * Guardada: lo que estuvo (antes o en esta edición) y ya no está. Sin guardar:
 * sólo lo subido en esta edición; lo original sigue referenciado por la fila.
 */
export function archivosPorBorrar(originales: readonly string[], vistas: Iterable<string>, guardadas: readonly string[] | null): string[] {
  const conservar = new Set(guardadas ?? originales)
  const fuera = new Set<string>()
  for (const r of [...(guardadas ? originales : []), ...vistas]) {
    if (!conservar.has(r)) fuera.add(r)
  }
  return [...fuera]
}

// ── Firmas (20261120000000) ──────────────────────────────────────────────────

/** Una firma por participante (si llegan dos, gana la última), sin entradas sin ruta o sin participante. */
export function firmasDe(nota: Pick<NotaAdmin, 'firmas'> | null | undefined): FirmaMinuta[] {
  const lista = nota?.firmas
  if (!Array.isArray(lista)) return []
  const porParticipante = new Map<string, FirmaMinuta>()
  for (const f of lista as unknown[]) {
    if (!f || typeof f !== 'object') continue
    const o = f as Record<string, unknown>
    const participante_id = texto(o.participante_id)
    const path = texto(o.path)
    if (!participante_id || !path) continue
    porParticipante.set(participante_id, { participante_id, nombre: texto(o.nombre), path, firmado_at: texto(o.firmado_at), version: texto(o.version) })
  }
  return [...porParticipante.values()]
}

/**
 * Huella de lo que se firma: los puntos con sus acuerdos y compromisos (texto,
 * responsable y fecha límite). No entra el estado «cumplido»: marcar el
 * seguimiento no cambia lo acordado. Si la huella cambia, las firmas que ya
 * había son de una versión anterior. Detecta cambios; no es criptográfica.
 *
 * Recibe lo que se guarda (depurarBorrador) o lo que se leyó (puntosDe): las
 * dos formas dan la misma huella para el mismo contenido.
 */
export function versionAcuerdos(puntos: readonly PuntoMinuta[], participantes: readonly ParticipanteMinuta[]): string {
  const nombre = new Map(participantes.map(p => [p.id, p.nombre.trim()]))
  const canon = puntos
    .filter(p => p.titulo.trim())
    .map(p => [
      p.titulo.trim(),
      (p.descripcion ?? '').trim(),
      p.acuerdos
        .filter(a => a.texto.trim())
        .map(a => a.tipo === 'compromiso'
          ? [a.tipo, a.texto.trim(), nombre.get(a.responsable_id ?? '') ?? '', a.fecha_limite ?? '']
          : [a.tipo, a.texto.trim()]),
    ])
  return cyrb53(JSON.stringify(canon))
}

/** Hash de 53 bits (cyrb53), en hexadecimal. */
function cyrb53(str: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)
}

/** «vigente» si firmó lo que la minuta dice hoy; «anterior» si los acuerdos cambiaron después. */
export function estadoFirma(f: Pick<FirmaMinuta, 'version'>, version: string): 'vigente' | 'anterior' {
  return f.version === version ? 'vigente' : 'anterior'
}

/** Sólo las firmas de quienes siguen en la minuta: la de alguien que se quitó no se guarda. */
export function firmasDeParticipantes(firmas: readonly FirmaMinuta[], participantes: readonly ParticipanteMinuta[]): FirmaMinuta[] {
  const ids = new Set(participantes.map(p => p.id))
  return firmas.filter(f => ids.has(f.participante_id))
}

/** Reemplaza (o agrega) la firma de ese participante. */
export function conFirma(firmas: readonly FirmaMinuta[], nueva: FirmaMinuta): FirmaMinuta[] {
  return [...firmas.filter(f => f.participante_id !== nueva.participante_id), nueva]
}

export function sinFirma(firmas: readonly FirmaMinuta[], participanteId: string): FirmaMinuta[] {
  return firmas.filter(f => f.participante_id !== participanteId)
}

/**
 * Las firmas que se guardan al editar: las que la fila tiene AHORA, con lo que
 * esta edición cambió aplicado encima, participante por participante (altas,
 * reemplazos y bajas). Sin esto, guardar el asistente escribía la lista que se
 * cargó al abrirlo y borraba una firma registrada desde el detalle mientras
 * tanto —o volvía a citar una imagen que el detalle ya había reemplazado—.
 */
export function fusionarFirmas(actuales: readonly FirmaMinuta[], originales: readonly FirmaMinuta[], editadas: readonly FirmaMinuta[]): FirmaMinuta[] {
  const ruta = (l: readonly FirmaMinuta[], id: string) => l.find(f => f.participante_id === id)?.path
  const tocadas = new Set([...originales, ...editadas].map(f => f.participante_id).filter(id => ruta(originales, id) !== ruta(editadas, id)))
  return [...actuales.filter(f => !tocadas.has(f.participante_id)), ...editadas.filter(f => tocadas.has(f.participante_id))]
}

/**
 * Sólo las rutas de la carpeta del proyecto de la minuta. Lo que llega de la
 * fila se borra del bucket; una ruta manipulada no debe arrastrar archivos de
 * otro proyecto que quien borra sí puede tocar.
 */
export function rutasDelProyecto(rutas: readonly string[], projectId: string): string[] {
  return rutas.filter(r => r.startsWith(`${projectId}/`))
}

export interface ResumenFirmas {
  /** Participantes que deben firmar. */
  total: number
  /** Firmaron lo que la minuta dice hoy. */
  vigentes: number
  /** Firmaron una versión anterior de los acuerdos. */
  anteriores: number
  /** Sin firma vigente (no firmaron o firmaron una versión anterior). */
  pendientes: number
}

export function resumenFirmas(participantes: readonly ParticipanteMinuta[], firmas: readonly FirmaMinuta[], version: string): ResumenFirmas {
  const propias = firmasDeParticipantes(firmas, participantes)
  const vigentes = propias.filter(f => estadoFirma(f, version) === 'vigente').length
  return { total: participantes.length, vigentes, anteriores: propias.length - vigentes, pendientes: participantes.length - vigentes }
}

export function gestorDe(participantes: readonly ParticipanteMinuta[]): ParticipanteMinuta | null {
  return participantes.find(p => p.gestiona) ?? null
}

/** Día de la reunión; una nota anterior a la migración usa el día (local) en que se escribió. */
export function fechaDeMinuta(nota: Pick<NotaAdmin, 'fecha_reunion' | 'created_at'>): string {
  if (esFechaCalendario(nota.fecha_reunion)) return nota.fecha_reunion
  return diaLocalDeInstante(nota.created_at) ?? ''
}

// ── Seguimiento de compromisos ───────────────────────────────────────────────

export type SituacionCompromiso = 'cumplido' | 'vencido' | 'hoy' | 'pendiente' | 'sin_fecha'

export function situacionCompromiso(a: Pick<AcuerdoMinuta, 'cumplido' | 'fecha_limite'>, referencia: Date = new Date()): SituacionCompromiso {
  if (a.cumplido) return 'cumplido'
  const dias = diasHastaFechaCalendario(a.fecha_limite, referencia)
  if (dias === null) return 'sin_fecha'
  if (dias < 0) return 'vencido'
  if (dias === 0) return 'hoy'
  return 'pendiente'
}

/** «vence hoy», «vence en 3 días», «venció hace 2 días». Días de calendario locales. */
export function plazoCompromiso(dias: number): string {
  if (dias < 0) return `venció hace ${-dias} día${dias === -1 ? '' : 's'}`
  if (dias === 0) return 'vence hoy'
  return `vence en ${dias} día${dias === 1 ? '' : 's'}`
}

/** Próximo seguimiento de la minuta: «en 3 días», «hoy», «vencido hace 2 días». Días de calendario locales. */
export function plazoSeguimiento(dias: number): string {
  if (dias < 0) return `vencido hace ${-dias} día${dias === -1 ? '' : 's'}`
  if (dias === 0) return 'hoy'
  return `en ${dias} día${dias === 1 ? '' : 's'}`
}

export interface ResumenCompromisos {
  /** Compromisos (no cuenta los acuerdos). */
  total: number
  cumplidos: number
  pendientes: number
  vencidos: number
  /** Acuerdos (lo decidido, sin seguimiento). */
  acuerdos: number
}

export function resumenCompromisos(puntos: readonly PuntoMinuta[], referencia: Date = new Date()): ResumenCompromisos {
  const r: ResumenCompromisos = { total: 0, cumplidos: 0, pendientes: 0, vencidos: 0, acuerdos: 0 }
  for (const p of puntos) {
    for (const a of p.acuerdos) {
      if (a.tipo !== 'compromiso') { r.acuerdos++; continue }
      r.total++
      const s = situacionCompromiso(a, referencia)
      if (s === 'cumplido') r.cumplidos++
      else { r.pendientes++; if (s === 'vencido') r.vencidos++ }
    }
  }
  return r
}

/** Devuelve los puntos con el acuerdo `acuerdoId` marcado (o desmarcado) como cumplido. */
export function marcarCumplido(puntos: readonly PuntoMinuta[], acuerdoId: string, cumplido: boolean, ahora: string): PuntoMinuta[] {
  return puntos.map(p => ({
    ...p,
    acuerdos: p.acuerdos.map(a => a.id === acuerdoId ? { ...a, cumplido, cumplido_at: cumplido ? ahora : null } : a),
  }))
}

// ── Borrador del asistente ───────────────────────────────────────────────────

export type PasoMinuta = 1 | 2 | 3 | 4

export const PASOS_MINUTA: { n: PasoMinuta; label: string; titulo: string }[] = [
  { n: 1, label: 'Participantes', titulo: '¿Quiénes participan?' },
  { n: 2, label: 'Puntos',        titulo: '¿Qué puntos se abordan?' },
  { n: 3, label: 'Acuerdos',      titulo: '¿Qué se acordó en cada punto?' },
  { n: 4, label: 'Firmas',        titulo: '¿Quiénes firman los acuerdos?' },
]

export interface BorradorMinuta {
  titulo: string
  fecha_reunion: string
  /** Objetivo o contexto (opcional). */
  contenido: string
  categoria: CategoriaNota
  prioridad: PrioridadNota
  fecha_recordatorio: string
  fijada: boolean
  participantes: ParticipanteMinuta[]
  puntos: PuntoMinuta[]
  fotos: string[]
  documentos: string[]
  firmas: FirmaMinuta[]
}

/**
 * Borrador para el asistente. Nueva: quien la crea queda como primer
 * participante y gestor (se puede cambiar). Editar: lo guardado, normalizado.
 */
export function borradorDesde(nota: NotaAdmin | null, gestorNombre: string, hoy: string): BorradorMinuta {
  if (!nota) {
    const nombre = gestorNombre.trim()
    return {
      titulo: '', fecha_reunion: hoy, contenido: '', categoria: 'reunion', prioridad: 'normal', fecha_recordatorio: '', fijada: false,
      participantes: nombre ? [{ id: nuevoIdMinuta(), tipo: 'otro', ref_id: null, nombre, detalle: 'Administración', gestiona: true }] : [],
      puntos: [],
      fotos: [],
      documentos: [],
      firmas: [],
    }
  }
  return {
    titulo: nota.titulo,
    fecha_reunion: fechaDeMinuta(nota),
    contenido: nota.contenido ?? '',
    categoria: nota.categoria,
    prioridad: nota.prioridad,
    fecha_recordatorio: nota.fecha_recordatorio ?? '',
    fijada: nota.fijada,
    participantes: participantesDe(nota),
    puntos: puntosDe(nota),
    fotos: fotosDe(nota),
    documentos: documentosDe(nota),
    firmas: firmasDe(nota),
  }
}

/** Mensaje de lo que falta para avanzar del paso, o null si el paso está completo. */
export function validarPasoMinuta(b: BorradorMinuta, paso: PasoMinuta): string | null {
  if (paso === 1) {
    if (!b.titulo.trim()) return 'Ponle un título a la minuta.'
    if (!esFechaCalendario(b.fecha_reunion)) return 'La fecha de la reunión no es válida.'
    if (b.participantes.length === 0) return 'Agrega al menos un participante.'
    if (!b.participantes.some(p => p.gestiona)) return 'Indica quién gestiona la minuta.'
    return null
  }
  if (paso === 2) {
    if (!b.puntos.some(p => p.titulo.trim())) return 'Anota al menos un punto a abordar.'
    return null
  }
  if (paso === 3) {
    for (const p of b.puntos) {
      for (const a of p.acuerdos) {
        if (a.tipo === 'compromiso' && a.texto.trim() && a.fecha_limite && !esFechaCalendario(a.fecha_limite)) {
          return `La fecha límite de un compromiso de «${p.titulo}» no es válida.`
        }
      }
    }
    if (b.fecha_recordatorio && !esFechaCalendario(b.fecha_recordatorio)) return 'La fecha del próximo seguimiento no es válida.'
    return null
  }
  // Paso 4: firmar es opcional; quien no firme ahora puede hacerlo desde el detalle.
  return null
}

/**
 * Lo que se guarda: textos recortados, puntos y acuerdos vacíos fuera, y un
 * responsable que ya no está entre los participantes se suelta.
 */
export function depurarBorrador(b: BorradorMinuta): Pick<BorradorMinuta, 'participantes' | 'puntos'> {
  const participantes = b.participantes
    .map(p => ({ ...p, nombre: p.nombre.trim(), detalle: p.detalle?.trim() || null }))
    .filter(p => p.nombre)
  const ids = new Set(participantes.map(p => p.id))
  const puntos = b.puntos
    .map(p => ({
      ...p,
      titulo: p.titulo.trim(),
      descripcion: p.descripcion?.trim() || null,
      acuerdos: p.acuerdos
        .map(a => ({
          ...a,
          texto: a.texto.trim(),
          responsable_id: a.tipo === 'compromiso' && a.responsable_id && ids.has(a.responsable_id) ? a.responsable_id : null,
          fecha_limite: a.tipo === 'compromiso' && esFechaCalendario(a.fecha_limite) ? a.fecha_limite : null,
          cumplido: a.tipo === 'compromiso' ? a.cumplido : false,
          cumplido_at: a.tipo === 'compromiso' && a.cumplido ? (a.cumplido_at ?? null) : null,
        }))
        .filter(a => a.texto),
    }))
    .filter(p => p.titulo)
  return { participantes, puntos }
}

/** Deja a `id` como único gestor. */
export function designarGestor(participantes: readonly ParticipanteMinuta[], id: string): ParticipanteMinuta[] {
  return participantes.map(p => ({ ...p, gestiona: p.id === id }))
}

/**
 * Quita a un participante. Si gestionaba, el primero que queda toma el relevo
 * para que la minuta nunca se quede sin gestor sin que se note.
 */
export function quitarParticipante(participantes: readonly ParticipanteMinuta[], id: string): ParticipanteMinuta[] {
  const quedan = participantes.filter(p => p.id !== id)
  if (quedan.length > 0 && !quedan.some(p => p.gestiona)) quedan[0] = { ...quedan[0], gestiona: true }
  return quedan
}

// ── Candidatos a participante ────────────────────────────────────────────────

export interface CandidatoParticipante {
  /** Única dentro de su lista: evita agregar dos veces a la misma persona. */
  clave: string
  tipo: TipoParticipanteMinuta
  ref_id: string | null
  nombre: string
  detalle: string | null
}

/** Residente de una unidad del proyecto (unidad_residentes + cliente + unidad). */
export interface ResidenteProyecto {
  id: string
  unidad_id: string
  cliente_id: string
  tipo: TipoResidente
  nombre: string
  unidad_nombre: string | null
}

export function candidatosEmpleados(personal: readonly PersonalCondominio[], nombreCargo?: (codigo: string) => string | undefined): CandidatoParticipante[] {
  return personal
    .filter(p => p.estado !== 'inactivo' && p.nombre?.trim())
    .map(p => ({
      clave: `empleado:${p.id}`,
      tipo: 'empleado' as const,
      ref_id: p.id,
      nombre: p.nombre.trim(),
      detalle: (p.cargo && (nombreCargo?.(p.cargo) ?? capitalizar(p.cargo))) || null,
    }))
    .sort(porNombre)
}

/**
 * Propietarios e inquilinos del condominio. La fuente principal es
 * unidad_residentes (con rol); se completa con el dueño registrado en la
 * unidad y con el arrendatario del contrato vigente cuando la unidad no tiene
 * ese rol como residente, que es el caso de los condominios sin portal.
 */
export function candidatosResidentes(
  residentes: readonly ResidenteProyecto[],
  unidades: readonly Unidad[],
  contratos: readonly ContratoArrendamiento[],
): CandidatoParticipante[] {
  const out: CandidatoParticipante[] = []
  const vistos = new Set<string>()
  const rolesPorUnidad = new Map<string, Set<TipoResidente>>()
  const nombreUnidad = new Map(unidades.map(u => [u.id, u.nombre]))

  function agregar(c: CandidatoParticipante) {
    const huella = `${normalizarNombre(c.nombre)}|${normalizarNombre(c.detalle)}`
    if (vistos.has(huella)) return
    vistos.add(huella)
    out.push(c)
  }

  for (const r of residentes) {
    if (!r.nombre?.trim()) continue
    const unidad = r.unidad_nombre ?? nombreUnidad.get(r.unidad_id) ?? null
    const rol = ROL_RESIDENTE_LABEL[r.tipo] ?? ROL_RESIDENTE_LABEL.otro
    agregar({ clave: `residente:${r.id}`, tipo: 'residente', ref_id: r.id, nombre: r.nombre.trim(), detalle: unidad ? `${unidad} · ${rol}` : rol })
    if (!rolesPorUnidad.has(r.unidad_id)) rolesPorUnidad.set(r.unidad_id, new Set())
    rolesPorUnidad.get(r.unidad_id)!.add(r.tipo)
  }
  for (const u of unidades) {
    if (u.activo === false || !u.propietario_nombre?.trim()) continue
    if (rolesPorUnidad.get(u.id)?.has('propietario')) continue
    agregar({ clave: `unidad:${u.id}`, tipo: 'residente', ref_id: null, nombre: u.propietario_nombre.trim(), detalle: `${u.nombre} · Propietario` })
  }
  for (const c of contratos) {
    if (c.estado !== 'activo' || !c.arrendatario_nombre?.trim()) continue
    if (rolesPorUnidad.get(c.unidad_id)?.has('arrendatario')) continue
    const unidad = nombreUnidad.get(c.unidad_id)
    agregar({ clave: `contrato:${c.id}`, tipo: 'residente', ref_id: null, nombre: c.arrendatario_nombre.trim(), detalle: unidad ? `${unidad} · Inquilino` : 'Inquilino' })
  }
  return out.sort(porNombre)
}

/**
 * Proveedores del catálogo compartido (el mismo de Contabilidad y Operaciones)
 * más los contratos de proveedor del condominio cuyo nombre no está en él.
 */
export function candidatosProveedores(
  catalogo: readonly ProveedorCatalogo[],
  contratos: readonly ContratoProveedor[],
): CandidatoParticipante[] {
  const out: CandidatoParticipante[] = []
  const nombres = new Set<string>()
  for (const p of catalogo) {
    if (p.activo === false || p.estado === 'vetado' || !p.nombre?.trim()) continue
    nombres.add(normalizarNombre(p.nombre))
    out.push({ clave: `proveedor:${p.id}`, tipo: 'proveedor', ref_id: p.id, nombre: p.nombre.trim(), detalle: p.contacto_nombre?.trim() || 'Proveedor' })
  }
  for (const c of contratos) {
    if (c.estado === 'terminado' || !c.proveedor_nombre?.trim()) continue
    const n = normalizarNombre(c.proveedor_nombre)
    if (nombres.has(n)) continue
    nombres.add(n)
    out.push({ clave: `contrato_prov:${c.id}`, tipo: 'proveedor', ref_id: null, nombre: c.proveedor_nombre.trim(), detalle: c.proveedor_contacto?.trim() || `Contrato · ${capitalizar(c.servicio)}` })
  }
  return out.sort(porNombre)
}

/** Busca por nombre o detalle sin distinguir acentos ni mayúsculas. */
export function filtrarCandidatos(lista: readonly CandidatoParticipante[], texto: string): CandidatoParticipante[] {
  const t = normalizarNombre(texto)
  if (!t) return [...lista]
  return lista.filter(c => normalizarNombre(c.nombre).includes(t) || normalizarNombre(c.detalle).includes(t))
}

export function participanteDesdeCandidato(c: CandidatoParticipante, gestiona = false): ParticipanteMinuta {
  return { id: nuevoIdMinuta(), tipo: c.tipo, ref_id: c.ref_id, nombre: c.nombre, detalle: c.detalle, gestiona }
}

/** Ya está en la minuta: misma fila de origen o, sin fila, mismo nombre y detalle. */
export function yaParticipa(participantes: readonly ParticipanteMinuta[], c: CandidatoParticipante): boolean {
  return participantes.some(p =>
    p.tipo === c.tipo && (
      (c.ref_id && p.ref_id === c.ref_id) ||
      (normalizarNombre(p.nombre) === normalizarNombre(c.nombre) && normalizarNombre(p.detalle) === normalizarNombre(c.detalle))
    ),
  )
}

/** «Juan Pérez» → «JP»; un solo nombre toma sus dos primeras letras. */
export function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return '?'
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase()
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase()
}

function capitalizar(s: string): string {
  const t = s.replace(/_/g, ' ').trim()
  return t ? t[0].toUpperCase() + t.slice(1) : ''
}

function porNombre(a: { nombre: string }, b: { nombre: string }): number {
  return a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })
}

// ── Acceso a datos ───────────────────────────────────────────────────────────

/** Las firmas que la fila tiene ahora; null si no se pudo leer (el que llama sigue con lo que tiene). */
export async function leerFirmasMinuta(notaId: string): Promise<FirmaMinuta[] | null> {
  const { data, error } = await db.from('notas_admin').select('firmas').eq('id', notaId).maybeSingle()
  if (error || !data) return null
  return firmasDe({ firmas: data.firmas as unknown as FirmaMinuta[] })
}

/**
 * Registra (o reemplaza) la firma de un participante en una minuta ya
 * guardada, desde el detalle. Relee las firmas de la fila justo antes para no
 * pisar la de otro que firmó en otro dispositivo, y exige que el UPDATE haya
 * cambiado la fila. Devuelve la ruta de la firma reemplazada, para borrarla.
 */
export async function registrarFirmaMinuta(notaId: string, firma: FirmaMinuta): Promise<{ error: string | null; reemplazada: string | null }> {
  const { data, error } = await db.from('notas_admin').select('firmas').eq('id', notaId).maybeSingle()
  if (error) return { error: error.message, reemplazada: null }
  if (!data) return { error: 'La minuta ya no existe o no tienes acceso a ella.', reemplazada: null }
  const actuales = firmasDe({ firmas: data.firmas as unknown as FirmaMinuta[] })
  const reemplazada = actuales.find(f => f.participante_id === firma.participante_id)?.path ?? null
  const { data: filas, error: upErr } = await db.from('notas_admin')
    .update({ firmas: conFirma(actuales, firma) as unknown as Json })
    .eq('id', notaId)
    .select('id')
  if (upErr) return { error: upErr.message, reemplazada: null }
  if (!filas || filas.length === 0) return { error: 'No se pudo guardar la firma: no tienes permiso para editar esta minuta.', reemplazada: null }
  return { error: null, reemplazada: reemplazada !== firma.path ? reemplazada : null }
}

/** Residentes activos de las unidades del proyecto, con su nombre y unidad. Degrada a `[]`. */
export async function fetchResidentesProyecto(projectId: string): Promise<ResidenteProyecto[]> {
  const { data, error } = await db
    .from('unidad_residentes')
    .select('id, unidad_id, cliente_id, tipo, clientes!unidad_residentes_cliente_id_fkey(nombre), unidades(nombre)')
    .eq('project_id', projectId)
    .eq('activo', true)
  reportDegradedQuery('condominios.fetchResidentesProyecto', error)
  return (data ?? []).map(r => ({
    id: r.id,
    unidad_id: r.unidad_id,
    cliente_id: r.cliente_id,
    tipo: r.tipo as TipoResidente,
    nombre: r.clientes?.nombre ?? '',
    unidad_nombre: r.unidades?.nombre ?? null,
  }))
}
