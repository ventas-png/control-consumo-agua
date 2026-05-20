import { useState } from 'react'
import type { ProveedorEnergia, Proyecto, UserSession } from '../../../types'
import Swal from 'sweetalert2'
import { EditModal } from '../../shared/EditModal'
import { sanitizeInput } from '../../../lib/validation'
import { supabase } from '../../../lib/supabase'

interface ProveedoresTabProps {
  proveedoresEnergia: ProveedorEnergia[]
  proyectos: Proyecto[]
  currentUser: UserSession | null
  canCreate: boolean
  canEdit: boolean
  onProveedorAdded: (p: ProveedorEnergia) => void
  onProveedorUpdated: (id: string, p: Partial<ProveedorEnergia>) => void
  onProveedorDeleted: (id: string) => void
}

export default function ProveedoresTab({
  proveedoresEnergia,
  proyectos,
  currentUser,
  canCreate,
  canEdit,
  onProveedorAdded,
  onProveedorUpdated,
  onProveedorDeleted,
}: ProveedoresTabProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editFormData, setEditFormData] = useState<Partial<ProveedorEnergia>>({})

  const companyId = currentUser?.company_id ?? null
  const defaultProjectId = proyectos.length === 1 ? proyectos[0].id : null

  const handleCreate = async () => {
    if (!companyId) {
      Swal.fire('Error', 'No se pudo identificar la empresa del usuario', 'error')
      return
    }

    if (proyectos.length === 0) {
      Swal.fire('Error', 'Debe crear al menos un proyecto antes de crear un proveedor', 'error')
      return
    }

    const proyectoOptions = proyectos.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('')

    const { value: formValues } = await Swal.fire({
      title: 'Nuevo Proveedor de Energía',
      html: `
        <div style="text-align: left;">
          <label style="display:block;margin:0.5rem 0;font-weight:bold;">Nombre *</label>
          <input id="prov_nombre" placeholder="EEGSA" style="width:100%;padding:0.5rem;box-sizing:border-box;border:1px solid var(--at-line-strong);border-radius:4px;" />

          ${proyectos.length > 1 ? `
          <label style="display:block;margin:0.75rem 0 0.25rem;font-weight:bold;">Proyecto *</label>
          <select id="prov_project" style="width:100%;padding:0.5rem;box-sizing:border-box;border:1px solid var(--at-line-strong);border-radius:4px;">
            <option value="">Seleccionar proyecto</option>
            ${proyectoOptions}
          </select>
          ` : `<input type="hidden" id="prov_project" value="${defaultProjectId ?? ''}" />`}

          <label style="display:block;margin:0.75rem 0 0.25rem;">NIT</label>
          <input id="prov_nit" placeholder="9999999-9" style="width:100%;padding:0.5rem;box-sizing:border-box;border:1px solid var(--at-line-strong);border-radius:4px;" />

          <label style="display:block;margin:0.75rem 0 0.25rem;">Contacto</label>
          <input id="prov_contacto" placeholder="2290-1234" style="width:100%;padding:0.5rem;box-sizing:border-box;border:1px solid var(--at-line-strong);border-radius:4px;" />

          <label style="display:block;margin:0.75rem 0 0.25rem;">Tipo *</label>
          <select id="prov_tipo" style="width:100%;padding:0.5rem;box-sizing:border-box;border:1px solid var(--at-line-strong);border-radius:4px;">
            <option value="distribuidora">Distribuidora</option>
            <option value="comercializadora">Comercializadora</option>
            <option value="autogeneracion">Autogeneración</option>
          </select>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Crear',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const nombre = (document.getElementById('prov_nombre') as HTMLInputElement)?.value?.trim() ?? ''
        const projectId = (document.getElementById('prov_project') as HTMLInputElement | HTMLSelectElement)?.value ?? ''
        const nit = (document.getElementById('prov_nit') as HTMLInputElement)?.value ?? ''
        const contacto = (document.getElementById('prov_contacto') as HTMLInputElement)?.value ?? ''
        const tipo = (document.getElementById('prov_tipo') as HTMLSelectElement)?.value ?? 'distribuidora'

        if (!nombre) { Swal.showValidationMessage('El nombre es requerido'); return null }
        if (!projectId || projectId === 'null') { Swal.showValidationMessage('Debe seleccionar un proyecto'); return null }

        return {
          nombre: sanitizeInput(nombre),
          nit: sanitizeInput(nit) || null,
          contacto: sanitizeInput(contacto) || null,
          tipo,
          project_id: projectId,
          company_id: companyId,
          activo: true,
        }
      },
    })

    if (!formValues) return

    try {
      const { data, error } = await supabase.from('proveedores_energia').insert([formValues]).select().single()
      if (error) throw error
      onProveedorAdded(data as ProveedorEnergia)
      Swal.fire({ icon: 'success', title: 'Proveedor creado', timer: 1500, showConfirmButton: false })
    } catch (err: unknown) {
      Swal.fire('Error', err instanceof Error ? err.message : 'No se pudo crear el proveedor', 'error')
    }
  }

  const handleStartEdit = (proveedor: ProveedorEnergia) => {
    setEditingId(proveedor.id)
    setEditFormData({ ...proveedor })
  }

  const handleSaveEdit = async () => {
    if (!editingId) return
    try {
      const { error } = await supabase
        .from('proveedores_energia')
        .update({ ...editFormData, updated_at: new Date().toISOString() })
        .eq('id', editingId)
      if (error) throw error
      onProveedorUpdated(editingId, editFormData)
      setEditingId(null)
      Swal.fire({ icon: 'success', title: 'Proveedor actualizado', timer: 1500, showConfirmButton: false })
    } catch (err: unknown) {
      Swal.fire('Error', err instanceof Error ? err.message : 'No se pudo actualizar el proveedor', 'error')
    }
  }

  const handleDelete = async (id: string, nombre: string) => {
    const { isConfirmed } = await Swal.fire({
      title: '¿Eliminar proveedor?',
      html: `<b>${nombre}</b> será eliminado permanentemente.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#dc2626',
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar',
    })
    if (!isConfirmed) return
    try {
      const { error } = await supabase.from('proveedores_energia').delete().eq('id', id)
      if (error) throw error
      onProveedorDeleted(id)
      Swal.fire({ icon: 'success', title: 'Proveedor eliminado', timer: 1500, showConfirmButton: false })
    } catch (err: unknown) {
      Swal.fire('Error', err instanceof Error ? err.message : 'No se pudo eliminar el proveedor', 'error')
    }
  }

  return (
    <div>
      <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>Proveedores de Energía</h2>
        {canCreate && (
          <button onClick={handleCreate} style={{ padding: '0.5rem 1rem', backgroundColor: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            + Nuevo Proveedor
          </button>
        )}
      </div>

      {editingId && (
        <EditModal title="Editar Proveedor" onClose={() => setEditingId(null)} maxWidth="480px">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.25rem' }}>Nombre *</label>
              <input type="text" value={editFormData.nombre ?? ''} onChange={e => setEditFormData(prev => ({ ...prev, nombre: e.target.value }))} style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box', border: '1px solid var(--at-line-strong)', borderRadius: '4px' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.25rem' }}>NIT</label>
              <input type="text" value={editFormData.nit ?? ''} onChange={e => setEditFormData(prev => ({ ...prev, nit: e.target.value }))} style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box', border: '1px solid var(--at-line-strong)', borderRadius: '4px' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.25rem' }}>Contacto</label>
              <input type="text" value={editFormData.contacto ?? ''} onChange={e => setEditFormData(prev => ({ ...prev, contacto: e.target.value }))} style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box', border: '1px solid var(--at-line-strong)', borderRadius: '4px' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.25rem' }}>Tipo</label>
              <select value={editFormData.tipo ?? 'distribuidora'} onChange={e => setEditFormData(prev => ({ ...prev, tipo: e.target.value as ProveedorEnergia['tipo'] }))} style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box', border: '1px solid var(--at-line-strong)', borderRadius: '4px' }}>
                <option value="distribuidora">Distribuidora</option>
                <option value="comercializadora">Comercializadora</option>
                <option value="autogeneracion">Autogeneración</option>
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input type="checkbox" id="prov-activo" checked={editFormData.activo ?? false} onChange={e => setEditFormData(prev => ({ ...prev, activo: e.target.checked }))} />
              <label htmlFor="prov-activo">Activo</label>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
              <button onClick={() => setEditingId(null)} style={{ padding: '0.5rem 1rem', border: '1px solid var(--at-line-strong)', borderRadius: '4px', cursor: 'pointer', background: 'var(--at-surface)' }}>Cancelar</button>
              <button onClick={handleSaveEdit} style={{ padding: '0.5rem 1rem', backgroundColor: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Guardar</button>
            </div>
          </div>
        </EditModal>
      )}

      {proveedoresEnergia.length === 0 ? (
        <p style={{ color: 'var(--at-ink-3)', fontStyle: 'italic', marginTop: '1.5rem' }}>No hay proveedores registrados</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1.5rem' }}>
          <thead>
            <tr style={{ backgroundColor: 'var(--at-surface-2)', borderBottom: '2px solid var(--at-line)' }}>
              <th style={{ padding: '0.75rem', textAlign: 'left' }}>Nombre</th>
              <th style={{ padding: '0.75rem', textAlign: 'left' }}>NIT</th>
              <th style={{ padding: '0.75rem', textAlign: 'left' }}>Tipo</th>
              <th style={{ padding: '0.75rem', textAlign: 'left' }}>Contacto</th>
              <th style={{ padding: '0.75rem', textAlign: 'left' }}>Estado</th>
              {canEdit && <th style={{ padding: '0.75rem', textAlign: 'center' }}>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {proveedoresEnergia.map(p => (
              <tr key={p.id} style={{ borderBottom: '1px solid var(--at-chip)' }}>
                <td style={{ padding: '0.75rem' }}>{p.nombre}</td>
                <td style={{ padding: '0.75rem' }}>{p.nit || '-'}</td>
                <td style={{ padding: '0.75rem', textTransform: 'capitalize' }}>{p.tipo}</td>
                <td style={{ padding: '0.75rem' }}>{p.contacto || '-'}</td>
                <td style={{ padding: '0.75rem' }}>
                  <span style={{ color: p.activo ? 'var(--at-primary)' : '#dc2626' }}>{p.activo ? '● Activo' : '● Inactivo'}</span>
                </td>
                {canEdit && (
                  <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                    <button onClick={() => handleStartEdit(p)} style={{ marginRight: '0.5rem', padding: '0.25rem 0.75rem', backgroundColor: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>
                      Editar
                    </button>
                    <button onClick={() => handleDelete(p.id, p.nombre)} style={{ padding: '0.25rem 0.75rem', backgroundColor: '#dc2626', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>
                      Eliminar
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
