// serv:S14 — Clustering de pines por grilla de píxeles (sin dependencias extra).
//
// La parte pura y testeable: dado un conjunto de puntos ya proyectados a píxeles
// (en el espacio del zoom actual), agrúpalos por celdas de `cellSize` px. El
// <MapView> proyecta lat/lng → píxeles con map.project() y re-agrupa en cada
// zoom. Markers que caen en la misma celda forman un cluster.

export interface PixelPoint {
  id: string
  x: number
  y: number
}

export interface PointCluster {
  ids: string[]
}

/**
 * Agrupa puntos por celdas de una grilla de `cellSize` píxeles. El orden de los
 * clusters sigue el de primera aparición de cada celda (determinista).
 */
export function clusterByGrid(points: PixelPoint[], cellSize: number): PointCluster[] {
  if (cellSize <= 0) return points.map(p => ({ ids: [p.id] }))
  const cells = new Map<string, string[]>()
  for (const p of points) {
    const key = `${Math.floor(p.x / cellSize)}:${Math.floor(p.y / cellSize)}`
    const arr = cells.get(key)
    if (arr) arr.push(p.id)
    else cells.set(key, [p.id])
  }
  return Array.from(cells.values(), ids => ({ ids }))
}
