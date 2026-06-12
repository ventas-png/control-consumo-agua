// Panel derecho del modal de roles: permisos efectivos explorables y
// editables. Cada grupo de módulo/sección se expande (acordeón) para mostrar
// las acciones/tabs individuales con atribución de qué rol otorga cada una;
// el clic sobre una línea alterna un ajuste individual del usuario
// (allow/deny), de forma involutiva: dos clics vuelven al estado base.
import { useMemo, useState } from 'react'
import type { RoleDef } from '../../types'
import type { SectionGroup } from '../../lib/condominiosRoles'
import { groupStatus, type PermissionEffect } from '../../lib/effectivePermissions'
import { AccessBadge, Banner, SectionHeader, SubsectionHeader } from './rolesUi'

export interface MatrixSectionBlock {
  label: string
  groups: SectionGroup[]
}

interface Props {
  sections: MatrixSectionBlock[]
  effective: Set<string>
  grantedBy: Map<string, string[]>
  rolesById: Map<string, RoleDef>
  permLabels: Map<string, string>
  overrides: Map<string, PermissionEffect>
  redundantOverrides: Set<string>
  selectedCount: number
  onTogglePermission: (key: string) => void
  onResetOverrides: () => void
  onSaveAsRole: () => void
}

const ACTION_LABELS: Record<string, string> = {
  view: 'Ver',
  create: 'Crear',
  edit: 'Editar',
  change_status: 'Cambiar estado',
}

function lineLabel(key: string, permLabels: Map<string, string>): string {
  // agua.<mod>.<action> / platform.<mod>.<action> → etiqueta corta de la acción;
  // condominios.tab.<id> y resto → etiqueta del catálogo.
  const parts = key.split('.')
  const action = parts[parts.length - 1]
  if ((parts[0] === 'agua' || parts[0] === 'platform') && ACTION_LABELS[action]) {
    return ACTION_LABELS[action]
  }
  return permLabels.get(key) ?? (parts[2] ?? key)
}

export function PermissionMatrixPanel({
  sections, effective, grantedBy, rolesById, permLabels,
  overrides, redundantOverrides, selectedCount,
  onTogglePermission, onResetOverrides, onSaveAsRole,
}: Props) {
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)

  const statusBySection = useMemo(
    () => sections.map(s => ({ label: s.label, groups: s.groups, status: groupStatus(effective, s.groups) })),
    [sections, effective],
  )

  if (selectedCount === 0 && overrides.size === 0) {
    return (
      <>
        <SectionHeader>Permisos efectivos</SectionHeader>
        <div style={{ fontSize: '13px', color: 'var(--at-ink-3)', textAlign: 'center', marginTop: '32px', lineHeight: '1.6' }}>
          Sin roles asignados.<br />El usuario no tendrá<br />acceso a ningún módulo.
        </div>
      </>
    )
  }

  return (
    <>
      <SectionHeader>Permisos efectivos</SectionHeader>
      {selectedCount > 1 && (
        <Banner color="var(--at-primary)">{selectedCount} roles activos — permisos combinados</Banner>
      )}
      {overrides.size > 0 && (
        <Banner color="var(--at-accent)">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
            <span>{overrides.size} ajuste{overrides.size === 1 ? '' : 's'} individual{overrides.size === 1 ? '' : 'es'} para este usuario</span>
            <span style={{ display: 'flex', gap: '6px' }}>
              <button onClick={onResetOverrides} style={inlineLinkBtn}>Restablecer todos</button>
              <button onClick={onSaveAsRole} style={inlineLinkBtn}>Guardar como rol reutilizable</button>
            </span>
          </div>
        </Banner>
      )}
      <div style={{ fontSize: '10px', color: 'var(--at-ink-3)', marginBottom: '8px', lineHeight: 1.4 }}>
        Expande un módulo y haz clic en una línea para conceder o bloquear ese permiso solo a este usuario.
      </div>

      {statusBySection.map((section, si) => (
        <div key={section.label} style={{ marginTop: si === 0 ? 0 : '16px' }}>
          <SubsectionHeader>{section.label}</SubsectionHeader>
          {section.status.map((s, gi) => {
            const group = section.groups[gi]
            const open = expandedGroup === s.key
            return (
              <div key={s.key} style={{ borderBottom: '1px solid var(--at-chip)' }}>
                <button
                  onClick={() => setExpandedGroup(open ? null : s.key)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    width: '100%', padding: '7px 0', background: 'transparent', border: 'none',
                    cursor: 'pointer', textAlign: 'left', gap: '8px',
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                    <span style={{
                      fontSize: '9px', color: 'var(--at-ink-3)', flexShrink: 0,
                      transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s',
                    }}>▶</span>
                    <span style={{ fontSize: '13px', color: 'var(--at-ink-2)', fontWeight: 500 }}>{s.label}</span>
                  </span>
                  <AccessBadge level={s.level} count={s.count} total={s.total} />
                </button>
                {open && (
                  <div style={{ maxHeight: '240px', overflowY: 'auto', paddingBottom: '8px' }}>
                    {group.tabs.map(key => (
                      <PermissionLine
                        key={key}
                        permKey={key}
                        label={lineLabel(key, permLabels)}
                        granted={effective.has(key)}
                        grantedByRoles={(grantedBy.get(key) ?? []).map(id => rolesById.get(id)).filter((r): r is RoleDef => !!r)}
                        override={overrides.get(key)}
                        redundant={redundantOverrides.has(key)}
                        onToggle={() => onTogglePermission(key)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}
    </>
  )
}

function PermissionLine({
  permKey, label, granted, grantedByRoles, override, redundant, onToggle,
}: {
  permKey: string
  label: string
  granted: boolean
  grantedByRoles: RoleDef[]
  override?: PermissionEffect
  redundant: boolean
  onToggle: () => void
}) {
  const isOverridden = override !== undefined && !redundant
  const chips = grantedByRoles.slice(0, 3)
  const extra = grantedByRoles.length - chips.length
  return (
    <button
      onClick={onToggle}
      title={
        redundant
          ? 'Ajuste sin efecto (se quitará al guardar) — clic para retirarlo'
          : isOverridden
            ? 'Ajuste individual — clic para restablecer'
            : granted
              ? 'Clic para bloquear este permiso solo a este usuario'
              : 'Clic para conceder este permiso solo a este usuario'
      }
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
        width: '100%', padding: '4px 0 4px 18px', background: 'transparent', border: 'none',
        cursor: 'pointer', textAlign: 'left', opacity: redundant ? 0.55 : 1,
      }}
      data-perm-key={permKey}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
        <span style={{
          fontSize: '11px', flexShrink: 0,
          color: granted ? 'var(--at-success)' : 'var(--at-ink-3)',
        }}>{granted ? '✓' : '×'}</span>
        <span style={{
          fontSize: '12px', color: 'var(--at-ink-2)',
          textDecoration: override === 'deny' && !redundant ? 'line-through' : 'none',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{label}</span>
        {isOverridden && override === 'allow' && (
          <span style={overrideBadgeStyle('var(--at-accent)')}>ajuste</span>
        )}
        {isOverridden && override === 'deny' && (
          <span style={overrideBadgeStyle('var(--at-danger)')}>bloqueado</span>
        )}
        {redundant && (
          <span style={overrideBadgeStyle('var(--at-ink-3)')}>sin efecto</span>
        )}
      </span>
      <span style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
        {chips.map(r => (
          <span key={r.id} title={r.name} style={{
            fontSize: '9px', fontWeight: 600, padding: '1px 6px', borderRadius: '999px',
            background: r.color + '22', color: r.color,
            maxWidth: '90px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{r.name}</span>
        ))}
        {extra > 0 && (
          <span style={{ fontSize: '9px', color: 'var(--at-ink-3)' }}>+{extra}</span>
        )}
      </span>
    </button>
  )
}

function overrideBadgeStyle(color: string): React.CSSProperties {
  return {
    fontSize: '9px', fontWeight: 700, color, background: color + '1a',
    padding: '1px 5px', borderRadius: '4px', letterSpacing: '0.04em',
    textTransform: 'uppercase', flexShrink: 0,
  }
}

const inlineLinkBtn: React.CSSProperties = {
  fontSize: '11px', fontWeight: 600, color: 'inherit',
  background: 'transparent', border: '1px solid currentColor', borderRadius: '4px',
  padding: '1px 8px', cursor: 'pointer',
}
