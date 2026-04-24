import type { AnuncioComunidad } from '../../../types'

interface Props {
  anuncios: AnuncioComunidad[]
}

type TipoAnuncio = 'aviso' | 'urgente' | 'evento' | 'mantenimiento'

const TIPO_CONFIG: Record<TipoAnuncio, { label: string; icon: string; bg: string; color: string; border: string }> = {
  aviso:         { label: 'Aviso',         icon: '📢', bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
  urgente:       { label: 'Urgente',       icon: '🚨', bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
  evento:        { label: 'Evento',        icon: '🎉', bg: '#f0fdf4', color: '#16a34a', border: '#86efac' },
  mantenimiento: { label: 'Mantenimiento', icon: '🔧', bg: '#fff7ed', color: '#c2410c', border: '#fed7aa' },
}

export function PortalAnunciosTab({ anuncios }: Props) {
  const activos = anuncios.filter(a => a.activo).sort((a, b) => b.created_at.localeCompare(a.created_at))
  const urgentes = activos.filter(a => a.tipo === 'urgente')

  return (
    <div>
      <h3 style={{ margin: '0 0 18px', fontSize: '17px', fontWeight: 700, color: '#0f172a' }}>Comunicados del condominio</h3>

      {urgentes.length > 0 && (
        <div style={{ background: '#fef2f2', border: '1.5px solid #fecaca', borderRadius: '12px', padding: '14px 16px', marginBottom: '18px' }}>
          <div style={{ fontWeight: 700, fontSize: '13px', color: '#dc2626', marginBottom: '8px' }}>🚨 AVISOS URGENTES</div>
          {urgentes.map(a => (
            <div key={a.id} style={{ marginBottom: '6px' }}>
              <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>{a.titulo}</div>
              <div style={{ fontSize: '13px', color: '#374151' }}>{a.contenido}</div>
            </div>
          ))}
        </div>
      )}

      {activos.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
          <div style={{ fontSize: '40px', marginBottom: '10px' }}>📢</div>
          <p style={{ fontWeight: 600, color: '#64748b' }}>Sin comunicados recientes</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {activos.map(a => {
            const tc = TIPO_CONFIG[(a.tipo as TipoAnuncio) ?? 'aviso']
            return (
              <div key={a.id} style={{ background: 'white', border: `1.5px solid ${tc.border}`, borderRadius: '14px', padding: '16px 18px' }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <span style={{ fontSize: '22px', flexShrink: 0 }}>{tc.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '4px' }}>
                      <span style={{ fontWeight: 700, fontSize: '14.5px', color: '#0f172a' }}>{a.titulo}</span>
                      <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: tc.bg, color: tc.color }}>{tc.label}</span>
                    </div>
                    <p style={{ margin: '0 0 6px', fontSize: '13.5px', color: '#374151', lineHeight: 1.5 }}>{a.contenido}</p>
                    <div style={{ fontSize: '11.5px', color: '#94a3b8', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                      <span>{new Date(a.created_at).toLocaleDateString('es', { day: '2-digit', month: 'long', year: 'numeric' })}</span>
                      {a.fecha_evento && <span>📅 Evento: {new Date(a.fecha_evento + 'T12:00:00').toLocaleDateString('es', { day: '2-digit', month: 'long' })}</span>}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
