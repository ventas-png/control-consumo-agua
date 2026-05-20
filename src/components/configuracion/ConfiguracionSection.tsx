import Swal from 'sweetalert2'

interface Props {
  onLogout: () => void
}

export function ConfiguracionSection({ onLogout }: Props) {
  return (
    <div style={{ background: 'white', borderRadius: '24px', padding: '32px', boxShadow: '0 10px 40px rgba(0,0,0,0.08)' }}>
      <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '20px', borderBottom: '2px solid var(--at-line)', paddingBottom: '12px' }}>
        Configuración
      </div>
      <p style={{ color: '#7E9389', marginBottom: '20px' }}>
        Las credenciales se gestionan a través de variables de entorno en el archivo <code>.env</code>.
        No es necesario editar el código fuente.
      </p>
      <div style={{ background: '#FAF7EF', borderRadius: '12px', padding: '16px', marginBottom: '20px', fontFamily: 'monospace', fontSize: '13px' }}>
        <div style={{ marginBottom: '8px', color: '#7E9389' }}>Variables de entorno configuradas:</div>
        <div>✅ VITE_SUPABASE_URL</div>
        <div>✅ VITE_SUPABASE_ANON_KEY</div>
        <div>✅ VITE_EMAILJS_PUBLIC_KEY</div>
        <div>✅ VITE_EMAILJS_SERVICE_ID</div>
        <div>✅ VITE_EMAILJS_TEMPLATE_RECIBO</div>
        <div>✅ VITE_COUNTRY_CODE</div>
      </div>
      <div style={{ display: 'flex', gap: '12px' }}>
        <button
          onClick={() => Swal.fire('Info', 'La configuración se gestiona via variables de entorno (.env)', 'info')}
          style={{ padding: '12px 24px', background: 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-accent-2) 100%)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
        >
          Ver Info
        </button>
        <button
          onClick={onLogout}
          style={{ padding: '12px 24px', background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
        >
          🚪 Cerrar Sesión
        </button>
      </div>
    </div>
  )
}
