// Componentes auxiliares del shell de la app (P1 #4, extraídos de App.tsx con
// el JSX intacto): splash de auth, barra de presencia y portal dual de cliente.
import { useState } from 'react'
import type { AppSection, UserSession } from '../../types'
import { BrandLogo } from '../shared/BrandLogo'
import { PresenceIndicator } from '../shared/PresenceIndicator'
import { useSession } from '../shared/SessionContext'
import { usePresence } from '../../hooks/usePresence'
import { CondominiosClientPortal, CustomerPortal } from './lazySections'

// Splash compartido entre el initial-load y los Suspense fallbacks de las
// pantallas de auth lazy. Mismo visual que cuando `loading=true` del useAuth.
export function AuthSplash() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, var(--at-primary-hover) 0%, var(--at-primary) 55%, var(--at-primary-2) 100%)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '18px' }}>
        <div style={{ filter: 'drop-shadow(0 10px 24px rgba(0,0,0,0.35))' }}>
          <BrandLogo size={64} />
        </div>
        <div style={{
          width: '40px', height: '40px',
          border: '3px solid rgba(255,255,255,0.25)',
          borderTop: '3px solid white',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
      </div>
    </div>
  )
}

// F4.4.2: muestra avatares de otros usuarios de la misma company viendo la
// misma seccion. Se monta justo bajo el Topbar. Si no hay nadie mas, se
// auto-oculta. Se inyecta el hook aqui (y no en App directo) para evitar
// re-renders del arbol grande cuando llegan eventos Realtime cada 30s.
export function PresenceBar({ activeSection }: { activeSection: AppSection }) {
  const currentUser = useSession()
  const { others } = usePresence({
    companyId: currentUser.company_id ?? null,
    userId: currentUser.user_id,
    section: activeSection,
  })
  if (others.length === 0) return null
  return (
    <div style={{
      padding: '6px 16px',
      borderBottom: '1px solid var(--at-line)',
      background: 'var(--at-surface-2)',
      display: 'flex', alignItems: 'center', gap: '10px',
    }}>
      <span style={{ fontSize: '11px', color: 'var(--at-ink-3)', fontWeight: 600 }}>
        Activos aquí:
      </span>
      <PresenceIndicator others={others} />
    </div>
  )
}

// Shown when a client has both servicio_agua and servicio_condominios active
export function DualServicePortal({ currentUser, onLogout }: { currentUser: UserSession; onLogout: () => void }) {
  const [activeService, setActiveService] = useState<'condominios' | 'agua'>('condominios')
  return (
    <div>
      {/* portal-service-switch: la clase la usa index.css para reservar el
          safe-area superior de iOS — ver el bloque ≤767px. Sin eso los dos
          chips quedan debajo del reloj y la batería, y no se pueden tocar. */}
      <div className="portal-service-switch" style={{
        position: 'sticky', top: 0, zIndex: 200,
        background: 'var(--at-surface)',
        borderBottom: '2px solid var(--at-line)',
        display: 'flex', justifyContent: 'center', gap: '6px',
        padding: '8px 16px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      }}>
        <button
          onClick={() => setActiveService('condominios')}
          style={{
            padding: '7px 22px', borderRadius: '20px', border: 'none',
            background: activeService === 'condominios' ? 'linear-gradient(135deg, var(--at-accent), var(--at-accent))' : 'var(--at-chip)',
            color: activeService === 'condominios' ? 'white' : 'var(--at-ink-3)',
            fontWeight: 600, fontSize: '13px', cursor: 'pointer',
            transition: 'all 0.18s',
          }}
        >🏢 Condominios</button>
        <button
          onClick={() => setActiveService('agua')}
          style={{
            padding: '7px 22px', borderRadius: '20px', border: 'none',
            background: activeService === 'agua' ? 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))' : 'var(--at-chip)',
            color: activeService === 'agua' ? 'white' : 'var(--at-ink-3)',
            fontWeight: 600, fontSize: '13px', cursor: 'pointer',
            transition: 'all 0.18s',
          }}
        >💧 Agua</button>
      </div>
      {activeService === 'condominios'
        ? <CondominiosClientPortal currentUser={currentUser} onLogout={onLogout} />
        : <CustomerPortal currentUser={currentUser} onLogout={onLogout} />
      }
    </div>
  )
}
