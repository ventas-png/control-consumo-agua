import type { AnuncioComunidad, ComunicadoCondominio, TipoComunicado } from '../../../types'
import { formatFechaCalendario } from '../../../lib/format'

interface Props {
  anuncios: AnuncioComunidad[]
  /**
   * Comunicados formales dirigidos a ESTA unidad (destinatario 'especifico').
   * La RLS ya se los concedía al residente desde 20260602000030, pero hasta
   * ahora ninguna pantalla los mostraba: una carta o un certificado emitido a
   * su nombre no llegaba a ningún lado.
   */
  comunicados?: ComunicadoCondominio[]
  unidadNombre?: string
}

const COMUNICADO_LABELS: Record<TipoComunicado, { label: string; icon: string }> = {
  carta:       { label: 'Carta',       icon: '✉️' },
  circular:    { label: 'Circular',    icon: '📢' },
  aviso:       { label: 'Aviso',       icon: '📌' },
  certificado: { label: 'Certificado', icon: '📜' },
  acta:        { label: 'Acta',        icon: '📋' },
}

type TipoAnuncio = 'aviso' | 'urgente' | 'evento' | 'mantenimiento'

const TIPO_CONFIG: Record<TipoAnuncio, { label: string; icon: string; bg: string; color: string; border: string }> = {
  aviso:         { label: 'Aviso',         icon: '📢', bg: 'var(--at-primary-tint)', color: 'var(--at-primary)', border: 'var(--at-primary-soft-2)' },
  urgente:       { label: 'Urgente',       icon: '🚨', bg: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'var(--at-danger-border)' },
  evento:        { label: 'Evento',        icon: '🎉', bg: 'var(--at-success-tint)', color: 'var(--at-success)', border: 'var(--at-success-border)' },
  mantenimiento: { label: 'Mantenimiento', icon: '🔧', bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', border: 'var(--at-warning-border)' },
}

export function PortalAnunciosTab({ anuncios, comunicados = [], unidadNombre }: Props) {
  const activos = anuncios.filter(a => a.activo).sort((a, b) => b.created_at.localeCompare(a.created_at))
  const urgentes = activos.filter(a => a.tipo === 'urgente')
  const misComunicados = [...comunicados].sort((a, b) => b.fecha_envio.localeCompare(a.fecha_envio))

  return (
    <div>
      <h3 style={{ margin: '0 0 18px', fontSize: '17px', fontWeight: 700, color: 'var(--at-ink)' }}>Comunicados del condominio</h3>

      {/* Dirigidos a la unidad — van primero: son personales, no del tablón. */}
      {misComunicados.length > 0 && (
        <div style={{ marginBottom: '22px' }}>
          <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
            ✉️ Dirigidos a {unidadNombre ? `tu unidad (${unidadNombre})` : 'tu unidad'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {misComunicados.map(c => {
              const cfg = COMUNICADO_LABELS[c.tipo] ?? COMUNICADO_LABELS.aviso
              return (
                <div key={c.id} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-primary-soft-2)', borderLeft: '4px solid var(--at-primary)', borderRadius: '14px', padding: '16px 18px' }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '6px' }}>
                    <span style={{ fontSize: '18px' }}>{cfg.icon}</span>
                    <span style={{ fontWeight: 700, fontSize: '14.5px', color: 'var(--at-ink)' }}>{c.titulo}</span>
                    <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: 'var(--at-primary-tint)', color: 'var(--at-primary)' }}>{cfg.label}</span>
                    {c.firmado && (
                      <span style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--at-success)' }}>✓ Firmado</span>
                    )}
                  </div>
                  <p style={{ margin: '0 0 8px', fontSize: '13.5px', color: 'var(--at-ink-2)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{c.contenido}</p>
                  <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <span>{formatFechaCalendario(c.fecha_envio, { day: '2-digit', month: 'long', year: 'numeric' }, 'es', '—')}</span>
                    {c.enviado_por && <span>Emitido por: {c.enviado_por}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {urgentes.length > 0 && (
        <div style={{ background: 'var(--at-danger-tint)', border: '1.5px solid var(--at-danger-border)', borderRadius: '12px', padding: '14px 16px', marginBottom: '18px' }}>
          <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--at-danger)', marginBottom: '8px' }}>🚨 AVISOS URGENTES</div>
          {urgentes.map(a => (
            <div key={a.id} style={{ marginBottom: '6px' }}>
              <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>{a.titulo}</div>
              <div style={{ fontSize: '13px', color: 'var(--at-ink-2)' }}>{a.contenido}</div>
            </div>
          ))}
        </div>
      )}

      {/* Con comunicados propios en pantalla, un "sin comunicados" aquí abajo se
          contradice: el vacío se degrada a una línea sobre el tablón. */}
      {activos.length === 0 ? (
        misComunicados.length > 0 ? (
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--at-ink-3)' }}>
            No hay anuncios generales del condominio en este momento.
          </p>
        ) : (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--at-ink-3)' }}>
            <div style={{ fontSize: '40px', marginBottom: '10px' }}>📢</div>
            <p style={{ fontWeight: 600, color: 'var(--at-ink-3)' }}>Sin comunicados recientes</p>
          </div>
        )
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {activos.map(a => {
            const tc = TIPO_CONFIG[(a.tipo as TipoAnuncio) ?? 'aviso']
            return (
              <div key={a.id} style={{ background: 'var(--at-surface)', border: `1.5px solid ${tc.border}`, borderRadius: '14px', padding: '16px 18px' }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                  <span style={{ fontSize: '22px', flexShrink: 0 }}>{tc.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '4px' }}>
                      <span style={{ fontWeight: 700, fontSize: '14.5px', color: 'var(--at-ink)' }}>{a.titulo}</span>
                      <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: tc.bg, color: tc.color }}>{tc.label}</span>
                    </div>
                    <p style={{ margin: '0 0 6px', fontSize: '13.5px', color: 'var(--at-ink-2)', lineHeight: 1.5 }}>{a.contenido}</p>
                    <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                      <span>{new Date(a.created_at).toLocaleDateString('es', { day: '2-digit', month: 'long', year: 'numeric' })}</span>
                      {a.fecha_evento && <span>📅 Evento: {formatFechaCalendario(a.fecha_evento, { day: '2-digit', month: 'long' }, 'es', '—')}</span>}
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
