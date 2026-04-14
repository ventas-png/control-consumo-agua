import React, { useState } from 'react'
import type { ProveedorEnergia } from '../../../types'
import Swal from 'sweetalert2'
import { EditModal } from '../../shared/EditModal'
import { sanitizeInput } from '../../../lib/validation'
import { supabase } from '../../../lib/supabase'

interface ProveedoresTabProps {
  proveedoresEnergia: ProveedorEnergia[]
  canCreate: boolean
  canEdit: boolean
  onProveedorAdded: (p: ProveedorEnergia) => void
  onProveedorUpdated: (id: string, p: Partial<ProveedorEnergia>) => void
  onProveedorDeleted: (id: string) => void
}

export default function ProveedoresTab({
  proveedoresEnergia,
  canCreate,
  canEdit,
  onProveedorAdded,
  onProveedorUpdated,
  onProveedorDeleted,
}: ProveedoresTabProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editFormData, setEditFormData] = useState<Partial<ProveedorEnergia>>({})

  const handleCreate = async () => {
    const { value: formValues } = await Swal.fire({
      title: 'Nuevo Proveedor de Energía',
      html: `
        <div style="text-align: left;">
          <label style="display: block; margin: 0.5rem 0;">Nombre:</label>
          <input id="prov_nombre" placeholder="EEGSA" style="width: 100%; padding: 0.5rem; box-sizing: border-box;" />
          <label style="display: block; margin: 0.5rem 0; margin-top: 1rem;">NIT:</label>
          <input id="prov_nit" placeholder="9999999-9" style="width: 100%; padding: 0.5rem; box-sizing: border-box;" />
          <label style="display: block; margin: 0.5rem 0; margin-top: 1rem;">Contacto:</label>
          <input id="prov_contacto" placeholder="2290-1234" style="width: 100%; padding: 0.5rem; box-sizing: border-box;" />
          <label style="display: block; margin: 0.5rem 0; margin-top: 1rem;">Tipo:</label>
          <select id="prov_tipo" style="width: 100%; padding: 0.5rem; box-sizing: border-box;">
            <option value="distribuidora">Distribuidora</option>
            <option value="comercializadora">Comercializadora</option>
            <option value="autogeneracion">Autogeneración</option>
          </select>
        </div>
      `,
      showCancelButton: true,
      didOpen: async () => {
        const { data: { user } } = await supabase.auth.getUser()
        // Pre-fill user info if needed
      },
      preConfirm: () => {
        const nombre = (document.getElementById('prov_nombre') as HTMLInputElement)?.value || ''
        const nit = (document.getElementById('prov_nit') as HTMLInputElement)?.value || ''
        const contacto = (document.getElementById('prov_contacto') as HTMLInputElement)?.value || ''
        const tipo = (document.getElementById('prov_tipo') as HTMLSelectElement)?.value || 'distribuidora'

        if (!nombre.trim()) {
          Swal.showValidationMessage('El nombre es requerido')
          return null
        }

        return { nombre: sanitizeInput(nombre), nit: sanitizeInput(nit), contacto: sanitizeInput(contacto), tipo }
      },
    })

    if (!formValues) return

    try {
      const { data, error } = await supabase.from('proveedores_energia').insert([formValues]).select()
      if (error) throw error
      if (data) onProveedorAdded(data[0] as ProveedorEnergia)
      Swal.fire('Éxito', 'Proveedor creado', 'success')
    } catch (err: any) {
      Swal.fire('Error', err.message || 'No se pudo crear el proveedor', 'error')
    }
  }

  const handleStartEdit = (proveedor: ProveedorEnergia) => {
    setEditingId(proveedor.id)
    setEditFormData(proveedor)
  }

  const handleSaveEdit = async () => {
    if (!editingId) return

    try {
      const { error } = await supabase
        .from('proveedores_energia')
        .update(editFormData)
        .eq('id', editingId)

      if (error) throw error
      onProveedorUpdated(editingId, editFormData)
      setEditingId(null)
      Swal.fire('Éxito', 'Proveedor actualizado', 'success')
    } catch (err: any) {
      Swal.fire('Error', err.message || 'No se pudo actualizar el proveedor', 'error')
    }
  }

  const handleDelete = async (id: string, nombre: string) => {
    const { isConfirmed } = await Swal.fire({
      title: '¿Eliminar?',
      text: `¿Está seguro de que desea eliminar "${nombre}"?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      confirmButtonText: 'Eliminar',
    })

    if (!isConfirmed) return

    try {
      const { error } = await supabase.from('proveedores_energia').delete().eq('id', id)
      if (error) throw error
      onProveedorDeleted(id)
      Swal.fire('Éxito', 'Proveedor eliminado', 'success')
    } catch (err: any) {
      Swal.fire('Error', err.message || 'No se pudo eliminar el proveedor', 'error')
    }
  }

  return (
    <div>
      <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Proveedores de Energía</h2>
        {canCreate && (
          <button onClick={handleCreate} style={{ padding: '0.5rem 1rem', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            + Nuevo Proveedor
          </button>
        )}
      </div>

      {editingId && (
        <EditModal
          title="Editar Proveedor"
          fields={[
            { key: 'nombre', label: 'Nombre', type: 'text', required: true },
            { key: 'nit', label: 'NIT', type: 'text' },
            { key: 'contacto', label: 'Contacto', type: 'text' },
            { key: 'tipo', label: 'Tipo', type: 'select', options: [{ value: 'distribuidora', label: 'Distribuidora' }, { value: 'comercializadora', label: 'Comercializadora' }, { value: 'autogeneracion', label: 'Autogeneración' }] },
            { key: 'activo', label: 'Activo', type: 'checkbox' },
          ]}
          data={editFormData}
          onClose={() => setEditingId(null)}
          onSave={handleSaveEdit}
        />
      )}

      <div style={{ marginTop: '1.5rem' }}>
        {proveedoresEnergia.length === 0 ? (
          <p style={{ color: '#888', fontStyle: 'italic' }}>No hay proveedores registrados</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                <th style={{ padding: '0.75rem', textAlign: 'left' }}>Nombre</th>
                <th style={{ padding: '0.75rem', textAlign: 'left' }}>NIT</th>
                <th style={{ padding: '0.75rem', textAlign: 'left' }}>Tipo</th>
                <th style={{ padding: '0.75rem', textAlign: 'left' }}>Contacto</th>
                <th style={{ padding: '0.75rem', textAlign: 'left' }}>Estado</th>
                <th style={{ padding: '0.75rem', textAlign: 'center' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {proveedoresEnergia.map(p => (
                <tr key={p.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '0.75rem' }}>{p.nombre}</td>
                  <td style={{ padding: '0.75rem' }}>{p.nit || '-'}</td>
                  <td style={{ padding: '0.75rem' }}>{p.tipo}</td>
                  <td style={{ padding: '0.75rem' }}>{p.contacto || '-'}</td>
                  <td style={{ padding: '0.75rem' }}>{p.activo ? '✓ Activo' : '✗ Inactivo'}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                    {canEdit && (
                      <>
                        <button onClick={() => handleStartEdit(p)} style={{ marginRight: '0.5rem', padding: '0.25rem 0.75rem', backgroundColor: '#0066cc', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>
                          Editar
                        </button>
                        <button onClick={() => handleDelete(p.id, p.nombre)} style={{ padding: '0.25rem 0.75rem', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>
                          Eliminar
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
