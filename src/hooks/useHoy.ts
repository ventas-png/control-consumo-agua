import { useEffect, useState } from 'react'
import { hoyLocalISO } from '../lib/format'

// ============================================================================
// useHoy — "hoy" como valor REACTIVO al cambio de día.
// ============================================================================
// El patrón que reemplaza es uno de dos, y los dos están mal:
//
//   const hoy = new Date()                        // identidad nueva en CADA
//       render: cualquier useMemo/useEffect que lo declare como dependencia se
//       recalcula siempre (memoización inútil) — y si no lo declara, lee un
//       valor viejo (closure obsoleto). Es justo el dilema que dispara
//       react-hooks/exhaustive-deps en CumpleanosTab, VencimientosCriticosTab,
//       MultiCondominioTab y VisitantesTab.
//
//   const hoy = useMemo(() => hoyLocalISO(), [])  // estable, pero CONGELADO:
//       una pantalla abierta toda la noche sigue diciendo la fecha de ayer.
//
// Este hook da las dos propiedades a la vez: identidad estable DENTRO del día
// (así sirve como dependencia real) y actualización exactamente al cruzar la
// medianoche LOCAL. El temporizador se reprograma solo y devuelve cleanup.

export interface Hoy {
  /** Hoy LOCAL como 'YYYY-MM-DD'. */
  hoyISO: string
  /**
   * `new Date()` capturado al entrar en este día. Mantiene la semántica de
   * "instante actual" que ya usaban los cálculos de días restantes; lo único
   * que cambia es que deja de ser un objeto nuevo por render.
   */
  ahora: Date
}

function snapshot(): Hoy {
  return { hoyISO: hoyLocalISO(), ahora: new Date() }
}

/** Snapshot del día actual, con identidad estable hasta la medianoche local. */
export function useHoy(): Hoy {
  const [hoy, setHoy] = useState(snapshot)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let cancelado = false

    const programar = () => {
      const ahora = new Date()
      // Medianoche LOCAL del día siguiente. No vale el cambio de día UTC: en
      // husos negativos (todo LATAM) ocurre a media tarde local.
      const proximo = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + 1)
      const espera = Math.max(1000, proximo.getTime() - ahora.getTime())
      timer = setTimeout(() => {
        if (cancelado) return
        // Actualización funcional: si el día no cambió de verdad (temporizador
        // que dispara un pelo antes) no se re-renderiza a nadie, y la
        // identidad del snapshot se conserva.
        setHoy(prev => (prev.hoyISO === hoyLocalISO() ? prev : snapshot()))
        programar()
      }, espera)
    }

    programar()
    return () => {
      cancelado = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [])

  return hoy
}

/** Hoy LOCAL como 'YYYY-MM-DD'; cambia solo al cruzar la medianoche local. */
export function useHoyLocalISO(): string {
  return useHoy().hoyISO
}

/** "Ahora" como `Date` estable dentro del día (ver `Hoy.ahora`). */
export function useHoyDate(): Date {
  return useHoy().ahora
}
