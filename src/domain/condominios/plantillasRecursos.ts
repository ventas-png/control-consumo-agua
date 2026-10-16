// domain/condominios/plantillasRecursos.ts — recursos EN BLOQUE del catálogo de actividades:
// agregar o quitar insumos, herramientas y equipo a varias actividades a la vez.
//
// La escritura la hace el servidor (`plantillas_recursos_en_bloque`, 20261031000200), de forma
// atómica, bajo la RLS de las puentes y con el mismo permiso que editar una actividad en
// pantalla. Aquí solo se arma la llamada y se traduce la respuesta.
import { supabase } from '../../lib/supabase'
import type { ResultadoRecursosBloque } from '../../types'

export type AccionBloque = 'agregar' | 'quitar'

export interface RecursosBloque {
  /** Insumos (suministros_condominio): cantidad decimal > 0 (vacía = 1). */
  suministros: { id: string; cantidad?: number }[]
  /** Herramientas y equipo (inventario_condominio): cantidad entera > 0 (vacía = 1). */
  inventario: { id: string; cantidad?: number; obligatoria?: boolean }[]
}

export const MAX_ACTIVIDADES_BLOQUE = 200
export const MAX_RECURSOS_BLOQUE = 50

export async function aplicarRecursosEnBloque(
  projectId: string,
  plantillaIds: string[],
  accion: AccionBloque,
  recursos: RecursosBloque,
): Promise<ResultadoRecursosBloque> {
  const { data, error } = await supabase.rpc('plantillas_recursos_en_bloque', {
    p_project_id: projectId,
    p_plantilla_ids: plantillaIds,
    p_accion: accion,
    p_suministros: recursos.suministros.map((s) => ({ id: s.id, cantidad: s.cantidad ?? 1 })),
    p_inventario: recursos.inventario.map((i) => ({ id: i.id, cantidad: i.cantidad ?? 1, obligatoria: i.obligatoria ?? false })),
  })
  if (error) throw new Error(mensajeErrorBloque(error.message))
  return data as ResultadoRecursosBloque
}

/** Los mensajes del servidor llevan un prefijo técnico (PLANTILLAS_BLOQUE_…): se quita para la pantalla. */
export function mensajeErrorBloque(mensaje: string): string {
  return mensaje.replace(/^PLANTILLAS_BLOQUE_[A-Z_]+:\s*/, '')
}

/** Frase corta con los conteos que devolvió el servidor. */
export function resumenBloque(r: ResultadoRecursosBloque): string {
  const act = `${r.plantillas} actividad${r.plantillas === 1 ? '' : 'es'}`
  if (r.accion === 'agregar') {
    return `${r.agregados} vínculo${r.agregados === 1 ? '' : 's'} agregado${r.agregados === 1 ? '' : 's'} en ${act}` +
      (r.ya_estaban > 0 ? ` · ${r.ya_estaban} ya estaba${r.ya_estaban === 1 ? '' : 'n'} (sin cambios)` : '')
  }
  return `${r.quitados} vínculo${r.quitados === 1 ? '' : 's'} quitado${r.quitados === 1 ? '' : 's'} de ${act}` +
    (r.no_estaban > 0 ? ` · ${r.no_estaban} no estaba${r.no_estaban === 1 ? '' : 'n'}` : '')
}

export interface RecursoTexto {
  nombre: string
  /** null = sin cantidad (el servidor asume 1). */
  cantidad: number | null
  obligatoria: boolean
}

/**
 * Parte una celda «Nombre x 3; Otro!; Tercero x 2,5» como lo hace el servidor
 * (`plantillas_import_partir_recursos`): «;» separa, «!» final = obligatoria, « x n» final = cantidad
 * (coma o punto decimal, hasta 2 decimales). Es puro: sirve para la ayuda de la plantilla y las pruebas;
 * el servidor vuelve a partir y resolver por su cuenta.
 */
export function parsearRecursoTexto(celda: string | null | undefined): RecursoTexto[] {
  if (!celda || celda.trim() === '') return []
  const out: RecursoTexto[] = []
  for (const bruto of celda.split(';')) {
    let item = bruto.trim()
    if (item === '') continue
    const obligatoria = /!\s*$/.test(item)
    item = item.replace(/\s*!\s*$/, '').trim()
    const m = item.match(/\s+[xX×]\s*([0-9]+(?:[.,][0-9]{1,2})?)\s*$/)
    let cantidad: number | null = null
    if (m) {
      cantidad = Number(m[1].replace(',', '.'))
      item = item.replace(/\s+[xX×]\s*[0-9]+(?:[.,][0-9]{1,2})?\s*$/, '').trim()
    }
    out.push({ nombre: item, cantidad, obligatoria })
  }
  return out
}
