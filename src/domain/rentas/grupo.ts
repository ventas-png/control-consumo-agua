// Personas del grupo de una reserva de propiedad ENLAZADA: son las mismas
// filas `huespedes_str` que usa la pestaña STR de Condominios (control de
// ingreso incluido). Las reservas de propiedades independientes no llevan grupo.
import {
  createCondominioRow, deleteCondominioRowsByIds, updateCondominioRow,
} from '../condominios/tabMutations'
import { fetchHuespedesByReservas } from '../condominios/tabQueries'
import type { HuespedSTR } from '../../types'

export interface PersonaGrupo {
  id?: string
  nombre: string
  identificacion: string
  es_menor: boolean
  fecha_nacimiento: string
  foto_url: string | null
  foto_documento_url: string | null
  /** Ya registró su ingreso en garita: no se edita ni se quita. */
  visitante_id?: string | null
}

export const personaVacia = (): PersonaGrupo => ({
  nombre: '', identificacion: '', es_menor: false, fecha_nacimiento: '', foto_url: null, foto_documento_url: null,
})

export async function cargarGrupo(reservaStrId: string): Promise<PersonaGrupo[]> {
  const filas = await fetchHuespedesByReservas<HuespedSTR>([reservaStrId])
  return filas.map(h => ({
    id: h.id, nombre: h.nombre, identificacion: h.identificacion ?? '', es_menor: h.es_menor,
    fecha_nacimiento: h.fecha_nacimiento ?? '', foto_url: h.foto_url ?? null,
    foto_documento_url: h.foto_documento_url ?? null, visitante_id: h.visitante_id,
  }))
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
export async function guardarGrupo(reservaStrId: string, antes: PersonaGrupo[], ahora: PersonaGrupo[]): Promise<void> {
  const exigir = ({ error }: { error: { message: string } | null }) => { if (error) throw new Error(error.message) }
  const quedan = new Set(ahora.filter(h => h.id).map(h => h.id as string))
  exigir(await deleteCondominioRowsByIds('huespedes_str',
    antes.filter(h => h.id && !h.visitante_id && !quedan.has(h.id)).map(h => h.id as string)))
  for (const h of ahora.filter(g => g.id && !g.visitante_id)) {
    exigir(await updateCondominioRow('huespedes_str', h.id as string, columnas(h)))
  }
  const nuevas = ahora.filter(h => !h.id && h.nombre.trim())
  if (nuevas.length > 0) {
    exigir(await createCondominioRow('huespedes_str', nuevas.map(h => ({ reserva_str_id: reservaStrId, ...columnas(h) }))))
  }
}
