import type { UserSession } from '../../types'
import { useOffline } from '../../hooks/useOffline'

interface Props {
  currentUser: UserSession
}

export function Header({ currentUser }: Props) {
  const { isOnline } = useOffline()

  return (
    <div style={{ background: 'var(--at-surface)', borderRadius: '16px', padding: '20px 28px', marginBottom: '20px', boxShadow: '0 4px 6px rgba(0,0,0,0.07)' }}>
      <div style={{ fontSize: '22px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '12px' }}>
        <svg style={{ width: '28px', height: '28px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
        </svg>
        <span>Control de Agua Potable — {currentUser.name}</span>
      </div>
      <div style={{ marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 12px', background: isOnline ? '#e6fffa' : '#fef3c7', color: isOnline ? '#047857' : '#92400e', borderRadius: '12px', fontSize: '13px', fontWeight: 500 }}>
          <span style={{ width: '6px', height: '6px', background: isOnline ? '#10b981' : '#f59e0b', borderRadius: '50%', display: 'inline-block' }} />
          {isOnline ? 'Supabase Conectado' : 'Modo Offline'}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 12px', background: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', borderRadius: '12px', fontSize: '13px', fontWeight: 500 }}>
          Rol: {currentUser.role}
        </span>
      </div>
    </div>
  )
}
