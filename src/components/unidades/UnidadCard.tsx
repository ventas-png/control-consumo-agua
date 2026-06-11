import type { CSSProperties } from 'react'
import type { Cliente, Unidad } from '../../types'
import { ESTADOS_OCUPACIONALES, CONTRATOS_SUMINISTRO } from './ui'
import { getEditedTagInfo } from '../../lib/timeUtils'
import { formatDate, formatNumber } from '../../lib/format'

// ── Sub-componente UnidadCard ────────────────────────────────────────────
// Extraído del render principal para reducir el cuerpo de UnidadesSection
// y dejar la card como una unidad de UI testeable / memoizable a futuro.

export function UnidadCard({
  unidad: u,
  tipo,
  tipoColor: col,
  nContadores,
  proyectoNombre,
  clienteAsignado,
  canEdit,
  onEdit,
  onToggleActivo,
  onEliminar,
}: {
  unidad: Unidad
  tipo: { icon: string; label: string }
  tipoColor: { bg: string; color: string }
  nContadores: number
  proyectoNombre?: string
  clienteAsignado?: Cliente
  canEdit: boolean
  onEdit: () => void
  onToggleActivo: () => void
  onEliminar: () => void
}) {
  const tag = getEditedTagInfo(u.updated_at, u.updated_by_name)
  return (
    <div
      style={{
        background: 'var(--at-surface)',
        borderRadius: 14,
        boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
        overflow: 'hidden',
        border: u.activo ? '1px solid var(--at-line)' : '1px solid var(--at-danger-border)',
        opacity: u.activo ? 1 : 0.75,
      }}
    >
      {/* Top stripe color por tipo */}
      <div style={{ height: 4, background: col.color }} />

      <div style={{ padding: 18 }}>
        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 24 }}>{tipo.icon}</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--at-ink)' }}>{u.nombre}</div>
              <span style={{
                display: 'inline-block', padding: '2px 9px',
                borderRadius: 10, background: col.bg, color: col.color,
                fontSize: 11, fontWeight: 600, marginTop: 2,
              }}>
                {tipo.label}
              </span>
              {proyectoNombre && (
                <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 3 }}>🏗️ {proyectoNombre}</div>
              )}
            </div>
          </div>
          <span style={{
            padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
            background: u.activo ? 'var(--at-success-tint)' : 'var(--at-danger-tint)',
            color: u.activo ? 'var(--at-success-strong)' : 'var(--at-danger-strong)', flexShrink: 0,
          }}>
            {u.activo ? 'Activa' : 'Inactiva'}
          </span>
        </div>

        {/* Details */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12, fontSize: 13, color: 'var(--at-ink-2)' }}>
          {(u.piso != null || u.area_m2 != null) && (
            <div style={{ display: 'flex', gap: 16 }}>
              {u.piso != null && <span>🏢 Piso {u.piso}</span>}
              {u.area_m2 != null && <span>📐 {formatNumber(Number(u.area_m2))} m²</span>}
            </div>
          )}
          {u.propietario_nombre && <div>👤 {u.propietario_nombre}</div>}
          {u.propietario_telefono && <div>📞 {u.propietario_telefono}</div>}
          {u.propietario_email && (
            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              ✉️ {u.propietario_email}
            </div>
          )}
          {u.descripcion && <div style={{ color: 'var(--at-ink-3)', fontStyle: 'italic' }}>{u.descripcion}</div>}
          {u.direccion && <div>📍 {u.direccion}</div>}
          {u.estado_ocupacional && (
            <div>
              <span style={{
                display: 'inline-block', padding: '2px 9px', borderRadius: 10,
                background: 'var(--at-primary-tint)', color: 'var(--at-primary-hover)', fontSize: 11, fontWeight: 600,
              }}>
                {ESTADOS_OCUPACIONALES.find(e => e.value === u.estado_ocupacional)?.label ?? u.estado_ocupacional}
              </span>
            </div>
          )}
          {u.contrato_suministro && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{
                padding: '2px 9px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                background: u.contrato_suministro === 'si' ? 'var(--at-success-tint)' : u.contrato_suministro === 'no' ? 'var(--at-danger-tint)' : 'var(--at-chip)',
                color:      u.contrato_suministro === 'si' ? 'var(--at-success-strong)' : u.contrato_suministro === 'no' ? 'var(--at-danger-strong)' : 'var(--at-ink-2)',
              }}>
                📄 Contrato: {CONTRATOS_SUMINISTRO.find(c => c.value === u.contrato_suministro)?.label ?? u.contrato_suministro}
              </span>
              {u.numero_contrato_suministro && (
                <span style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>#{u.numero_contrato_suministro}</span>
              )}
              {u.fecha_vencimiento_contrato && (
                <span style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>Vence: {formatDate(u.fecha_vencimiento_contrato)}</span>
              )}
            </div>
          )}
        </div>

        {/* Cliente asignado */}
        {clienteAsignado && (
          <div style={{ marginBottom: 8, fontSize: 13, color: 'var(--at-primary-hover)', fontWeight: 600 }}>
            👤 {clienteAsignado.nombre} <span style={{ fontWeight: 400, color: 'var(--at-ink-3)' }}>({clienteAsignado.codigo})</span>
          </div>
        )}

        {/* Contadores badge + edited tag */}
        <div style={{ marginBottom: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{
            padding: '4px 12px', borderRadius: 20,
            background: nContadores > 0 ? 'var(--at-primary-tint)' : 'var(--at-surface-2)',
            color: nContadores > 0 ? 'var(--at-primary-hover)' : 'var(--at-ink-3)',
            fontSize: 12, fontWeight: 600,
            border: `1px solid ${nContadores > 0 ? 'var(--at-primary-soft-2)' : 'var(--at-line)'}`,
          }}>
            🔧 {nContadores} contador{nContadores !== 1 ? 'es' : ''} asignado{nContadores !== 1 ? 's' : ''}
          </span>
          {tag && (
            <span
              title={tag.tooltip}
              style={{
                padding: '3px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500,
                color: tag.color, background: tag.bg, cursor: 'default',
              }}
            >
              {tag.label}
            </span>
          )}
        </div>

        {/* Actions */}
        {canEdit && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onEdit}
              style={{
                flex: 1, padding: '7px 0', background: 'var(--at-primary-tint)', color: 'var(--at-primary-hover)',
                border: 'none', borderRadius: 7, cursor: 'pointer', fontWeight: 600, fontSize: 12,
              }}
            >
              Editar
            </button>
            <button
              onClick={onToggleActivo}
              style={{
                flex: 1, padding: '7px 0',
                background: u.activo ? 'var(--at-warning-tint)' : 'var(--at-success-tint)',
                color: u.activo ? 'var(--at-warning-strong)' : 'var(--at-success-strong)',
                border: 'none', borderRadius: 7, cursor: 'pointer', fontWeight: 600, fontSize: 12,
              }}
            >
              {u.activo ? 'Desactivar' : 'Activar'}
            </button>
            <button
              onClick={onEliminar}
              style={{
                padding: '7px 12px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)',
                border: 'none', borderRadius: 7, cursor: 'pointer', fontWeight: 600, fontSize: 12,
              }}
            >
              Eliminar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export function pageBtnStyle(disabled: boolean): CSSProperties {
  return {
    padding: '6px 14px', borderRadius: 8,
    border: '1px solid var(--at-line)',
    background: disabled ? 'var(--at-chip)' : 'var(--at-surface)',
    color: disabled ? 'var(--at-line-strong)' : 'var(--at-ink-2)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: 600, fontSize: 12,
  }
}
