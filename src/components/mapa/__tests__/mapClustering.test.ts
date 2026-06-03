import { describe, it, expect } from 'vitest'
import { clusterByGrid, type PixelPoint } from '../mapClustering'

describe('clusterByGrid (serv:S14)', () => {
  it('puntos en la misma celda → un cluster', () => {
    const pts: PixelPoint[] = [
      { id: 'a', x: 10, y: 10 },
      { id: 'b', x: 40, y: 30 }, // misma celda de 60px que 'a'
    ]
    const clusters = clusterByGrid(pts, 60)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].ids.sort()).toEqual(['a', 'b'])
  })

  it('puntos en celdas distintas → clusters separados', () => {
    const pts: PixelPoint[] = [
      { id: 'a', x: 10, y: 10 },
      { id: 'b', x: 200, y: 10 },
      { id: 'c', x: 10, y: 200 },
    ]
    const clusters = clusterByGrid(pts, 60)
    expect(clusters).toHaveLength(3)
  })

  it('agrupa muchos puntos cercanos y deja lejano aparte', () => {
    const pts: PixelPoint[] = [
      { id: '1', x: 0, y: 0 },
      { id: '2', x: 5, y: 5 },
      { id: '3', x: 59, y: 59 },
      { id: '4', x: 1000, y: 1000 },
    ]
    const clusters = clusterByGrid(pts, 60)
    expect(clusters).toHaveLength(2)
    const big = clusters.find(c => c.ids.length === 3)
    expect(big?.ids.sort()).toEqual(['1', '2', '3'])
  })

  it('lista vacía → sin clusters', () => {
    expect(clusterByGrid([], 60)).toEqual([])
  })

  it('cellSize ≤ 0 → cada punto es su propio cluster (sin agrupar)', () => {
    const pts: PixelPoint[] = [{ id: 'a', x: 1, y: 1 }, { id: 'b', x: 1, y: 1 }]
    expect(clusterByGrid(pts, 0)).toHaveLength(2)
  })

  it('preserva todos los ids exactamente una vez', () => {
    const pts: PixelPoint[] = Array.from({ length: 20 }, (_, i) => ({ id: String(i), x: i * 7, y: i * 3 }))
    const ids = clusterByGrid(pts, 50).flatMap(c => c.ids).sort((a, b) => Number(a) - Number(b))
    expect(ids).toEqual(pts.map(p => p.id))
  })
})
