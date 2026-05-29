import { notify } from '../shared/Dialog'

interface Props {
  onLogout: () => void
}

export function ConfiguracionSection({ onLogout }: Props) {
  return (
    <div style={{ background: 'var(--at-surface)', borderRadius: '24px', padding: '32px', boxShadow: '0 10px 40px rgba(0,0,0,0.08)' }}>
      <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '20px', borderBottom: '2px solid var(--at-line)', paddingBottom: '12px' }}>
        Configuración
      </div>
      <p style={{ color: 'var(--at-ink-3)', marginBottom: '20px' }}>
        Las credenciales se gestionan a través de variables de entorno en el archivo <code>.env</code>.
        No es necesario editar el código fuente.
      </p>
      <div style={{ background: 'var(--at-surface-2)', borderRadius: '12px', padding: '16px', marginBottom: '20px', fontFamily: 'monospace', fontSize: '13px' }}>
        <div style={{ marginBottom: '8px', color: 'var(--at-ink-3)' }}>Variables de entorno configuradas:</div>
        <div>✅ VITE_SUPABASE_URL</div>
        <div>✅ VITE_SUPABASE_ANON_KEY</div>
        <div>✅ VITE_COUNTRY_CODE</div>
      </div>
      <div style={{ display: 'flex', gap: '12px' }}>
        <button
          onClick={() => notify({ variant: 'info', title: 'Info', text: 'La configuración se gestiona via variables de entorno (.env)' })}
          style={{ padding: '12px 24px', background: 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-accent-2) 100%)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
        >
          Ver Info
        </button>
        <button
          onClick={onLogout}
          style={{ padding: '12px 24px', background: 'linear-gradient(135deg, var(--at-danger) 0%, var(--at-danger) 100%)', color: 'var(--at-on-status)', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
        >
          🚪 Cerrar Sesión
        </button>
      </div>
    </div>
  )
}
