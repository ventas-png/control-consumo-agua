import { useState, useEffect } from 'react'

export function useOffline() {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [offlineMode, setOfflineMode] = useState(
    !navigator.onLine || localStorage.getItem('offline_mode') === 'true'
  )

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      localStorage.removeItem('offline_mode')
      setOfflineMode(false)
    }
    const handleOffline = () => {
      setIsOnline(false)
      localStorage.setItem('offline_mode', 'true')
      setOfflineMode(true)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return { isOnline, offlineMode }
}
