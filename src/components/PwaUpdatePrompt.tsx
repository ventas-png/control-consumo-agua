import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { sectionToPath } from '../lib/routes'
import { localStorageRutaEnCurso, leerRutaEnCurso } from '../lib/rutaEnCurso'

// Qué pasa cuando el SW detecta una versión nueva de la app.
//
// El plugin está en registerType: 'autoUpdate' (vite.config.ts): el SW nuevo
// toma el control solo y, por defecto, el cliente hace `location.reload()` en
// el acto. Para casi toda la app eso está bien —los cambios llegan rápido—,
// pero al lecturista lo cortaba A MEDIA CAPTURA: cada despliegue recargaba la
// pantalla de Nueva Lectura, se perdía lo tecleado y la ruta volvía a la
// parada 1.
//
// Ahora la recarga automática se APLAZA mientras haya trabajo de campo en
// curso (pantalla de Nueva Lectura abierta o una ruta a medias): en su lugar
// se muestra el aviso «Nueva versión disponible» y el usuario recarga cuando
// le viene bien. Fuera de ese caso se recarga como siempre.
//
// `onOfflineReady` se dispara la primera vez que el SW termina de precachear
// el app shell — util para confirmar visualmente al usuario que la app ahora
// funciona offline.

/** ¿Hay captura de lecturas en curso que una recarga automática interrumpiría? */
export function debeAplazarRecarga(pathname: string, hayRutaEnCurso: boolean): boolean {
  return hayRutaEnCurso || pathname === sectionToPath('lecturas')
}

export function PwaUpdatePrompt() {
  const [showOfflineToast, setShowOfflineToast] = useState(false)
  // La versión nueva ya está activa pero la recarga se aplazó (ver arriba).
  const [recargaAplazada, setRecargaAplazada] = useState(false)
  const {
    needRefresh: [needRefreshSW, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
  } = useRegisterSW({
    onNeedReload() {
      const hayRuta = leerRutaEnCurso(localStorageRutaEnCurso(), Date.now()) !== null
      if (debeAplazarRecarga(window.location.pathname, hayRuta)) setRecargaAplazada(true)
      else window.location.reload()
    },
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

  const needRefresh = needRefreshSW || recargaAplazada
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
              onClick={() => { setNeedRefresh(false); setRecargaAplazada(false) }}
              style={{
                background: 'none', border: 'none', color: 'var(--at-ink-3)',
                cursor: 'pointer', fontSize: '13px', padding: '6px 10px',
              }}
            >
              Después
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
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
