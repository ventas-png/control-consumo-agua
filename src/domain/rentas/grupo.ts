// Personas del grupo de una reserva. Dos destinos detrás de la misma pantalla:
//   · propiedad ENLAZADA   → `huespedes_str`, las mismas filas de la pestaña STR
//     de Condominios (control de ingreso incluido);
//   · propiedad INDEPENDIENTE → `rentas_huespedes` (20261207000000).
import {
  createCondominioRow, deleteCondominioRowsByIds, updateCondominioRow,
} from '../condominios/tabMutations'
import { fetchHuespedesByReservas } from '../condominios/tabQueries'
import { BUCKET_RENTAS_HUESPEDES } from '../shared/buckets'
import { removeMedia } from '../shared/storage'
import { supabase } from '../../lib/supabase'
import type { HuespedSTR, PropiedadRenta, ReservaUnificada } from '../../types'

export interface PersonaGrupo {
  id?: string
  nombre: string
  identificacion: string
  es_menor: boolean
  fecha_nacimiento: string
  foto_url: string | null
  foto_documento_url: string | null
  /** Sólo en condominios: ya registró su ingreso en garita; no se edita ni se quita. */
  visitante_id?: string | null
}

type Ref = Pick<ReservaUnificada, 'id' | 'origen'>
type FilaGrupo = Pick<HuespedSTR, 'id' | 'nombre' | 'es_menor'> & {
  identificacion?: string | null; fecha_nacimiento?: string | null
  foto_url?: string | null; foto_documento_url?: string | null; visitante_id?: string | null
}

export const personaVacia = (): PersonaGrupo => ({
  nombre: '', identificacion: '', es_menor: false, fecha_nacimiento: '', foto_url: null, foto_documento_url: null,
})

const aPersona = (h: FilaGrupo): PersonaGrupo => ({
  id: h.id, nombre: h.nombre, identificacion: h.identificacion ?? '', es_menor: h.es_menor,
  fecha_nacimiento: h.fecha_nacimiento ?? '', foto_url: h.foto_url ?? null,
  foto_documento_url: h.foto_documento_url ?? null, visitante_id: h.visitante_id ?? null,
})

export async function cargarGrupo(reserva: Ref): Promise<PersonaGrupo[]> {
  if (reserva.origen === 'condominio') {
    return (await fetchHuespedesByReservas<HuespedSTR>([reserva.id])).map(aPersona)
  }
  const { data, error } = await supabase.from('rentas_huespedes').select('*').eq('reserva_id', reserva.id).order('created_at')
  if (error) throw new Error(error.message)
  return (data ?? []).map(aPersona)
}

const columnas = (h: PersonaGrupo) => ({
  nombre: h.nombre.trim(),
  identificacion: h.identificacion.trim() || null,
  es_menor: h.es_menor,
  fecha_nacimiento: h.es_menor && h.fecha_nacimiento ? h.fecha_nacimiento : null,
  foto_url: h.foto_url,
  foto_documento_url: h.foto_documento_url,
})

/**
 * Deja el grupo de la reserva como está en el formulario: borra las que se
 * quitaron, actualiza las que ya existían y crea las nuevas. Quien ya ingresó
 * (`visitante_id`) no se toca. Lanza si la base rechaza algún paso.
 */
export async function guardarGrupo(
  reserva: Ref, propiedad: Pick<PropiedadRenta, 'id' | 'company_id'>, antes: PersonaGrupo[], ahora: PersonaGrupo[],
): Promise<void> {
  const exigir = ({ error }: { error: { message: string } | null }) => { if (error) throw new Error(error.message) }
  const tabla = reserva.origen === 'condominio' ? 'huespedes_str' : 'rentas_huespedes'
  const ancla = reserva.origen === 'condominio'
    ? { reserva_str_id: reserva.id }
    : { reserva_id: reserva.id, propiedad_id: propiedad.id, company_id: propiedad.company_id }
  const quedan = new Set(ahora.filter(h => h.id).map(h => h.id as string))
  exigir(await deleteCondominioRowsByIds(tabla,
    antes.filter(h => h.id && !h.visitante_id && !quedan.has(h.id)).map(h => h.id as string)))
  for (const h of ahora.filter(g => g.id && !g.visitante_id)) {
    exigir(await updateCondominioRow(tabla, h.id as string, columnas(h)))
  }
  const nuevas = ahora.filter(h => !h.id && h.nombre.trim())
  if (nuevas.length > 0) exigir(await createCondominioRow(tabla, nuevas.map(h => ({ ...ancla, ...columnas(h) }))))
}

/** Rutas de fotos que aparecen en un formulario de reserva (principal + grupo). */
export function fotosDe(principal: { foto_url: string | null; foto_documento_url: string | null }, grupo: PersonaGrupo[]): string[] {
  return [principal, ...grupo].flatMap(x => [x.foto_url, x.foto_documento_url]).filter((r): r is string => !!r)
}

/**
 * Retira del bucket de Rentas las fotos que ya no nombra ninguna fila. Va
 * DESPUÉS de guardar: la policy niega borrar lo que una reserva o una persona
 * todavía nombra, así que un intento de más no rompe nada. Sin esperar respuesta.
 */
export function retirarFotosHuespedes(rutas: readonly string[]): void {
  if (rutas.length > 0) void removeMedia(BUCKET_RENTAS_HUESPEDES, [...rutas])
}
