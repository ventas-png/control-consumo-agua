// Estilos y micro-componentes compartidos del módulo Contabilidad.
import type { CSSProperties, ReactNode } from 'react'
import { usePermissionsContext } from '../shared/PermissionsContext'

export function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, color: 'var(--at-ink-soft)' }}>
      {label}
      {children}
    </label>
  )
}

export const input: CSSProperties = {
  padding: '8px 10px',
  border: '1px solid var(--at-line)',
  borderRadius: 8,
  fontSize: 13,
  background: 'var(--at-surface)',
  color: 'var(--at-ink)',
}

export const btnPrimario: CSSProperties = {
  padding: '8px 14px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--at-accent)',
  color: '#fff',
  fontWeight: 700,
  fontSize: 13,
  cursor: 'pointer',
}

export const btnSecundario: CSSProperties = {
  padding: '8px 14px',
  borderRadius: 8,
  border: '1px solid var(--at-line)',
  background: 'var(--at-surface)',
  color: 'var(--at-ink)',
  fontWeight: 600,
  fontSize: 13,
  cursor: 'pointer',
}

export const btnLink: CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: 'var(--at-accent)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  padding: 0,
}

export const btnPeligro: CSSProperties = {
  ...btnSecundario,
  color: 'var(--at-danger)',
  borderColor: 'var(--at-danger)',
}

/**
 * Permisos de acción del módulo Contabilidad para el usuario actual.
 *
 * El módulo se gatea con la clave `contabilidad` (platform.contabilidad.<accion>).
 * Las acciones espejan las que exige la BD tras 20260818000000: crear / editar /
 * cambiar estado (publicar, anular, conciliar, activar) / autorizar (aprobar
 * factura u orden) / eliminar. Sin esto, un rol con solo `view` vería botones
 * que la RLS rechaza.
 */
export function usePermisosContabilidad() {
  const perms = usePermissionsContext()
  return {
    puedeCrear: perms.canCreate('contabilidad'),
    puedeEditar: perms.canEdit('contabilidad'),
    puedeCambiarEstado: perms.canChangeStatus('contabilidad'),
    puedeAutorizar: perms.canApprove('contabilidad'),
    puedeEliminar: perms.canDelete('contabilidad'),
  }
}
