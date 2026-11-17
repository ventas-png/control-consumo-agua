import type { Proyecto } from '../types'

/**
 * Proyecto que se propone como destino de una importación: el filtrado en la
 * pantalla si existe, o el único proyecto. Con varios y sin filtro no se
 * adivina: antes se tomaba el primero de la empresa y los datos caían en el
 * proyecto equivocado.
 */
export function proyectoDestinoInicial(proyectos: Pick<Proyecto, 'id'>[], proyectoInicial?: string): string {
  if (proyectoInicial && proyectos.some(p => p.id === proyectoInicial)) return proyectoInicial
  return proyectos.length === 1 ? proyectos[0].id : ''
}
