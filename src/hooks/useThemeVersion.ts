import { useEffect, useState } from 'react'

/**
 * Contador que se incrementa cuando cambia el tema efectivo (toggle manual de
 * `data-theme` en <html> o cambio de `prefers-color-scheme` del SO). Chart.js
 * pinta en canvas, donde los tokens ya resueltos NO se re-evalúan solos: incluir
 * este valor en las deps del useEffect que construye la gráfica fuerza el
 * rebuild con los colores del tema nuevo (mismo patrón que Sparkline).
 */
export function useThemeVersion(): number {
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const bump = () => setVersion(v => v + 1)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', bump)
    const observer = new MutationObserver(bump)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => {
      mq.removeEventListener('change', bump)
      observer.disconnect()
    }
  }, [])

  return version
}
