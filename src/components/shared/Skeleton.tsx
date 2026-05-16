import { type CSSProperties } from 'react'
import './shared.css'

interface Props {
  /** Ancho del skeleton (CSS value: number → px, string como '60%' tal cual). */
  width?: number | string
  /** Alto. Default 14px. */
  height?: number | string
  /** Border radius. Default 6px. */
  radius?: number | string
  /** Usar la variante para fondos oscuros (KPI cards de color). */
  onDark?: boolean
  /** Sobreescritura de estilos (margin, display, etc.). */
  style?: CSSProperties
  /** Si necesitas un className adicional. */
  className?: string
}

/**
 * Skeleton placeholder con shimmer.
 *
 *   <Skeleton width={120} />               línea de 120px de ancho, altura default
 *   <Skeleton width="60%" height={24} />   60% del padre, 24px de alto
 *   <Skeleton onDark width={80} />         para usar sobre fondos oscuros
 */
export function Skeleton({ width, height = 14, radius = 6, onDark = false, style, className }: Props) {
  const w = typeof width === 'number' ? `${width}px` : width
  const h = typeof height === 'number' ? `${height}px` : height
  const r = typeof radius === 'number' ? `${radius}px` : radius
  const baseClass = onDark ? 'shared-skeleton--on-dark' : 'shared-skeleton'
  return (
    <div
      className={className ? `${baseClass} ${className}` : baseClass}
      style={{ width: w, height: h, borderRadius: r, ...style }}
    />
  )
}
