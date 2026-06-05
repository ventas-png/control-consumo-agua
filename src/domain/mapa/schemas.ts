// domain/mapa/schemas.ts — Centro/zoom del mapa por tenant (serv:S16).
//
// Tipo canónico + parse defensivo de la config de mapa de una empresa (columnas
// de `companies`). T7/PR3: la migración del acceso a datos del mapa fuera del
// componente. El tipo vive acá (capa de datos); `components/mapa/mapCenter.ts` lo
// re-exporta para sus consumidores.
import { z } from 'zod'

export const mapCenterConfigSchema = z.object({
  center_lat: z.number().nullable().optional(),
  center_lng: z.number().nullable().optional(),
  zoom_default: z.number().nullable().optional(),
})

/** Config de centro/zoom del mapa de una empresa (columnas de `companies`). */
export type MapCenterConfig = z.infer<typeof mapCenterConfigSchema>

/**
 * Parse defensivo de la fila de `companies`: fila válida → config; ausente o
 * malformada (p. ej. columnas aún no migradas) → `null`, para degradar al centro
 * por defecto de la app sin romper el mapa.
 */
export function parseMapCenter(row: unknown): MapCenterConfig | null {
  if (row == null) return null
  const r = mapCenterConfigSchema.safeParse(row)
  return r.success ? r.data : null
}
