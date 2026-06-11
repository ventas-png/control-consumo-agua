import type { CSSProperties } from 'react'
import type { Cliente } from '../../types'
import { getEditedTagInfo } from '../../lib/timeUtils'
import { formatPhoneForWa, sanitizeHTML } from '../../lib/validation'

// ── Sub-componentes de celdas para la tabla de clientes ──────────────────
// Extraídos del render principal para mantener el cuerpo de ClientesSection
// más legible y para que React pueda potencialmente memoizarlos en el futuro.

export function ClienteCell({ cliente: c }: { cliente: Cliente }) {
  const tag = getEditedTagInfo(c.updated_at, c.updated_by_name)
  return (
    <div>
      <div style={{ fontWeight: 600, color: 'var(--at-ink)' }}>{sanitizeHTML(c.nombre)}</div>
      {c.direccion && (
        <div style={{ fontSize: 12, color: 'var(--at-ink-3)', fontWeight: 400, marginTop: 2 }}>
          {sanitizeHTML(c.direccion)}
        </div>
      )}
      {c.fecha_nacimiento && (
        <div style={{ fontSize: 11, color: 'var(--at-line-strong)', marginTop: 1 }}>
          Nac: {c.fecha_nacimiento}
        </div>
      )}
      {tag && (
        <span
          title={tag.tooltip}
          style={{
            display: 'inline-block', marginTop: 4, padding: '2px 8px',
            borderRadius: 10, fontSize: 11, fontWeight: 500,
            color: tag.color, background: tag.bg, cursor: 'default',
          }}
        >
          {tag.label}
        </span>
      )}
    </div>
  )
}

export function IdentificacionCell({ cliente: c }: { cliente: Cliente }) {
  if (!c.cui_dui && !c.nacionalidad) return <span style={{ color: 'var(--at-line-strong)' }}>—</span>
  return (
    <>
      {c.cui_dui && <div style={{ fontSize: 13, fontFamily: 'monospace' }}>{sanitizeHTML(c.cui_dui)}</div>}
      {c.nacionalidad && (
        <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 2 }}>{sanitizeHTML(c.nacionalidad)}</div>
      )}
    </>
  )
}

export function ContactoCell({ cliente: c }: { cliente: Cliente }) {
  if (!c.email && !c.telefono && !c.telefono_alterno && !c.whatsapp) {
    return <span style={{ color: 'var(--at-line-strong)' }}>—</span>
  }
  return (
    <>
      {c.email && <div style={{ fontSize: 13 }}>✉️ {sanitizeHTML(c.email)}</div>}
      {c.telefono && (
        <div style={{ fontSize: 12, marginTop: 2 }}>
          <a href={`tel:${c.telefono}`} style={{ color: 'var(--at-primary-hover)', textDecoration: 'none' }} title="Llamar">
            📞 {sanitizeHTML(c.telefono)}
          </a>
        </div>
      )}
      {c.telefono_alterno && (
        <div style={{ fontSize: 12, marginTop: 2 }}>
          <a href={`tel:${c.telefono_alterno}`} style={{ color: 'var(--at-ink-3)', textDecoration: 'none' }} title="Llamar alterno">
            📱 {sanitizeHTML(c.telefono_alterno)}
          </a>
        </div>
      )}
      {c.whatsapp && (
        <div style={{ fontSize: 12, marginTop: 2 }}>
          <a
            href={`https://wa.me/${formatPhoneForWa(c.whatsapp)}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--at-success)', textDecoration: 'none' }}
            title="Abrir WhatsApp"
          >
            💬 {sanitizeHTML(c.whatsapp)}
          </a>
        </div>
      )}
    </>
  )
}

export function CuentaCell({
  cliente: c, hasAccount, activoEntry, canEdit, onToggleActivo,
}: {
  cliente: Cliente
  hasAccount: boolean
  activoEntry: { ccId: string; activo: boolean } | undefined
  canEdit: boolean
  onToggleActivo: (id: string) => void
}) {
  const pill: CSSProperties = {
    padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <span style={{
        ...pill,
        background: c.puede_crear_cuenta ? 'var(--at-success-tint)' : 'var(--at-chip)',
        color: c.puede_crear_cuenta ? 'var(--at-success-strong)' : 'var(--at-ink-3)',
      }}>
        {c.puede_crear_cuenta ? 'Habilitado' : 'Deshabilitado'}
      </span>
      {hasAccount ? (
        <>
          <span style={{ ...pill, background: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)' }}>Cuenta activa</span>
          {canEdit && activoEntry && (
            <button
              onClick={() => onToggleActivo(c.id)}
              title={activoEntry.activo ? 'Clic para ocultar datos al cliente' : 'Clic para mostrar datos al cliente'}
              style={{
                ...pill, border: 'none', cursor: 'pointer',
                background: activoEntry.activo ? 'var(--at-success-tint)' : 'var(--at-warning-tint)',
                color: activoEntry.activo ? 'var(--at-success-strong)' : 'var(--at-warning-strong)',
              }}
            >
              {activoEntry.activo ? '● Datos visibles' : '○ Datos ocultos'}
            </button>
          )}
        </>
      ) : (
        <span style={{ ...pill, color: 'var(--at-ink-3)', background: 'var(--at-surface-2)', fontWeight: 400 }}>Sin cuenta</span>
      )}
    </div>
  )
}
