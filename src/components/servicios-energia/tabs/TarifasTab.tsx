import { useState } from 'react'
import type { TarifaEnergia, ProveedorEnergia, Proyecto, UserSession } from '../../../types'
import Swal from 'sweetalert2'
import { EditModal } from '../../shared/EditModal'
import { sanitizeInput } from '../../../lib/validation'
import { supabase } from '../../../lib/supabase'

interface TarifasTabProps {
  tarifasEnergia: TarifaEnergia[]
  proveedoresEnergia: ProveedorEnergia[]
  proyectos: Proyecto[]
  currentUser: UserSession | null
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onTarifaAdded: (t: TarifaEnergia) => void
  onTarifaUpdated: (id: string, t: Partial<TarifaEnergia>) => void
  onTarifaDeleted: (id: string) => void
}

export default function TarifasTab({
  tarifasEnergia,
  proveedoresEnergia,
  proyectos,
  currentUser,
  moneda,
  canCreate,
  canEdit,
  onTarifaAdded,
  onTarifaUpdated,
  onTarifaDeleted,
}: TarifasTabProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editFormData, setEditFormData] = useState<Partial<TarifaEnergia>>({})

  const companyId = currentUser?.company_id ?? null
  const defaultProjectId = proyectos.length === 1 ? proyectos[0].id : null

  const handleCreate = async () => {
    if (!companyId) {
      Swal.fire('Error', 'No se pudo identificar la empresa del usuario', 'error')
      return
    }

    if (proyectos.length === 0) {
      Swal.fire('Error', 'Debe crear al menos un proyecto antes de crear una tarifa', 'error')
      return
    }

    if (proveedoresEnergia.length === 0) {
      Swal.fire('Error', 'Debe crear al menos un proveedor antes de crear una tarifa', 'error')
      return
    }

    const proyectoOptions = proyectos.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('')
    const proveedorOptions = proveedoresEnergia.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('')

    const { value: formValues } = await Swal.fire({
      title: 'Nueva Tarifa de Energía',
      html: `
        <div style="text-align:left;max-height:480px;overflow-y:auto;padding-right:4px;">
          <label style="display:block;margin:0.4rem 0 0.2rem;font-weight:bold;">Nombre *</label>
          <input id="t_nombre" placeholder="Tarifa BT1" style="width:100%;padding:0.45rem;box-sizing:border-box;border:1px solid var(--at-line-strong);border-radius:4px;" />

          ${proyectos.length > 1 ? `
          <label style="display:block;margin:0.75rem 0 0.2rem;font-weight:bold;">Proyecto *</label>
          <select id="t_project" style="width:100%;padding:0.45rem;box-sizing:border-box;border:1px solid var(--at-line-strong);border-radius:4px;">
            <option value="">Seleccionar proyecto</option>
            ${proyectoOptions}
          </select>
          ` : `<input type="hidden" id="t_project" value="${defaultProjectId ?? ''}" />`}

          <label style="display:block;margin:0.75rem 0 0.2rem;font-weight:bold;">Proveedor *</label>
          <select id="t_proveedor" style="width:100%;padding:0.45rem;box-sizing:border-box;border:1px solid var(--at-line-strong);border-radius:4px;">
            ${proveedorOptions}
          </select>

          <label style="display:block;margin:0.75rem 0 0.2rem;">Descripción</label>
          <textarea id="t_desc" rows="2" style="width:100%;padding:0.45rem;box-sizing:border-box;border:1px solid var(--at-line-strong);border-radius:4px;"></textarea>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-top:0.75rem;">
            <div>
              <label style="display:block;margin-bottom:0.2rem;font-size:0.9rem;">Precio kWh energía</label>
              <input id="t_kwh_e" type="number" step="0.000001" value="0" style="width:100%;padding:0.45rem;box-sizing:border-box;border:1px solid var(--at-line-strong);border-radius:4px;" />
            </div>
            <div>
              <label style="display:block;margin-bottom:0.2rem;font-size:0.9rem;">Precio kW potencia</label>
              <input id="t_kw_p" type="number" step="0.0001" value="0" style="width:100%;padding:0.45rem;box-sizing:border-box;border:1px solid var(--at-line-strong);border-radius:4px;" />
            </div>
            <div>
              <label style="display:block;margin-bottom:0.2rem;font-size:0.9rem;">Cargo fijo (${moneda})</label>
              <input id="t_fijo" type="number" step="0.01" value="0" style="width:100%;padding:0.45rem;box-sizing:border-box;border:1px solid var(--at-line-strong);border-radius:4px;" />
            </div>
            <div>
              <label style="display:block;margin-bottom:0.2rem;font-size:0.9rem;">Alumbrado público</label>
              <input id="t_alumbrado" type="number" step="0.0001" value="0" style="width:100%;padding:0.45rem;box-sizing:border-box;border:1px solid var(--at-line-strong);border-radius:4px;" />
            </div>
            <div>
              <label style="display:block;margin-bottom:0.2rem;font-size:0.9rem;">Tipo alumbrado</label>
              <select id="t_alumbrado_tipo" style="width:100%;padding:0.45rem;box-sizing:border-box;border:1px solid var(--at-line-strong);border-radius:4px;">
                <option value="fijo">Fijo (${moneda})</option>
                <option value="porcentual">Porcentual (%)</option>
              </select>
            </div>
            <div>
              <label style="display:block;margin-bottom:0.2rem;font-size:0.9rem;">IVA (%)</label>
              <input id="t_iva" type="number" step="0.01" value="12" style="width:100%;padding:0.45rem;box-sizing:border-box;border:1px solid var(--at-line-strong);border-radius:4px;" />
            </div>
            <div>
              <label style="display:block;margin-bottom:0.2rem;font-size:0.9rem;">Precio kWh exportado</label>
              <input id="t_kwh_exp" type="number" step="0.000001" value="0" style="width:100%;padding:0.45rem;box-sizing:border-box;border:1px solid var(--at-line-strong);border-radius:4px;" />
            </div>
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Crear',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const nombre = (document.getElementById('t_nombre') as HTMLInputElement)?.value?.trim() ?? ''
        const projectId = (document.getElementById('t_project') as HTMLInputElement | HTMLSelectElement)?.value ?? ''
        const proveedorId = (document.getElementById('t_proveedor') as HTMLSelectElement)?.value ?? ''

        if (!nombre) { Swal.showValidationMessage('El nombre es requerido'); return null }
        if (!projectId || projectId === 'null') { Swal.showValidationMessage('Debe seleccionar un proyecto'); return null }
        if (!proveedorId) { Swal.showValidationMessage('Debe seleccionar un proveedor'); return null }

        return {
          nombre: sanitizeInput(nombre),
          proveedor_id: proveedorId,
          project_id: projectId,
          company_id: companyId,
          descripcion: sanitizeInput((document.getElementById('t_desc') as HTMLTextAreaElement)?.value ?? '') || null,
          precio_kwh_energia: parseFloat((document.getElementById('t_kwh_e') as HTMLInputElement)?.value ?? '0'),
          precio_kw_potencia: parseFloat((document.getElementById('t_kw_p') as HTMLInputElement)?.value ?? '0'),
          cargo_fijo: parseFloat((document.getElementById('t_fijo') as HTMLInputElement)?.value ?? '0'),
          alumbrado_publico: parseFloat((document.getElementById('t_alumbrado') as HTMLInputElement)?.value ?? '0'),
          alumbrado_tipo: (document.getElementById('t_alumbrado_tipo') as HTMLSelectElement)?.value ?? 'fijo',
          iva_porcentaje: parseFloat((document.getElementById('t_iva') as HTMLInputElement)?.value ?? '0'),
          precio_kwh_exportado: parseFloat((document.getElementById('t_kwh_exp') as HTMLInputElement)?.value ?? '0'),
          moneda,
          activa: true,
        }
      },
    })

    if (!formValues) return

    try {
      const { data, error } = await supabase.from('tarifas_energia').insert([formValues]).select().single()
      if (error) throw error
      onTarifaAdded(data as TarifaEnergia)
      Swal.fire({ icon: 'success', title: 'Tarifa creada', timer: 1500, showConfirmButton: false })
    } catch (err: unknown) {
      Swal.fire('Error', err instanceof Error ? err.message : 'No se pudo crear la tarifa', 'error')
    }
  }

  const handleStartEdit = (tarifa: TarifaEnergia) => {
    setEditingId(tarifa.id)
    setEditFormData({ ...tarifa })
  }

  const handleSaveEdit = async () => {
    if (!editingId) return
    try {
      const { error } = await supabase
        .from('tarifas_energia')
        .update({ ...editFormData, updated_at: new Date().toISOString() })
        .eq('id', editingId)
      if (error) throw error
      onTarifaUpdated(editingId, editFormData)
      setEditingId(null)
      Swal.fire({ icon: 'success', title: 'Tarifa actualizada', timer: 1500, showConfirmButton: false })
    } catch (err: unknown) {
      Swal.fire('Error', err instanceof Error ? err.message : 'No se pudo actualizar la tarifa', 'error')
    }
  }

  const handleDelete = async (id: string, nombre: string) => {
    const { isConfirmed } = await Swal.fire({
      title: '¿Eliminar tarifa?',
      html: `<b>${nombre}</b> será eliminada permanentemente.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: 'var(--at-danger)',
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar',
    })
    if (!isConfirmed) return
    try {
      const { error } = await supabase.from('tarifas_energia').delete().eq('id', id)
      if (error) throw error
      onTarifaDeleted(id)
      Swal.fire({ icon: 'success', title: 'Tarifa eliminada', timer: 1500, showConfirmButton: false })
    } catch (err: unknown) {
      Swal.fire('Error', err instanceof Error ? err.message : 'No se pudo eliminar la tarifa', 'error')
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
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1.5rem', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ backgroundColor: 'var(--at-surface-2)', borderBottom: '2px solid var(--at-line)' }}>
              <th style={{ padding: '0.5rem', textAlign: 'left' }}>Nombre</th>
              <th style={{ padding: '0.5rem', textAlign: 'left' }}>Proveedor</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>kWh</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>Cargo fijo</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>IVA%</th>
              <th style={{ padding: '0.5rem', textAlign: 'left' }}>Estado</th>
              {canEdit && <th style={{ padding: '0.5rem', textAlign: 'center' }}>Acciones</th>}
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
                  {canEdit && (
                    <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                      <button onClick={() => handleStartEdit(t)} style={{ marginRight: '0.5rem', padding: '0.25rem 0.75rem', backgroundColor: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>Editar</button>
                      <button onClick={() => handleDelete(t.id, t.nombre)} style={{ padding: '0.25rem 0.75rem', backgroundColor: 'var(--at-danger)', color: 'var(--at-on-status)', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>Eliminar</button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
