// domain/condominios/objetosPerdidos.ts — Objetos perdidos (20261119000000):
// dónde y quién lo encontró, custodia y entrega al propietario con firma.
//
// Los nombres del personal (quién lo encontró, custodio) los pone el trigger
// desde la ficha: el cliente manda el id y nada más. La entrega sube la firma
// ANTES de pasar a 'reclamado', porque el trigger exige que el objeto exista en
// el bucket; una firma subida sin entrega posterior queda huérfana y no prueba
// nada, el caso contrario —una entrega que afirma una firma que no está— es el
// que no puede pasar. La hora, quién entregó y su nombre los sella el servidor.
import { buildUploadPath, validateFileMagic } from '../../lib/fileValidation'
import { uploadCondominiosMedia } from '../shared/storage'
import { updateCondominioRowAfectando } from './tabMutations'
import { vinculoArea } from './areas'
import { etiquetaCargo } from './rrhhCatalogos'
import type { AreaCondominio, CargoCatalogo, ObjetoPerdido, PersonalCondominio, TipoHallazgoObjeto } from '../../types'

/** Carpeta de las fotos del objeto en condominios-media (`<project_id>/objetos-perdidos/…`). */
export const CARPETA_FOTOS_OBJETO = 'objetos-perdidos'
/** Tope de fotos por objeto (CHECK objetos_fotos_max). */
export const MAX_FOTOS_OBJETO = 6

export interface FormObjeto {
  descripcion: string
  fotos: string[]
  area_encontrado_id: string
  fecha_encontrado: string
  encontrado_por_tipo: TipoHallazgoObjeto
  encontrado_por_personal_id: string
  /** Sólo para un tercero: el nombre del personal lo pone el servidor. */
  encontrado_por_nombre: string
  encontrado_por_contacto: string
  custodio_personal_id: string
  area_almacenamiento_id: string
  almacenamiento_detalle: string
  notas: string
}

export type ErrorFormObjeto = 'descripcion' | 'encontrado_personal' | 'encontrado_tercero'

/** Lo que falta para guardar, o null. */
export function validarFormObjeto(f: FormObjeto): ErrorFormObjeto | null {
  if (!f.descripcion.trim()) return 'descripcion'
  if (f.encontrado_por_tipo === 'personal' && !f.encontrado_por_personal_id) return 'encontrado_personal'
  if (f.encontrado_por_tipo === 'tercero' && !f.encontrado_por_nombre.trim()) return 'encontrado_tercero'
  return null
}

/** Empleados que se pueden elegir: los activos, por nombre (mismo criterio que Libro de novedades). */
export function personalElegible(personal: readonly PersonalCondominio[]): PersonalCondominio[] {
  return personal.filter(p => p.estado !== 'inactivo').sort((a, b) => a.nombre.localeCompare(b.nombre))
}

/** «Ana López — Guardia»: el empleado con su cargo, para los selects. */
export function etiquetaEmpleado(p: PersonalCondominio, cargos: readonly CargoCatalogo[] = []): string {
  return p.cargo ? `${p.nombre} — ${etiquetaCargo(p.cargo, cargos)}` : p.nombre
}

/** La ficha activa del usuario conectado, si la tiene: se propone como quien encontró y custodio. */
export function fichaDeUsuario(userId: string | null | undefined, personal: readonly PersonalCondominio[]): PersonalCondominio | null {
  if (!userId) return null
  return personal.find(p => p.user_id === userId && p.estado !== 'inactivo') ?? null
}

/** Formulario a partir de un registro (para editar). Lo legado sin «quién» se abre como tercero vacío. */
export function formDesdeObjeto(o: ObjetoPerdido): FormObjeto {
  return {
    descripcion: o.descripcion,
    fotos: o.fotos ?? [],
    area_encontrado_id: o.area_encontrado_id ?? '',
    fecha_encontrado: o.fecha_encontrado,
    encontrado_por_tipo: o.encontrado_por_tipo ?? (o.encontrado_por_personal_id ? 'personal' : 'tercero'),
    encontrado_por_personal_id: o.encontrado_por_personal_id ?? '',
    encontrado_por_nombre: o.encontrado_por_tipo === 'tercero' ? (o.encontrado_por_nombre ?? '') : '',
    encontrado_por_contacto: o.encontrado_por_contacto ?? '',
    custodio_personal_id: o.custodio_personal_id ?? '',
    area_almacenamiento_id: o.area_almacenamiento_id ?? '',
    almacenamiento_detalle: o.almacenamiento_detalle ?? '',
    notas: o.notas ?? '',
  }
}

/**
 * Columnas a guardar (sin company/project ni estado: los pone quien llama).
 * `previo` es el registro que se edita: su lugar legado se conserva mientras
 * nadie elija un área (vinculoArea) y el nombre de su custodio sólo se borra
 * si se le quita la custodia en el formulario.
 */
export function payloadObjeto(f: FormObjeto, areas: AreaCondominio[], previo?: ObjetoPerdido): Record<string, unknown> {
  const lugar = vinculoArea(f.area_encontrado_id, areas, previo ? { area_id: previo.area_encontrado_id, texto: previo.lugar_encontrado } : undefined)
  const almacen = vinculoArea(f.area_almacenamiento_id, areas)
  const tercero = f.encontrado_por_tipo === 'tercero'
  const payload: Record<string, unknown> = {
    descripcion: f.descripcion.trim(),
    fotos: f.fotos,
    area_encontrado_id: lugar.area_id,
    lugar_encontrado: lugar.nombre,
    fecha_encontrado: f.fecha_encontrado,
    encontrado_por_tipo: f.encontrado_por_tipo,
    encontrado_por_personal_id: tercero ? null : f.encontrado_por_personal_id || null,
    encontrado_por_contacto: tercero ? f.encontrado_por_contacto.trim() || null : null,
    custodio_personal_id: f.custodio_personal_id || null,
    area_almacenamiento_id: almacen.area_id,
    almacenamiento_detalle: f.almacenamiento_detalle.trim() || null,
    notas: f.notas.trim() || null,
  }
  if (tercero) payload.encontrado_por_nombre = f.encontrado_por_nombre.trim()
  if (previo?.custodio_personal_id && !f.custodio_personal_id) payload.custodio_nombre = null
  return payload
}

/** Quién lo encontró, para mostrar; null en lo legado que no lo dice. */
export function hallazgoDe(o: ObjetoPerdido): { nombre: string; tercero: boolean; contacto: string | null } | null {
  const nombre = o.encontrado_por_nombre?.trim()
  if (!o.encontrado_por_tipo || !nombre) return null
  return { nombre, tercero: o.encontrado_por_tipo === 'tercero', contacto: o.encontrado_por_contacto?.trim() || null }
}

/** Todas las fotos del objeto: las nuevas y, si la hay, la única del esquema viejo. */
export function fotosDe(o: ObjetoPerdido): string[] {
  const fotos = o.fotos ?? []
  return o.foto_url && !fotos.includes(o.foto_url) ? [o.foto_url, ...fotos] : fotos
}

/** El comprobante PDF existe para las entregas firmadas (las legadas no tienen firma que mostrar). */
export const tieneComprobante = (o: ObjetoPerdido) => o.estado === 'reclamado' && !!o.firma_entrega_path

/** «Entrega-Llaves_con_llavero_rojo-2026-10-30.pdf»: sin acentos ni signos. */
export const nombrePdfEntrega = (o: Pick<ObjetoPerdido, 'descripcion' | 'fecha_reclamo' | 'entregado_en'>) =>
  `Entrega-${o.descripcion.trim().slice(0, 40)}-${o.fecha_reclamo ?? o.entregado_en?.slice(0, 10) ?? ''}.pdf`
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '_')

/** Nombre de quien recibe: sin espacios sobrantes y al menos nombre y apellido. */
export function nombreReceptorValido(nombre: string): boolean {
  return nombre.trim().split(/\s+/).filter(p => p.length >= 2).length >= 2
}

/**
 * Entrega al propietario: sube la firma bajo `<project_id>/objetos-perdidos/firmas/`
 * (la ruta que el trigger comprueba) y pasa el objeto a 'reclamado'. Exige que
 * la fila se haya actualizado: sin permiso de edición la RLS no da error, sólo
 * no toca nada, y la pantalla anunciaría una entrega que no ocurrió.
 */
export async function entregarObjeto(
  objeto: Pick<ObjetoPerdido, 'id' | 'project_id'>,
  datos: { recibe: string; documento: string; fecha: string; firma: File },
): Promise<{ error: string | null }> {
  const magic = await validateFileMagic(datos.firma, 'image')
  if (!magic.ok) return { error: magic.reason }
  const path = buildUploadPath(`${objeto.project_id}/${CARPETA_FOTOS_OBJETO}/firmas`, 'firma.png', 'png')
  const { error: upErr } = await uploadCondominiosMedia(path, datos.firma, { contentType: 'image/png', upsert: false })
  if (upErr) return { error: upErr }
  const { error } = await updateCondominioRowAfectando('objetos_perdidos', objeto.id, {
    estado: 'reclamado',
    reclamado_por: datos.recibe.trim(),
    entrega_documento: datos.documento.trim() || null,
    fecha_reclamo: datos.fecha,
    firma_entrega_path: path,
  })
  return { error: error?.message ?? null }
}
