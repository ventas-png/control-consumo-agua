import { useEffect, useMemo, useState } from 'react'
import { fetchClientesConCumple } from './sectionData'
import type { Unidad } from '../../types'

// ============================================================================
// Cumpleaños de residentes — carga AISLADA del batch pesado de CondominiosSection.
// ============================================================================
// Antes vivía dentro de `cargarDatos`, el callback que dispara ~90 consultas en
// varios batches. Eso dejaba dos malas opciones y ninguna buena:
//
//   - declarar `unidades` en las deps de `cargarDatos` → cada cambio de la
//     colección relanzaba el batch entero;
//   - leerla de un ref → el aviso de ESLint desaparece, pero actualizar el ref
//     NO vuelve a ejecutar la consulta: si las unidades llegaban (o cambiaban)
//     después de la carga, el calendario se quedaba con los clientes viejos.
//
// La salida es separar responsabilidades: esta consulta depende de las unidades
// del proyecto y de nada más, así que vive en su propio hook y reacciona a ellas
// sola, con cancelación para descartar respuestas atrasadas. El batch grande
// sigue sin conocer `unidades`.

export interface ClienteCumple {
  id: string
  nombre: string
  fecha_nacimiento: string
  unidad_nombre?: string
}

/** Fila cruda de `clientes` con fecha de nacimiento. */
export interface ClienteCumpleRow {
  id: string
  nombre: string
  fecha_nacimiento: string | null
}

/** Unidades que pertenecen al proyecto. Pura — el criterio en un solo sitio. */
export function unidadesDelProyecto(unidades: Unidad[], proyectoId: string): Unidad[] {
  if (!proyectoId) return []
  return unidades.filter(u => u.project_id === proyectoId)
}

/** Ids de cliente presentes en esas unidades, sin repetir. Pura. */
export function clienteIdsDeUnidades(unidadesProyecto: Unidad[]): string[] {
  return [...new Set(
    unidadesProyecto.filter(u => u.cliente_id).map(u => u.cliente_id as string),
  )]
}

/** Empareja cada cliente con el nombre de su unidad. Pura. */
export function mapClientesCumple(
  filas: ClienteCumpleRow[],
  unidadesProyecto: Unidad[],
): ClienteCumple[] {
  return filas
    .filter(c => c.fecha_nacimiento)
    .map(c => ({
      id: c.id,
      nombre: c.nombre,
      fecha_nacimiento: c.fecha_nacimiento as string,
      unidad_nombre: unidadesProyecto.find(u => u.cliente_id === c.id)?.nombre,
    }))
}

/**
 * Clientes con cumpleaños de las unidades del proyecto. Se recarga cuando cambia
 * el proyecto o la colección de unidades, y solo entonces.
 */
export function useClientesCumple(unidades: Unidad[], proyectoId: string): ClienteCumple[] {
  const [clientes, setClientes] = useState<ClienteCumple[]>([])

  // `unidades` llega memoizada desde useAguaData, así que este derivado solo
  // cambia de identidad cuando cambian de verdad las unidades o el proyecto:
  // sirve como dependencia real del efecto, sin claves sintéticas.
  const unidadesProyecto = useMemo(
    () => unidadesDelProyecto(unidades, proyectoId),
    [unidades, proyectoId],
  )

  useEffect(() => {
    const clienteIds = clienteIdsDeUnidades(unidadesProyecto)
    // Sin unidades con cliente no hay consulta — y se limpia, para no dejar en
    // pantalla el calendario del proyecto anterior.
    if (clienteIds.length === 0) {
      setClientes([])
      return
    }

    let cancelado = false
    void fetchClientesConCumple(clienteIds).then(({ data }) => {
      if (cancelado) return
      setClientes(mapClientesCumple((data ?? []) as ClienteCumpleRow[], unidadesProyecto))
    })
    return () => { cancelado = true }
  }, [unidadesProyecto])

  return clientes
}
