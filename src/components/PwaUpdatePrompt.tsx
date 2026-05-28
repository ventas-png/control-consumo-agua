import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

// Aviso toast cuando el SW detecta una nueva version de la app.
//
// En lugar de hacer "skip waiting" automatico (que cortaria una sesion activa
// mid-action), mostramos un toast no intrusivo y dejamos que el usuario decida
// cuando aplicar. registerType: 'autoUpdate' del plugin garantiza que la
// proxima recarga ya use la nueva version aunque el usuario ignore el toast.
//
// `onOfflineReady` se dispara la primera vez que el SW termina de precachear
// el app shell — util para confirmar visualmente al usuario que la app ahora
// funciona offline.
export function PwaUpdatePrompt() {
  const [showOfflineToast, setShowOfflineToast] = useState(false)
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.error('[PWA] SW registration error:', error)
    },
  })

  useEffect(() => {
    if (offlineReady) {
      setShowOfflineToast(true)
      const id = window.setTimeout(() => {
        setShowOfflineToast(false)
        setOfflineReady(false)
      }, 4000)
      return () => window.clearTimeout(id)
    }
    return undefined
  }, [offlineReady, setOfflineReady])

  if (!needRefresh && !showOfflineToast) return null

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        right: '16px',
        bottom: '16px',
        zIndex: 9999,
        background: 'var(--at-surface)',
        border: '1px solid var(--at-line)',
        borderLeft: needRefresh ? '4px solid var(--at-primary)' : '4px solid var(--at-success)',
        borderRadius: '12px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
        padding: '14px 18px',
        maxWidth: '320px',
        fontSize: '14px',
        color: 'var(--at-ink)',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      }}
    >
      {needRefresh ? (
        <>
          <div style={{ fontWeight: 700 }}>Nueva versión disponible</div>
          <div style={{ color: 'var(--at-ink-2)', fontSize: '13px', lineHeight: 1.4 }}>
            Recarga para aplicar las últimas mejoras y correcciones.
          </div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => setNeedRefresh(false)}
              style={{
                background: 'none', border: 'none', color: 'var(--at-ink-3)',
                cursor: 'pointer', fontSize: '13px', padding: '6px 10px',
              }}
            >
              Después
            </button>
            <button
              type="button"
              onClick={() => updateServiceWorker(true)}
              style={{
                background: 'var(--at-primary)', color: 'white', border: 'none',
                borderRadius: '8px', padding: '6px 14px', fontSize: '13px',
                fontWeight: 600, cursor: 'pointer',
              }}
            >
              Recargar
            </button>
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px' }}>✓</span>
          <div>
            <div style={{ fontWeight: 700 }}>Listo para usar sin conexión</div>
            <div style={{ color: 'var(--at-ink-2)', fontSize: '12px', marginTop: '2px' }}>
              La app funcionará aunque pierdas internet.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
