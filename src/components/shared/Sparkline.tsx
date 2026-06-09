import { useEffect, useRef } from 'react'
import type { ScriptableContext } from 'chart.js'
import { Chart } from '../../lib/chartjs'

// ============================================================================
// Sparkline — mini gráfica de línea sin ejes ni leyenda (tendencia de un KPI).
// ============================================================================
// Usa Chart.js 4 (ya en deps; registro centralizado en src/lib/chartjs.ts).
//
// Canvas y tokens: Chart.js dibuja en <canvas>, donde las CSS custom properties
// y color-mix() NO se resuelven. Por eso el color se resuelve en runtime con
// getComputedStyle (de un token --at-* o un literal) y el relleno se deriva de
// ese color con alpha — equivalente visual a --at-spark-fill pero válido en
// canvas. Se vuelve a resolver al cambiar el tema (data-theme / prefers-color).
// ============================================================================

interface Props {
  /** Serie de valores a graficar (orden cronológico). */
  data: number[]
  /** Nombre de la CSS var para el color de la línea. Default --at-primary-2. */
  colorVar?: string
  /** Color literal (ej. '#FFFFFF' sobre fondos de color) que ignora colorVar. */
  color?: string
  /** Relleno bajo la línea. Default true. */
  fill?: boolean
  height?: number
  width?: number | string
  /** Eje Y fijo — pásalo igual entre sparklines de una misma fila para no
   *  exagerar variaciones con escalas distintas. */
  min?: number
  max?: number
  /** Descripción accesible de la tendencia. */
  ariaLabel?: string
}

/** Convierte un color hex (#rrggbb) o rgb() a rgba() con el alpha dado. */
function withAlpha(color: string, alpha: number): string {
  const hex = color.trim().match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
  }
  const rgb = color.trim().match(/^rgb\(([^)]+)\)$/i)
  if (rgb) return `rgba(${rgb[1]}, ${alpha})`
  return color
}

export function Sparkline({
  data,
  colorVar = '--at-primary-2',
  color,
  fill = true,
  height = 32,
  width = '100%',
  min,
  max,
  ariaLabel,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const chartRef = useRef<Chart | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const resolveColor = (): string => {
      if (color) return color
      const v = getComputedStyle(document.documentElement).getPropertyValue(colorVar).trim()
      return v || '#2F5D4F'
    }

    const build = () => {
      chartRef.current?.destroy()
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const lineColor = resolveColor()
      chartRef.current = new Chart(ctx, {
        type: 'line',
        data: {
          labels: data.map((_, i) => i),
          datasets: [
            {
              data,
              borderColor: lineColor,
              borderWidth: 2,
              fill,
              tension: 0.35,
              pointRadius: 0,
              backgroundColor: (c: ScriptableContext<'line'>): string | CanvasGradient => {
                if (!fill) return 'transparent'
                const { ctx: cx, chartArea } = c.chart
                if (!chartArea) return 'transparent'
                const g = cx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom)
                g.addColorStop(0, withAlpha(lineColor, 0.28))
                g.addColorStop(1, withAlpha(lineColor, 0))
                return g
              },
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: reduceMotion ? false : { duration: 320 },
          plugins: { legend: { display: false }, tooltip: { enabled: false } },
          scales: {
            x: { display: false },
            y: { display: false, min, max },
          },
        },
      })
    }

    build()

    // Re-resolver el color al cambiar el tema (sin desmontar el componente).
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onThemeChange = () => build()
    mq.addEventListener('change', onThemeChange)
    const observer = new MutationObserver(onThemeChange)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    return () => {
      mq.removeEventListener('change', onThemeChange)
      observer.disconnect()
      chartRef.current?.destroy()
      chartRef.current = null
    }
  }, [data, colorVar, color, fill, min, max])

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={ariaLabel ?? 'Tendencia'}
      style={{ display: 'block', width, height }}
    />
  )
}
