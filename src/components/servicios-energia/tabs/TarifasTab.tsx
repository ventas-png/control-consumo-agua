import { useState } from 'react'
import type { TarifaEnergia, ProveedorEnergia, Proyecto } from '../../../types'
import { confirm, notify } from '../../shared/Dialog'
import { openPromptDialog } from '../../shared/PromptDialog'
import { EditModal } from '../../shared/EditModal'
import { sanitizeInput } from '../../../lib/validation'
import { useCrearTarifaEnergiaMutation, useActualizarTarifaEnergiaMutation, useEliminarTarifaEnergiaMutation } from '../../../domain/energia/mutations'

interface TarifasTabProps {
  tarifasEnergia: TarifaEnergia[]
  proveedoresEnergia: ProveedorEnergia[]
  proyectos: Proyecto[]
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  /** RBAC granular: permiso de eliminar (default true para no romper usos existentes) */
  canDelete?: boolean
}

export default function TarifasTab({
  tarifasEnergia,
  proveedoresEnergia,
  proyectos,
  companyId,
  moneda,
  canCreate,
  canEdit,
  canDelete = true,
}: TarifasTabProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editFormData, setEditFormData] = useState<Partial<TarifaEnergia>>({})

  const defaultProjectId = proyectos.length === 1 ? proyectos[0].id : null

  const crearMutation = useCrearTarifaEnergiaMutation(companyId)
  const actualizarMutation = useActualizarTarifaEnergiaMutation(companyId)
  const eliminarMutation = useEliminarTarifaEnergiaMutation(companyId)

  const handleCreate = async () => {
    if (!companyId) {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo identificar la empresa del usuario' })
      return
    }

    if (proyectos.length === 0) {
      notify({ variant: 'error', title: 'Error', text: 'Debe crear al menos un proyecto antes de crear una tarifa' })
      return
    }

    if (proveedoresEnergia.length === 0) {
      notify({ variant: 'error', title: 'Error', text: 'Debe crear al menos un proveedor antes de crear una tarifa' })
      return
    }

    const fields: Array<Parameters<typeof openPromptDialog>[0]['fields'][number]> = [
      { name: 'nombre', label: 'Nombre', placeholder: 'Tarifa BT1', required: true, autoFocus: true },
    ]
    if (proyectos.length > 1) {
      fields.push({
        name: 'project_id',
        label: 'Proyecto',
        control: 'select',
        required: true,
        options: proyectos.map(p => ({ value: p.id, label: p.nombre })),
      })
    }
    fields.push(
      {
        name: 'proveedor_id',
        label: 'Proveedor',
        control: 'select',
        required: true,
        options: proveedoresEnergia.map(p => ({ value: p.id, label: p.nombre })),
      },
      { name: 'descripcion', label: 'Descripción', control: 'textarea', rows: 2 },
      { name: 'precio_kwh_energia', label: 'Precio kWh energía', type: 'number', step: 0.000001, initialValue: '0' },
      { name: 'precio_kw_potencia', label: 'Precio kW potencia', type: 'number', step: 0.0001, initialValue: '0' },
      { name: 'cargo_fijo', label: `Cargo fijo (${moneda})`, type: 'number', step: 0.01, initialValue: '0' },
      { name: 'alumbrado_publico', label: 'Alumbrado público', type: 'number', step: 0.0001, initialValue: '0' },
      {
        name: 'alumbrado_tipo',
        label: 'Tipo alumbrado',
        control: 'select',
        initialValue: 'fijo',
        options: [
          { value: 'fijo', label: `Fijo (${moneda})` },
          { value: 'porcentual', label: 'Porcentual (%)' },
        ],
      },
      { name: 'iva_porcentaje', label: 'IVA (%)', type: 'number', step: 0.01, initialValue: '12' },
      { name: 'precio_kwh_exportado', label: 'Precio kWh exportado', type: 'number', step: 0.000001, initialValue: '0' },
    )

    const result = await openPromptDialog({
      title: 'Nueva Tarifa de Energía',
      fields,
      submitText: 'Crear',
      validate: (data) => {
        if (!data.nombre?.trim()) return 'El nombre es requerido'
        if (proyectos.length > 1 && !data.project_id) return 'Debe seleccionar un proyecto'
        if (!data.proveedor_id) return 'Debe seleccionar un proveedor'
        return null
      },
    })

    if (!result) return
    const formValues = {
      nombre: sanitizeInput(result.nombre),
      proveedor_id: result.proveedor_id,
      project_id: proyectos.length > 1 ? result.project_id : (defaultProjectId ?? ''),
      company_id: companyId,
      descripcion: sanitizeInput(result.descripcion) || null,
      precio_kwh_energia: parseFloat(result.precio_kwh_energia || '0'),
      precio_kw_potencia: parseFloat(result.precio_kw_potencia || '0'),
      cargo_fijo: parseFloat(result.cargo_fijo || '0'),
      alumbrado_publico: parseFloat(result.alumbrado_publico || '0'),
      alumbrado_tipo: result.alumbrado_tipo,
      iva_porcentaje: parseFloat(result.iva_porcentaje || '0'),
      precio_kwh_exportado: parseFloat(result.precio_kwh_exportado || '0'),
      moneda,
      activa: true,
    }

    try {
      await crearMutation.mutateAsync(formValues as Parameters<typeof crearMutation.mutateAsync>[0])
      notify({ variant: 'success', title: 'Tarifa creada', duration: 1500 })
    } catch (err: unknown) {
      notify({ variant: 'error', title: 'Error', text: err instanceof Error ? err.message : 'No se pudo crear la tarifa' })
    }
  }

  const handleStartEdit = (tarifa: TarifaEnergia) => {
    setEditingId(tarifa.id)
    setEditFormData({ ...tarifa })
  }

  const handleSaveEdit = async () => {
    if (!editingId) return
    try {
      await actualizarMutation.mutateAsync({ id: editingId, patch: editFormData })
      setEditingId(null)
      notify({ variant: 'success', title: 'Tarifa actualizada', duration: 1500 })
    } catch (err: unknown) {
      notify({ variant: 'error', title: 'Error', text: err instanceof Error ? err.message : 'No se pudo actualizar la tarifa' })
    }
  }

  const handleDelete = async (id: string, nombre: string) => {
    const { isConfirmed } = await confirm({
      title: '¿Eliminar tarifa?',
      text: `${nombre} será eliminada permanentemente.`,
      icon: 'warning',
      variant: 'danger',
      confirmText: 'Eliminar',
    })
    if (!isConfirmed) return
    try {
      await eliminarMutation.mutateAsync(id)
      notify({ variant: 'success', title: 'Tarifa eliminada', duration: 1500 })
    } catch (err: unknown) {
      notify({ variant: 'error', title: 'Error', text: err instanceof Error ? err.message : 'No se pudo eliminar la tarifa' })
    }
  }

  return (
    <div>
      <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>Tarifas de Energía</h2>
        {canCreate && (
          <button onClick={handleCreate} style={{ padding: '0.5rem 1rem', backgroundColor: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            + Nueva Tarifa
          </button>
        )}
      </div>

      {editingId && (
        <EditModal title="Editar Tarifa" onClose={() => setEditingId(null)} maxWidth="520px">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.25rem' }}>Nombre *</label>
              <input type="text" value={editFormData.nombre ?? ''} onChange={e => setEditFormData(prev => ({ ...prev, nombre: e.target.value }))} style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box', border: '1px solid var(--at-line-strong)', borderRadius: '4px' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.25rem' }}>Descripción</label>
              <textarea value={editFormData.descripcion ?? ''} onChange={e => setEditFormData(prev => ({ ...prev, descripcion: e.target.value }))} rows={2} style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box', border: '1px solid var(--at-line-strong)', borderRadius: '4px' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <div>
                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.25rem' }}>Precio kWh (energía)</label>
                <input type="number" step="0.000001" value={editFormData.precio_kwh_energia ?? 0} onChange={e => setEditFormData(prev => ({ ...prev, precio_kwh_energia: parseFloat(e.target.value) || 0 }))} style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box', border: '1px solid var(--at-line-strong)', borderRadius: '4px' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.25rem' }}>Precio kW (potencia)</label>
                <input type="number" step="0.0001" value={editFormData.precio_kw_potencia ?? 0} onChange={e => setEditFormData(prev => ({ ...prev, precio_kw_potencia: parseFloat(e.target.value) || 0 }))} style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box', border: '1px solid var(--at-line-strong)', borderRadius: '4px' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.25rem' }}>Cargo fijo ({moneda})</label>
                <input type="number" step="0.01" value={editFormData.cargo_fijo ?? 0} onChange={e => setEditFormData(prev => ({ ...prev, cargo_fijo: parseFloat(e.target.value) || 0 }))} style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box', border: '1px solid var(--at-line-strong)', borderRadius: '4px' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.25rem' }}>Alumbrado público</label>
                <input type="number" step="0.0001" value={editFormData.alumbrado_publico ?? 0} onChange={e => setEditFormData(prev => ({ ...prev, alumbrado_publico: parseFloat(e.target.value) || 0 }))} style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box', border: '1px solid var(--at-line-strong)', borderRadius: '4px' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.25rem' }}>Tipo alumbrado</label>
                <select value={editFormData.alumbrado_tipo ?? 'fijo'} onChange={e => setEditFormData(prev => ({ ...prev, alumbrado_tipo: e.target.value as TarifaEnergia['alumbrado_tipo'] }))} style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box', border: '1px solid var(--at-line-strong)', borderRadius: '4px' }}>
                  <option value="fijo">Fijo</option>
                  <option value="porcentual">Porcentual (%)</option>
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.25rem' }}>IVA (%)</label>
                <input type="number" step="0.01" value={editFormData.iva_porcentaje ?? 0} onChange={e => setEditFormData(prev => ({ ...prev, iva_porcentaje: parseFloat(e.target.value) || 0 }))} style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box', border: '1px solid var(--at-line-strong)', borderRadius: '4px' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.25rem' }}>Precio kWh exportado</label>
                <input type="number" step="0.000001" value={editFormData.precio_kwh_exportado ?? 0} onChange={e => setEditFormData(prev => ({ ...prev, precio_kwh_exportado: parseFloat(e.target.value) || 0 }))} style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box', border: '1px solid var(--at-line-strong)', borderRadius: '4px' }} />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input type="checkbox" id="tarifa-activa" checked={editFormData.activa ?? false} onChange={e => setEditFormData(prev => ({ ...prev, activa: e.target.checked }))} />
              <label htmlFor="tarifa-activa">Activa</label>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
              <button onClick={() => setEditingId(null)} style={{ padding: '0.5rem 1rem', border: '1px solid var(--at-line-strong)', borderRadius: '4px', cursor: 'pointer', background: 'var(--at-surface)' }}>Cancelar</button>
              <button onClick={handleSaveEdit} style={{ padding: '0.5rem 1rem', backgroundColor: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Guardar</button>
            </div>
          </div>
        </EditModal>
      )}

      {tarifasEnergia.length === 0 ? (
        <p style={{ color: 'var(--at-ink-3)', fontStyle: 'italic', marginTop: '1.5rem' }}>No hay tarifas registradas</p>
      ) : (
        <div className="table-scroll-wrapper">
        <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse', marginTop: '1.5rem', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ backgroundColor: 'var(--at-surface-2)', borderBottom: '2px solid var(--at-line)' }}>
              <th style={{ padding: '0.5rem', textAlign: 'left' }}>Nombre</th>
              <th style={{ padding: '0.5rem', textAlign: 'left' }}>Proveedor</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>kWh</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>Cargo fijo</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>IVA%</th>
              <th style={{ padding: '0.5rem', textAlign: 'left' }}>Estado</th>
              {(canEdit || canDelete) && <th style={{ padding: '0.5rem', textAlign: 'center' }}>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {tarifasEnergia.map(t => {
              const prov = proveedoresEnergia.find(p => p.id === t.proveedor_id)
              return (
                <tr key={t.id} style={{ borderBottom: '1px solid var(--at-chip)' }}>
                  <td style={{ padding: '0.5rem' }}>{t.nombre}</td>
                  <td style={{ padding: '0.5rem' }}>{prov?.nombre ?? '—'}</td>
                  <td style={{ padding: '0.5rem', textAlign: 'right' }}>{Number(t.precio_kwh_energia).toFixed(4)}</td>
                  <td style={{ padding: '0.5rem', textAlign: 'right' }}>{moneda} {Number(t.cargo_fijo).toFixed(2)}</td>
                  <td style={{ padding: '0.5rem', textAlign: 'right' }}>{Number(t.iva_porcentaje).toFixed(2)}</td>
                  <td style={{ padding: '0.5rem' }}>
                    <span style={{ color: t.activa ? 'var(--at-primary)' : 'var(--at-danger)' }}>{t.activa ? '● Activa' : '● Inactiva'}</span>
                  </td>
                  {(canEdit || canDelete) && (
                    <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                      {canEdit && (
                        <button onClick={() => handleStartEdit(t)} style={{ marginRight: '0.5rem', padding: '0.25rem 0.75rem', backgroundColor: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>Editar</button>
                      )}
                      {canDelete && (
                        <button onClick={() => handleDelete(t.id, t.nombre)} style={{ padding: '0.25rem 0.75rem', backgroundColor: 'var(--at-danger)', color: 'var(--at-on-status)', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>Eliminar</button>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      )}
    </div>
  )
}
