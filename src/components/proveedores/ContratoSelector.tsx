// Selector del contrato que AMPARA una orden de compra.
//
// Es opcional: una orden sin contrato se comporta como siempre. Solo se ofrecen los contratos ACTIVOS y
// VIGENTES hoy de ESE proveedor en ESTE proyecto, y cada opción dice su moneda y su límite (o que no tiene
// límite total). Lo que este componente NO hace es decidir: el servidor vuelve a comprobar proveedor,
// proyecto, empresa, moneda y vigencia al guardar, y otra vez al aprobar y emitir.
import { useId, type CSSProperties } from 'react'
import { useContratosParaOrdenQuery } from '../../domain/proveedores/contratosCompras'
import { hoyLocalISO } from '../../lib/format'
import type { ContratoProveedorCatalogo } from '../../types/proveedores'

const caja: CSSProperties = {
  padding: '8px 10px', border: '1px solid var(--at-line)', borderRadius: 8, fontSize: 13,
  background: 'var(--at-surface)', color: 'var(--at-ink)', width: '100%', boxSizing: 'border-box',
}

export function etiquetaContrato(c: ContratoProveedorCatalogo): string {
  const limite = c.monto_maximo != null
    ? `límite ${c.moneda ?? ''} ${c.monto_maximo.toLocaleString('es')}`.replace('  ', ' ')
    : 'sin límite total'
  const fin = c.fecha_fin ? `hasta ${c.fecha_fin}` : 'indefinido'
  return `${c.referencia ?? 'Sin referencia'} · ${c.moneda ?? 'moneda sin definir'} · ${limite} · ${fin}`
}

interface Props {
  companyId?: string
  projectId?: string | null
  proveedorId?: string | null
  value: string | null
  onChange: (contratoId: string | null, contrato: ContratoProveedorCatalogo | null) => void
  disabled?: boolean
  label?: string
}

export function ContratoSelector({
  companyId, projectId, proveedorId, value, onChange, disabled = false, label = 'Contrato (opcional)',
}: Props) {
  const uid = useId()
  const { data: contratos = [], isLoading } = useContratosParaOrdenQuery(companyId, projectId, proveedorId, hoyLocalISO())

  if (!projectId) {
    return (
      <p data-testid="contrato-sin-proyecto" style={{ margin: 0, fontSize: 11, color: 'var(--at-ink-soft)' }}>
        Los contratos son de un proyecto: en la contabilidad de la empresa las órdenes no se amparan en uno.
      </p>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label htmlFor={uid} style={{ fontSize: 12, fontWeight: 600, color: 'var(--at-ink-soft)' }}>{label}</label>
      <select
        id={uid}
        value={value ?? ''}
        disabled={disabled || !proveedorId || isLoading}
        onChange={(e) => {
          const id = e.target.value || null
          onChange(id, contratos.find((c) => c.id === id) ?? null)
        }}
        style={caja}
      >
        <option value="">Sin contrato</option>
        {contratos.map((c) => <option key={c.id} value={c.id}>{etiquetaContrato(c)}</option>)}
      </select>
      <span data-testid="contrato-ayuda" style={{ fontSize: 11, color: 'var(--at-ink-soft)' }}>
        {!proveedorId
          ? 'Elige primero el proveedor.'
          : contratos.length === 0 && !isLoading
            ? 'Este proveedor no tiene contratos vigentes en este proyecto: la orden se compra sin contrato.'
            : 'Con contrato, aprobar y emitir exigen que siga vigente y dentro de su monto; una excepción la autoriza Contabilidad.'}
      </span>
    </div>
  )
}
