import { useState, useEffect } from 'react'
import { notify, confirm } from '../shared/Dialog'
import { EditModal } from '../shared/EditModal'
import { Button } from '../shared/Button'
import type { Unidad, Cliente, TipoResidente } from '../../types'
import { fetchResidentesDeUnidad, addResidente, removeResidente, setResponsablePago, type ResidenteConCliente } from '../../domain/unidades/residentes'

const TIPOS: { value: TipoResidente; label: string }[] = [
  { value: 'propietario', label: 'Propietario' },
  { value: 'arrendatario', label: 'Inquilino' },
  { value: 'familiar', label: 'Familiar' },
  { value: 'otro', label: 'Otro' },
]

const TIPO_LABEL = (t: string) => TIPOS.find(x => x.value === t)?.label ?? t

interface Props {
  unidad: Unidad
  clientes: Cliente[]
  onClose: () => void
}

/**
 * Portal propietario/inquilino (fase 3): gestiona los residentes de una unidad.
 * Asignar un residente lo habilita a ver los datos de la unidad en su portal (los
 * helpers RLS ya unen `unidad_residentes`). Permite que una unidad tenga propietario
 * E inquilino a la vez, cada uno con su propio login.
 */
export function UnidadResidentesModal({ unidad, clientes, onClose }: Props) {
  const [residentes, setResidentes] = useState<ResidenteConCliente[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [clienteId, setClienteId] = useState('')
  const [tipo, setTipo] = useState<TipoResidente>('arrendatario')

  async function cargar() {
    setLoading(true)
    const { data, error } = await fetchResidentesDeUnidad(unidad.id)
    if (error) notify({ variant: 'error', title: 'No se pudieron cargar los residentes', text: error })
    setResidentes(data)
    setLoading(false)
  }
  useEffect(() => {
    void cargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unidad.id])

  const clientesOrdenados = [...clientes].sort((a, b) => a.nombre.localeCompare(b.nombre))

  async function handleAdd() {
    if (!clienteId) {
      notify({ variant: 'warning', title: 'Elegí un cliente' })
      return
    }
    if (residentes.some(r => r.cliente_id === clienteId && r.activo)) {
      notify({ variant: 'warning', title: 'Ese cliente ya es residente de la unidad' })
      return
    }
    setSaving(true)
    const { error } = await addResidente({
      unidad_id: unidad.id,
      cliente_id: clienteId,
      company_id: unidad.company_id,
      project_id: unidad.project_id,
      tipo,
      activo: true,
    })
    setSaving(false)
    if (error) {
      notify({ variant: 'error', title: 'No se pudo asignar', text: error })
      return
    }
    notify({ variant: 'success', title: 'Residente asignado', duration: 1600 })
    setClienteId('')
    void cargar()
  }

  async function handleRemove(r: ResidenteConCliente) {
    const { isConfirmed } = await confirm({
      title: '¿Quitar residente?',
      text: `${r.cliente_nombre ?? 'Este residente'} dejará de ver la unidad en su portal.`,
      icon: 'warning',
      variant: 'danger',
      confirmText: 'Sí, quitar',
    })
    if (!isConfirmed) return
    const { error } = await removeResidente(r.id)
    if (error) {
      notify({ variant: 'error', title: 'Error', text: error })
      return
    }
    void cargar()
  }

  async function handlePagador(r: ResidenteConCliente) {
    const quitar = !!r.responsable_pago
    setSaving(true)
    const { error } = await setResponsablePago(unidad.id, quitar ? null : r.id)
    setSaving(false)
    if (error) {
      notify({ variant: 'error', title: 'No se pudo cambiar el pagador', text: error })
    } else {
      notify({
        variant: 'success',
        title: quitar ? 'La unidad quedó sin pagador designado' : 'Pagador designado',
        text: 'Los cargos ya emitidos conservan su responsable.',
        duration: 2200,
      })
    }
    void cargar()
  }

  const selectStyle = { width: '100%', padding: '10px', borderRadius: 8, border: '1.5px solid var(--at-line)', fontSize: 14, fontFamily: 'inherit', boxSizing: 'border-box' as const }

  return (
    <EditModal
      title={`👥 Residentes — ${unidad.nombre}`}
      size="sm"
      onClose={onClose}
      fullScreenOnMobile
      // Asignando o cambiando el pagador: ni Escape ni el fondo la cierran.
      closeOnBackdropClick={!saving}
      closeOnEscape={!saving}
      footer={<Button variant="secondary" onClick={onClose}>Cerrar</Button>}
    >
      <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--at-ink-3)' }}>
        Una unidad puede tener propietario e inquilino a la vez. Cada residente asignado ve
        los datos de la unidad en su propio portal. El <strong>pagador designado</strong> es a
        quien se le atribuyen los cargos nuevos sin rol responsable; cambiarlo no mueve cargos
        ya emitidos.
      </p>

      {/* Lista de residentes */}
      <div style={{ marginBottom: 20 }}>
        {loading ? (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--at-ink-3)', fontSize: 13 }}>Cargando…</div>
        ) : residentes.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', color: 'var(--at-ink-3)', fontSize: 13, background: 'var(--at-surface-2)', borderRadius: 10 }}>
            Sin residentes asignados todavía.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {residentes.map(r => (
              // flexWrap + base de 160px para el nombre: en el teléfono la
              // etiqueta y los botones bajan de línea en vez de dejar el nombre
              // en una franja de pocos píxeles.
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', border: '1px solid var(--at-line)', borderRadius: 10, background: r.activo ? 'var(--at-surface)' : 'var(--at-surface-2)' }}>
                <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--at-ink)' }}>{r.cliente_nombre ?? '—'}</div>
                  <div style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>
                    {r.cliente_codigo ? `${r.cliente_codigo} · ` : ''}{TIPO_LABEL(r.tipo)}{!r.activo ? ' · inactivo' : ''}
                  </div>
                </div>
                <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: r.tipo === 'propietario' ? 'var(--at-primary-tint)' : 'var(--at-warning-tint)', color: r.tipo === 'propietario' ? 'var(--at-primary-hover)' : 'var(--at-warning-strong)' }}>
                  {TIPO_LABEL(r.tipo)}
                </span>
                {r.activo && (
                  <button
                    type="button"
                    onClick={() => void handlePagador(r)}
                    disabled={saving}
                    aria-pressed={!!r.responsable_pago}
                    title={r.responsable_pago ? 'Quitar como pagador designado' : 'Designar como pagador de la unidad'}
                    style={{ padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--at-line)', background: r.responsable_pago ? 'var(--at-success-tint, var(--at-primary-tint))' : 'transparent', color: 'var(--at-ink-2)' }}
                  >
                    {r.responsable_pago ? '💳 Pagador' : 'Designar pagador'}
                  </button>
                )}
                <button onClick={() => void handleRemove(r)} title="Quitar residente" style={{ background: 'none', border: 'none', color: 'var(--at-danger)', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Alta de residente */}
      <div style={{ borderTop: '1px solid var(--at-line)', paddingTop: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--at-ink-2)', marginBottom: 10 }}>Asignar residente</div>
        {/* Cliente y tipo en una fila (tipo a 140px, como antes); si no caben
            —teléfono— cada uno baja a su propia línea a todo el ancho. Los
            factores de crecimiento 999:1 dejan casi todo el espacio libre al
            cliente cuando comparten fila. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          <select aria-label="Cliente" value={clienteId} onChange={e => setClienteId(e.target.value)} style={{ ...selectStyle, flex: '999 1 200px', width: 'auto', minWidth: 0 }}>
            <option value="">Elegí un cliente…</option>
            {clientesOrdenados.map(c => (
              <option key={c.id} value={c.id}>{c.nombre}{c.codigo ? ` (${c.codigo})` : ''}</option>
            ))}
          </select>
          <select aria-label="Tipo de residente" value={tipo} onChange={e => setTipo(e.target.value as TipoResidente)} style={{ ...selectStyle, flex: '1 0 140px', width: 'auto' }}>
            {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <Button variant="gradient-accent" onClick={() => void handleAdd()} loading={saving} loadingText="Asignando…" iconLeft={!saving ? '➕' : undefined}>
          Asignar
        </Button>
      </div>
    </EditModal>
  )
}
