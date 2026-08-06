// Átomos de UI del modal de roles y permisos (RolPermisosModal /
// PermissionMatrixPanel). Extraídos sin cambio visual para que ambos
// componentes los compartan; RoleCard gana variantes para el modelo de
// plantillas (duplicar, heredado/convertir) y TemplateCard es la tarjeta de la
// galería de plantillas (sin checkbox: usar / personalizar).
import { hoyLocalISO } from '../../lib/format'
import { useState } from 'react'
import type { RoleDef } from '../../types'

export function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)',
      letterSpacing: '0.06em', marginBottom: '8px', textTransform: 'uppercase',
    }}>{children}</div>
  )
}

export function SubsectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-2)',
      letterSpacing: '0.04em', marginBottom: '4px', textTransform: 'uppercase',
      paddingBottom: '4px', borderBottom: '1px solid var(--at-line)',
    }}>{children}</div>
  )
}

export function Banner({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: '11px', color, background: color + '14',
      border: `1px solid ${color}33`, borderRadius: '6px',
      padding: '6px 10px', marginBottom: '10px', lineHeight: '1.4',
    }}>{children}</div>
  )
}

export function AccessBadge({ level, count, total }: { level: 'completo' | 'parcial' | 'ninguno'; count: number; total: number }) {
  const cfg = level === 'completo'
    ? { color: 'var(--at-success)', label: 'Completo' }
    : level === 'parcial'
      ? { color: 'var(--at-warning)', label: `Parcial ${count}/${total}` }
      : { color: 'var(--at-ink-3)', label: 'Sin acceso' }
  return (
    <span style={{
      fontSize: '11px', fontWeight: 600, color: cfg.color,
      background: cfg.color + '1a', padding: '2px 8px', borderRadius: '999px',
    }}>{cfg.label}</span>
  )
}

export function iconBtnStyle(color: string): React.CSSProperties {
  return {
    background: 'transparent', border: 'none', cursor: 'pointer',
    color, fontSize: '13px', padding: '2px 5px', borderRadius: '4px',
  }
}

function MiniBadge({ color, background, children }: { color: string; background: string; children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: '9px', fontWeight: 700, color, background,
      padding: '1px 5px', borderRadius: '4px',
      letterSpacing: '0.04em', textTransform: 'uppercase',
    }}>{children}</span>
  )
}

const smallActionBtn: React.CSSProperties = {
  fontSize: '11px', fontWeight: 600, padding: '3px 10px', borderRadius: '6px',
  border: '1px solid var(--at-accent-2)', background: 'transparent',
  color: 'var(--at-primary-2)', cursor: 'pointer', whiteSpace: 'nowrap',
}

export function RoleCard({
  role, checked, expiresAt, onToggle, onExpirationChange, onEdit, onDelete, onClone,
  inherited, onConvert,
}: {
  role: RoleDef; checked: boolean; expiresAt?: string | null;
  onToggle: () => void; onExpirationChange?: (v: string | null) => void;
  onEdit?: () => void; onDelete?: () => void; onClone?: () => void;
  /** Asignación directa a un rol del sistema previa al modelo de plantillas. */
  inherited?: boolean; onConvert?: () => void;
}) {
  const expiresSoon = expiresAt ? new Date(expiresAt) < new Date(Date.now() + 7 * 86400000) : false
  const expired = expiresAt ? new Date(expiresAt) < new Date() : false
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      width: '100%', marginBottom: '6px', borderRadius: '8px',
      border: `1px solid ${checked ? role.color + '55' : 'var(--at-line)'}`,
      background: checked ? role.color + '12' : 'transparent',
      transition: 'border-color 0.15s, background 0.15s',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '9px 11px' }}>
        <button
          type="button"
          onClick={onToggle}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0, marginTop: '1px' }}
        >
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '16px', height: '16px', borderRadius: '4px',
            border: `2px solid ${checked ? role.color : 'var(--at-line-strong)'}`,
            background: checked ? role.color : 'transparent',
          }}>
            {checked && <span style={{ color: 'white', fontSize: '11px', lineHeight: 1 }}>✓</span>}
          </span>
        </button>
        <button
          type="button"
          onClick={onToggle}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', flex: 1, textAlign: 'left' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: role.color, flexShrink: 0 }} />
            <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--at-ink)' }}>{role.name}</span>
            {!role.is_system && !role.cloned_from_role_id && (
              <MiniBadge color="var(--at-accent-hover)" background="rgba(156, 87, 51,0.1)">Custom</MiniBadge>
            )}
            {!role.is_system && role.cloned_from_role_id && (
              <MiniBadge color="var(--at-primary)" background="rgba(27, 59, 54,0.08)">Plantilla</MiniBadge>
            )}
            {inherited && (
              <MiniBadge color="var(--at-warning)" background="rgba(245,158,11,0.1)">Heredado</MiniBadge>
            )}
            {expiresAt && (
              <MiniBadge
                color={expired ? 'var(--at-danger)' : expiresSoon ? 'var(--at-warning)' : 'var(--at-primary)'}
                background={expired ? 'rgba(239,68,68,0.1)' : expiresSoon ? 'rgba(245,158,11,0.1)' : 'rgba(27, 59, 54,0.1)'}
              >{expired ? 'Expirado' : 'Temporal'}</MiniBadge>
            )}
          </div>
          {role.description && (
            <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '2px', lineHeight: '1.4' }}>{role.description}</div>
          )}
        </button>
        <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
          {onClone && (
            <button onClick={onClone} title="Duplicar y personalizar" style={iconBtnStyle('var(--at-ink-2)')}>⧉</button>
          )}
          {onEdit && (
            <button onClick={onEdit} title="Editar" style={iconBtnStyle('var(--at-primary-2)')}>✎</button>
          )}
          {onDelete && (
            <button onClick={onDelete} title="Eliminar" style={iconBtnStyle('var(--at-danger)')}>🗑</button>
          )}
        </div>
      </div>
      {inherited && onConvert && (
        <div style={{ padding: '0 11px 9px' }}>
          <button onClick={onConvert} style={smallActionBtn}>Convertir a rol de empresa</button>
          <span style={{ fontSize: '10px', color: 'var(--at-ink-3)', marginLeft: '8px' }}>
            Asignación directa a un rol del sistema (modelo anterior)
          </span>
        </div>
      )}
      {checked && onExpirationChange && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '0 11px 9px', borderTop: `1px dashed ${role.color}22`, paddingTop: '8px', marginTop: '0',
        }}>
          <label style={{ fontSize: '11px', color: 'var(--at-ink-3)', fontWeight: 600 }}>Expira:</label>
          <input
            type="date"
            value={expiresAt ?? ''}
            onChange={(e) => onExpirationChange(e.target.value || null)}
            min={hoyLocalISO()}
            style={{
              fontSize: '11px', padding: '3px 6px',
              border: '1px solid var(--at-line-strong)', borderRadius: '4px',
              color: 'var(--at-ink-2)', background: 'var(--at-surface)',
            }}
          />
          {expiresAt && (
            <button
              onClick={() => onExpirationChange(null)}
              title="Quitar expiración (permanente)"
              style={{
                fontSize: '10px', padding: '3px 7px', borderRadius: '4px',
                border: '1px solid var(--at-line-strong)', background: 'var(--at-surface)', color: 'var(--at-ink-3)',
                cursor: 'pointer', fontWeight: 600,
              }}
            >Permanente</button>
          )}
          {!expiresAt && (
            <span style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>(sin expiración)</span>
          )}
        </div>
      )}
    </div>
  )
}

/** Tarjeta de la galería de plantillas: sin checkbox; "Usar plantilla" crea o
 * reutiliza la copia de empresa, "Personalizar" abre el editor clonando. */
export function TemplateCard({
  role, busy, onUse, onCustomize,
}: {
  role: RoleDef; busy?: boolean; onUse: () => void; onCustomize: () => void
}) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: '6px',
      width: '100%', marginBottom: '6px', borderRadius: '8px',
      border: '1px dashed var(--at-line)', padding: '9px 11px',
      opacity: busy ? 0.6 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: role.color, flexShrink: 0 }} />
        <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--at-ink)' }}>{role.name}</span>
        <MiniBadge color="var(--at-ink-3)" background="var(--at-chip)">Plantilla</MiniBadge>
      </div>
      {role.description && (
        <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', lineHeight: '1.4' }}>{role.description}</div>
      )}
      <div style={{ display: 'flex', gap: '6px' }}>
        <button onClick={onUse} disabled={busy} style={{ ...smallActionBtn, cursor: busy ? 'default' : 'pointer' }}>
          {busy ? 'Creando…' : 'Usar plantilla'}
        </button>
        <button
          onClick={onCustomize}
          disabled={busy}
          style={{
            ...smallActionBtn, border: '1px solid var(--at-line-strong)',
            color: 'var(--at-ink-2)', cursor: busy ? 'default' : 'pointer',
          }}
        >Personalizar</button>
      </div>
    </div>
  )
}

/** Sección colapsable de la columna de roles (acordeón por servicio). */
export function CollapsibleSection({
  title, badge, defaultOpen = false, children,
}: {
  title: string; badge?: string; defaultOpen?: boolean; children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ marginBottom: '10px' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          width: '100%', background: 'transparent', border: 'none', cursor: 'pointer',
          padding: '4px 0', textAlign: 'left',
        }}
      >
        <span style={{
          fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)',
          letterSpacing: '0.06em', textTransform: 'uppercase',
        }}>{title}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {badge && (
            <span style={{
              fontSize: '10px', fontWeight: 600, color: 'var(--at-ink-3)',
              background: 'var(--at-chip)', padding: '1px 7px', borderRadius: '999px',
            }}>{badge}</span>
          )}
          <span style={{
            fontSize: '10px', color: 'var(--at-ink-3)',
            transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s',
          }}>▶</span>
        </span>
      </button>
      {open && <div style={{ marginTop: '6px' }}>{children}</div>}
    </div>
  )
}
