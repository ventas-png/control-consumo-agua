import { useState, type ReactNode } from 'react'
import type { AnuncioComunidad, ComunicadoCondominio, TipoComunicado } from '../../../types'
import { formatFechaCalendario } from '../../../lib/format'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'

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

/** Lo que se abre en la ventana de lectura: un anuncio del tablón o un comunicado propio. */
interface Lectura {
  icon: string
  titulo: string
  etiqueta: ReactNode
  contenido: string
  meta: ReactNode
}

// En la lista cada tarjeta muestra un extracto de tres líneas y se abre
// completa en ventana emergente (en el teléfono, a pantalla completa): una
// circular o un acta larga ya no estira la página hasta el fondo.
export function PortalAnunciosTab({ anuncios, comunicados = [], unidadNombre }: Props) {
  const [abierto, setAbierto] = useState<Lectura | null>(null)
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
              const fecha = formatFechaCalendario(c.fecha_envio, { day: '2-digit', month: 'long', year: 'numeric' }, 'es', '—')
              const etiqueta = (
                <>
                  <Pill bg="var(--at-primary-tint)" color="var(--at-primary)">{cfg.label}</Pill>
                  {c.firmado && <span style={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--at-success)' }}>✓ Firmado</span>}
                </>
              )
              const meta = (
                <>
                  <span>{fecha}</span>
                  {c.enviado_por && <span>Emitido por: {c.enviado_por}</span>}
                </>
              )
              return (
                <Tarjeta
                  key={c.id}
                  icon={cfg.icon}
                  titulo={c.titulo}
                  etiqueta={etiqueta}
                  contenido={c.contenido}
                  meta={meta}
                  borde="var(--at-primary-soft-2)"
                  acento="var(--at-primary)"
                  onAbrir={() => setAbierto({ icon: cfg.icon, titulo: c.titulo, etiqueta, contenido: c.contenido, meta })}
                />
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
            const tc = TIPO_CONFIG[(a.tipo as TipoAnuncio) ?? 'aviso'] ?? TIPO_CONFIG.aviso
            const etiqueta = <Pill bg={tc.bg} color={tc.color}>{tc.label}</Pill>
            const meta = (
              <>
                <span>{new Date(a.created_at).toLocaleDateString('es', { day: '2-digit', month: 'long', year: 'numeric' })}</span>
                {a.fecha_evento && <span>📅 Evento: {formatFechaCalendario(a.fecha_evento, { day: '2-digit', month: 'long' }, 'es', '—')}</span>}
              </>
            )
            return (
              <Tarjeta
                key={a.id}
                icon={tc.icon}
                titulo={a.titulo}
                etiqueta={etiqueta}
                contenido={a.contenido}
                meta={meta}
                borde={tc.border}
                acento={tc.color}
                onAbrir={() => setAbierto({ icon: tc.icon, titulo: a.titulo, etiqueta, contenido: a.contenido, meta })}
              />
            )
          })}
        </div>
      )}

      {abierto && (
        <EditModal
          title={abierto.titulo}
          subtitle={<span style={{ display: 'inline-flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '2px' }}>{abierto.etiqueta}</span>}
          maxWidth="620px"
          fullScreenOnMobile
          onClose={() => setAbierto(null)}
          footer={<Button variant="secondary" onClick={() => setAbierto(null)}>Cerrar</Button>}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ fontSize: '12.5px', color: 'var(--at-ink-3)', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              {abierto.meta}
            </div>
            <div style={{ fontSize: '15px', color: 'var(--at-ink-2)', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {abierto.contenido}
            </div>
          </div>
        </EditModal>
      )}
    </div>
  )
}

function Pill({ bg, color, children }: { bg: string; color: string; children: ReactNode }) {
  return (
    <span style={{ padding: '2px 9px', borderRadius: '999px', fontSize: '11.5px', fontWeight: 700, background: bg, color }}>{children}</span>
  )
}

function Tarjeta({ icon, titulo, etiqueta, contenido, meta, borde, acento, onAbrir }: {
  icon: string
  titulo: string
  etiqueta: ReactNode
  contenido: string
  meta: ReactNode
  borde: string
  acento: string
  onAbrir: () => void
}) {
  return (
    <button
      type="button"
      className="conv-row"
      onClick={onAbrir}
      style={{
        width: '100%', textAlign: 'left', cursor: 'pointer', color: 'var(--at-ink)',
        background: 'var(--at-surface)', borderRadius: '14px', padding: '14px 16px',
        borderTop: `1.5px solid ${borde}`, borderRight: `1.5px solid ${borde}`, borderBottom: `1.5px solid ${borde}`,
        borderLeft: `4px solid ${acento}`,
        display: 'flex', gap: '12px', alignItems: 'flex-start',
      }}
    >
      <span aria-hidden="true" style={{ fontSize: '22px', flexShrink: 0, lineHeight: 1.2 }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '5px' }}>
        <span style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: '14.5px' }}>{titulo}</span>
          {etiqueta}
        </span>
        <span style={{
          fontSize: '13.5px', color: 'var(--at-ink-2)', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {contenido}
        </span>
        <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          {meta}
          <span style={{ marginLeft: 'auto', color: acento, fontWeight: 700 }}>Leer completo ›</span>
        </span>
      </span>
    </button>
  )
}
