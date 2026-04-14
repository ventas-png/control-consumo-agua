import React, { useState } from 'react'
import type { TarifaEnergia, ProveedorEnergia } from '../../../types'
import Swal from 'sweetalert2'
import { EditModal } from '../../shared/EditModal'
import { sanitizeInput, validateNumber } from '../../../lib/validation'
import { supabase } from '../../../lib/supabase'

interface TarifasTabProps {
  tarifasEnergia: TarifaEnergia[]
  proveedoresEnergia: ProveedorEnergia[]
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
  moneda,
  canCreate,
  canEdit,
  onTarifaAdded,
  onTarifaUpdated,
  onTarifaDeleted,
}: TarifasTabProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editFormData, setEditFormData] = useState<Partial<TarifaEnergia>>({})

  const handleCreate = async () => {
    if (proveedoresEnergia.length === 0) {
      Swal.fire('Error', 'Debe crear un proveedor antes de crear una tarifa', 'error')
      return
    }

    const { value: formValues } = await Swal.fire({
      title: 'Nueva Tarifa de Energía',
      html: `
        <div style="text-align: left; max-height: 500px; overflow-y: auto;">
          <label style="display: block; margin: 0.5rem 0;">Nombre:</label>
          <input id="tarif_nombre" placeholder="Tarifa BT1" style="width: 100%; padding: 0.5rem; box-sizing: border-box;" />

          <label style="display: block; margin: 0.5rem 0; margin-top: 1rem;">Proveedor:</label>
          <select id="tarif_proveedor" style="width: 100%; padding: 0.5rem; box-sizing: border-box;">
            ${proveedoresEnergia.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('')}
          </select>

          <label style="display: block; margin: 0.5rem 0; margin-top: 1rem;">Descripción:</label>
          <textarea id="tarif_desc" placeholder="Detalles" style="width: 100%; padding: 0.5rem; box-sizing: border-box;" rows="2"></textarea>

          <label style="display: block; margin: 0.5rem 0; margin-top: 1rem;">Precio kWh (energía):</label>
          <input id="tarif_kwh_energia" type="number" step="0.0001" value="0" style="width: 100%; padding: 0.5rem; box-sizing: border-box;" />

          <label style="display: block; margin: 0.5rem 0; margin-top: 1rem;">Precio kW (potencia):</label>
          <input id="tarif_kw_potencia" type="number" step="0.0001" value="0" style="width: 100%; padding: 0.5rem; box-sizing: border-box;" />

          <label style="display: block; margin: 0.5rem 0; margin-top: 1rem;">Cargo fijo ${moneda}:</label>
          <input id="tarif_cargo_fijo" type="number" step="0.01" value="0" style="width: 100%; padding: 0.5rem; box-sizing: border-box;" />

          <label style="display: block; margin: 0.5rem 0; margin-top: 1rem;">Alumbrado público:</label>
          <input id="tarif_alumbrado" type="number" step="0.01" value="0" style="width: 100%; padding: 0.5rem; box-sizing: border-box;" />

          <label style="display: block; margin: 0.5rem 0; margin-top: 0.5rem;">Tipo alumbrado:</label>
          <select id="tarif_alumbrado_tipo" style="width: 100%; padding: 0.5rem; box-sizing: border-box;">
            <option value="fijo">Fijo</option>
            <option value="porcentual">Porcentual (%)</option>
          </select>

          <label style="display: block; margin: 0.5rem 0; margin-top: 1rem;">IVA (%):</label>
          <input id="tarif_iva" type="number" step="0.01" value="0" style="width: 100%; padding: 0.5rem; box-sizing: border-box;" />

          <label style="display: block; margin: 0.5rem 0; margin-top: 1rem;">Precio kWh exportado:</label>
          <input id="tarif_kwh_exportado" type="number" step="0.0001" value="0" style="width: 100%; padding: 0.5rem; box-sizing: border-box;" />
        </div>
      `,
      showCancelButton: true,
      didOpen: async () => {
        const select = document.getElementById('tarif_proveedor') as HTMLSelectElement
        if (select && proveedoresEnergia.length > 0) select.value = proveedoresEnergia[0].id
      },
      preConfirm: () => {
        const nombre = (document.getElementById('tarif_nombre') as HTMLInputElement)?.value || ''
        if (!nombre.trim()) {
          Swal.showValidationMessage('El nombre es requerido')
          return null
        }

        return {
          nombre: sanitizeInput(nombre),
          proveedor_id: (document.getElementById('tarif_proveedor') as HTMLSelectElement)?.value,
          descripcion: sanitizeInput((document.getElementById('tarif_desc') as HTMLTextAreaElement)?.value || ''),
          precio_kwh_energia: parseFloat((document.getElementById('tarif_kwh_energia') as HTMLInputElement)?.value || '0'),
          precio_kw_potencia: parseFloat((document.getElementById('tarif_kw_potencia') as HTMLInputElement)?.value || '0'),
          cargo_fijo: parseFloat((document.getElementById('tarif_cargo_fijo') as HTMLInputElement)?.value || '0'),
          alumbrado_publico: parseFloat((document.getElementById('tarif_alumbrado') as HTMLInputElement)?.value || '0'),
          alumbrado_tipo: (document.getElementById('tarif_alumbrado_tipo') as HTMLSelectElement)?.value || 'fijo',
          iva_porcentaje: parseFloat((document.getElementById('tarif_iva') as HTMLInputElement)?.value || '0'),
          precio_kwh_exportado: parseFloat((document.getElementById('tarif_kwh_exportado') as HTMLInputElement)?.value || '0'),
          moneda,
          activa: true,
        }
      },
    })

    if (!formValues) return

    try {
      const { data, error } = await supabase.from('tarifas_energia').insert([formValues]).select()
      if (error) throw error
      if (data) onTarifaAdded(data[0] as TarifaEnergia)
      Swal.fire('Éxito', 'Tarifa creada', 'success')
    } catch (err: any) {
      Swal.fire('Error', err.message || 'No se pudo crear la tarifa', 'error')
    }
  }

  const handleStartEdit = (tarifa: TarifaEnergia) => {
    setEditingId(tarifa.id)
    setEditFormData(tarifa)
  }

  const handleSaveEdit = async () => {
    if (!editingId) return

    try {
      const { error } = await supabase.from('tarifas_energia').update(editFormData).eq('id', editingId)
      if (error) throw error
      onTarifaUpdated(editingId, editFormData)
      setEditingId(null)
      Swal.fire('Éxito', 'Tarifa actualizada', 'success')
    } catch (err: any) {
      Swal.fire('Error', err.message || 'No se pudo actualizar la tarifa', 'error')
    }
  }

  const handleDelete = async (id: string, nombre: string) => {
    const { isConfirmed } = await Swal.fire({
      title: '¿Eliminar?',
      text: `¿Está seguro de que desea eliminar la tarifa "${nombre}"?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      confirmButtonText: 'Eliminar',
    })

    if (!isConfirmed) return

    try {
      const { error } = await supabase.from('tarifas_energia').delete().eq('id', id)
      if (error) throw error
      onTarifaDeleted(id)
      Swal.fire('Éxito', 'Tarifa eliminada', 'success')
    } catch (err: any) {
      Swal.fire('Error', err.message || 'No se pudo eliminar la tarifa', 'error')
    }
  }

  return (
    <div>
      <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Tarifas de Energía</h2>
        {canCreate && (
          <button onClick={handleCreate} style={{ padding: '0.5rem 1rem', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            + Nueva Tarifa
          </button>
        )}
      </div>

      {editingId && (
        <EditModal
          title="Editar Tarifa"
          fields={[
            { key: 'nombre', label: 'Nombre', type: 'text', required: true },
            { key: 'descripcion', label: 'Descripción', type: 'textarea' },
            { key: 'precio_kwh_energia', label: 'Precio kWh (energía)', type: 'number', step: 0.0001 },
            { key: 'precio_kw_potencia', label: 'Precio kW (potencia)', type: 'number', step: 0.0001 },
            { key: 'cargo_fijo', label: `Cargo fijo ${moneda}`, type: 'number', step: 0.01 },
            { key: 'alumbrado_publico', label: 'Alumbrado público', type: 'number', step: 0.01 },
            { key: 'alumbrado_tipo', label: 'Tipo alumbrado', type: 'select', options: [{ value: 'fijo', label: 'Fijo' }, { value: 'porcentual', label: 'Porcentual (%)' }] },
            { key: 'iva_porcentaje', label: 'IVA (%)', type: 'number', step: 0.01 },
            { key: 'precio_kwh_exportado', label: 'Precio kWh exportado', type: 'number', step: 0.0001 },
            { key: 'activa', label: 'Activa', type: 'checkbox' },
          ]}
          data={editFormData}
          onClose={() => setEditingId(null)}
          onSave={handleSaveEdit}
        />
      )}

      <div style={{ marginTop: '1.5rem' }}>
        {tarifasEnergia.length === 0 ? (
          <p style={{ color: '#888', fontStyle: 'italic' }}>No hay tarifas registradas</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ backgroundColor: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                <th style={{ padding: '0.5rem', textAlign: 'left' }}>Nombre</th>
                <th style={{ padding: '0.5rem', textAlign: 'left' }}>Proveedor</th>
                <th style={{ padding: '0.5rem', textAlign: 'right' }}>kWh {moneda}</th>
                <th style={{ padding: '0.5rem', textAlign: 'right' }}>kW {moneda}</th>
                <th style={{ padding: '0.5rem', textAlign: 'right' }}>Fijo {moneda}</th>
                <th style={{ padding: '0.5rem', textAlign: 'left' }}>IVA%</th>
                <th style={{ padding: '0.5rem', textAlign: 'left' }}>Estado</th>
                <th style={{ padding: '0.5rem', textAlign: 'center' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {tarifasEnergia.map(t => {
                const proveedor = proveedoresEnergia.find(p => p.id === t.proveedor_id)
                return (
                  <tr key={t.id} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '0.5rem' }}>{t.nombre}</td>
                    <td style={{ padding: '0.5rem' }}>{proveedor?.nombre || '?'}</td>
                    <td style={{ padding: '0.5rem', textAlign: 'right' }}>{t.precio_kwh_energia.toFixed(4)}</td>
                    <td style={{ padding: '0.5rem', textAlign: 'right' }}>{t.precio_kw_potencia.toFixed(4)}</td>
                    <td style={{ padding: '0.5rem', textAlign: 'right' }}>{t.cargo_fijo.toFixed(2)}</td>
                    <td style={{ padding: '0.5rem' }}>{t.iva_porcentaje.toFixed(2)}</td>
                    <td style={{ padding: '0.5rem' }}>{t.activa ? '✓ Activa' : '✗ Inactiva'}</td>
                    <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                      {canEdit && (
                        <>
                          <button onClick={() => handleStartEdit(t)} style={{ marginRight: '0.5rem', padding: '0.25rem 0.75rem', backgroundColor: '#0066cc', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '0.85rem' }}>
                            Editar
                          </button>
                          <button onClick={() => handleDelete(t.id, t.nombre)} style={{ padding: '0.25rem 0.75rem', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '0.85rem' }}>
                            Eliminar
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
