import { useState, useEffect } from 'react'

// TTL del flag `offline_mode` en localStorage: 24h.
// Si el usuario quedó marcado offline manualmente (sin que el browser detecte
// reconexión), tras este lapso el flag se invalida automáticamente para evitar
// que la app quede atascada en modo offline indefinidamente.
const OFFLINE_FLAG_TTL_MS = 24 * 60 * 60 * 1000

const FLAG_KEY = 'offline_mode'
const FLAG_TS_KEY = 'offline_mode_ts'

// True si el flag offline existe Y aún no expiró. Si expiró, lo limpia.
function isOfflineFlagValid(): boolean {
  const flag = localStorage.getItem(FLAG_KEY)
  if (flag !== 'true') return false
  const ts = Number(localStorage.getItem(FLAG_TS_KEY) ?? '0')
  if (!ts || Date.now() - ts > OFFLINE_FLAG_TTL_MS) {
    localStorage.removeItem(FLAG_KEY)
    localStorage.removeItem(FLAG_TS_KEY)
    return false
  }
  return true
}

function setOfflineFlag(value: boolean): void {
  if (value) {
    localStorage.setItem(FLAG_KEY, 'true')
    localStorage.setItem(FLAG_TS_KEY, String(Date.now()))
  } else {
    localStorage.removeItem(FLAG_KEY)
    localStorage.removeItem(FLAG_TS_KEY)
  }
}

export function useOffline() {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [offlineMode, setOfflineModeState] = useState(
    !navigator.onLine || isOfflineFlagValid()
  )

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      setOfflineFlag(false)
      setOfflineModeState(false)
    }
    const handleOffline = () => {
      setIsOnline(false)
      setOfflineFlag(true)
      setOfflineModeState(true)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  // Permite al usuario salir explícitamente de modo offline (p. ej. desde un
  // botón "Reintentar / Volver online"), aunque navigator.onLine reporte false.
  // Útil si el navegador detectó offline transitorio que ya no aplica.
  function clearOfflineMode(): void {
    setOfflineFlag(false)
    setOfflineModeState(false)
  }

  return { isOnline, offlineMode, clearOfflineMode }
}
