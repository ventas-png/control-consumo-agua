import React, { useState } from 'react'
import type { FuenteEnergia, FuenteAgua, ProveedorEnergia, TarifaEnergia } from '../../../types'
import Swal from 'sweetalert2'
import { EditModal } from '../../shared/EditModal'
import { sanitizeInput } from '../../../lib/validation'
import { supabase } from '../../../lib/supabase'

interface FuentesTabProps {
  fuentesEnergia: FuenteEnergia[]
  fuentesAgua: FuenteAgua[]
  proveedoresEnergia: ProveedorEnergia[]
  tarifasEnergia: TarifaEnergia[]
  canCreate: boolean
  canEdit: boolean
  onFuenteAdded: (f: FuenteEnergia) => void
  onFuenteUpdated: (id: string, f: Partial<FuenteEnergia>) => void
  onFuenteDeleted: (id: string) => void
}

export default function FuentesTab({
  fuentesEnergia,
  fuentesAgua,
  proveedoresEnergia,
  tarifasEnergia,
  canCreate,
  canEdit,
  onFuenteAdded,
  onFuenteUpdated,
  onFuenteDeleted,
}: FuentesTabProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editFormData, setEditFormData] = useState<Partial<FuenteEnergia>>({})

  const handleCreate = async () => {
    if (fuentesAgua.length === 0) {
      Swal.fire('Error', 'Debe crear una fuente de agua antes de crear una fuente de energía', 'error')
      return
    }

    const { value: formValues } = await Swal.fire({
      title: 'Nueva Fuente de Energía',
      html: `
        <div style="text-align: left; max-height: 500px; overflow-y: auto;">
          <label style="display: block; margin: 0.5rem 0;">Nombre:</label>
          <input id="fuen_nombre" placeholder="Bomba pozo norte" style="width: 100%; padding: 0.5rem; box-sizing: border-box;" />

          <label style="display: block; margin: 0.5rem 0; margin-top: 1rem;">Fuente de agua:</label>
          <select id="fuen_agua_id" style="width: 100%; padding: 0.5rem; box-sizing: border-box;">
            ${fuentesAgua.map(f => `<option value="${f.id}">${f.nombre} (${f.tipo_agua})</option>`).join('')}
          </select>

          <label style="display: block; margin: 0.5rem 0; margin-top: 1rem;">Modo de suministro:</label>
          <select id="fuen_modo" onchange="document.getElementById('prov_opt').style.display = this.value === 'red' || this.value === 'hibrido' ? 'block' : 'none'; document.getElementById('solar_opt').style.display = this.value.includes('solar') ? 'block' : 'none';" style="width: 100%; padding: 0.5rem; box-sizing: border-box;">
            <option value="red">Red eléctrica</option>
            <option value="solar_autonomo">Solar autónomo</option>
            <option value="hibrido">Híbrido (red + solar)</option>
          </select>

          <div id="prov_opt" style="margin-top: 1rem;">
            <label style="display: block; margin: 0.5rem 0;">Proveedor:</label>
            <select id="fuen_proveedor" style="width: 100%; padding: 0.5rem; box-sizing: border-box;">
              <option value="">Seleccionar proveedor</option>
              ${proveedoresEnergia.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('')}
            </select>

            <label style="display: block; margin: 0.5rem 0; margin-top: 1rem;">Tarifa:</label>
            <select id="fuen_tarifa" style="width: 100%; padding: 0.5rem; box-sizing: border-box;">
              <option value="">Seleccionar tarifa</option>
              ${tarifasEnergia.map(t => `<option value="${t.id}">${t.nombre}</option>`).join('')}
            </select>

            <label style="display: block; margin: 0.5rem 0; margin-top: 1rem;">Número de medidor:</label>
            <input id="fuen_medidor" placeholder="MED-001" style="width: 100%; padding: 0.5rem; box-sizing: border-box;" />

            <label style="display: block; margin: 0.5rem 0; margin-top: 1rem;">Número de cuenta (NIS):</label>
            <input id="fuen_cuenta" placeholder="123456789" style="width: 100%; padding: 0.5rem; box-sizing: border-box;" />

            <label style="display: block; margin: 0.5rem 0; margin-top: 1rem;">Potencia contratada (kW):</label>
            <input id="fuen_potencia" type="number" step="0.01" value="0" style="width: 100%; padding: 0.5rem; box-sizing: border-box;" />
          </div>

          <div id="solar_opt" style="margin-top: 1rem; display: none;">
            <label style="display: block; margin: 0.5rem 0;">Capacidad solar (kWp):</label>
            <input id="fuen_solar" type="number" step="0.01" value="0" style="width: 100%; padding: 0.5rem; box-sizing: border-box;" />
          </div>
        </div>
      `,
      showCancelButton: true,
      didOpen: async () => {
        const modoSelect = document.getElementById('fuen_modo') as HTMLSelectElement
        if (modoSelect) modoSelect.dispatchEvent(new Event('change'))
      },
      preConfirm: () => {
        const nombre = (document.getElementById('fuen_nombre') as HTMLInputElement)?.value || ''
        const modo = (document.getElementById('fuen_modo') as HTMLSelectElement)?.value || 'red'

        if (!nombre.trim()) {
          Swal.showValidationMessage('El nombre es requerido')
          return null
        }

        const fuenteAguaId = (document.getElementById('fuen_agua_id') as HTMLSelectElement)?.value
        if (!fuenteAguaId) {
          Swal.showValidationMessage('Debe seleccionar una fuente de agua')
          return null
        }

        const data: any = {
          nombre: sanitizeInput(nombre),
          fuente_agua_id: fuenteAguaId,
          modo_suministro: modo,
          activo: true,
        }

        if (modo === 'red' || modo === 'hibrido') {
          data.proveedor_id = (document.getElementById('fuen_proveedor') as HTMLSelectElement)?.value || null
          data.tarifa_id = (document.getElementById('fuen_tarifa') as HTMLSelectElement)?.value || null
          data.numero_medidor = sanitizeInput((document.getElementById('fuen_medidor') as HTMLInputElement)?.value || '')
          data.numero_cuenta = sanitizeInput((document.getElementById('fuen_cuenta') as HTMLInputElement)?.value || '')
          data.potencia_contratada_kw = parseFloat((document.getElementById('fuen_potencia') as HTMLInputElement)?.value || '0')
        }

        if (modo === 'solar_autonomo' || modo === 'hibrido') {
          data.capacidad_solar_kwp = parseFloat((document.getElementById('fuen_solar') as HTMLInputElement)?.value || '0')
        }

        return data
      },
    })

    if (!formValues) return

    try {
      const { data, error } = await supabase.from('fuentes_energia').insert([formValues]).select()
      if (error) throw error
      if (data) onFuenteAdded(data[0] as FuenteEnergia)
      Swal.fire('Éxito', 'Fuente de energía creada', 'success')
    } catch (err: any) {
      Swal.fire('Error', err.message || 'No se pudo crear la fuente de energía', 'error')
    }
  }

  const handleStartEdit = (fuente: FuenteEnergia) => {
    setEditingId(fuente.id)
    setEditFormData(fuente)
  }

  const handleSaveEdit = async () => {
    if (!editingId) return

    try {
      const { error } = await supabase.from('fuentes_energia').update(editFormData).eq('id', editingId)
      if (error) throw error
      onFuenteUpdated(editingId, editFormData)
      setEditingId(null)
      Swal.fire('Éxito', 'Fuente de energía actualizada', 'success')
    } catch (err: any) {
      Swal.fire('Error', err.message || 'No se pudo actualizar la fuente de energía', 'error')
    }
  }

  const handleDelete = async (id: string, nombre: string) => {
    const { isConfirmed } = await Swal.fire({
      title: '¿Eliminar?',
      text: `¿Está seguro de que desea eliminar la fuente "${nombre}"?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      confirmButtonText: 'Eliminar',
    })

    if (!isConfirmed) return

    try {
      const { error } = await supabase.from('fuentes_energia').delete().eq('id', id)
      if (error) throw error
      onFuenteDeleted(id)
      Swal.fire('Éxito', 'Fuente de energía eliminada', 'success')
    } catch (err: any) {
      Swal.fire('Error', err.message || 'No se pudo eliminar la fuente de energía', 'error')
    }
  }

  return (
    <div>
      <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Fuentes de Energía</h2>
        {canCreate && (
          <button onClick={handleCreate} style={{ padding: '0.5rem 1rem', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            + Nueva Fuente
          </button>
        )}
      </div>

      {editingId && (
        <EditModal
          title="Editar Fuente de Energía"
          fields={[
            { key: 'nombre', label: 'Nombre', type: 'text', required: true },
            { key: 'modo_suministro', label: 'Modo de suministro', type: 'select', options: [{ value: 'red', label: 'Red eléctrica' }, { value: 'solar_autonomo', label: 'Solar autónomo' }, { value: 'hibrido', label: 'Híbrido' }] },
            { key: 'numero_medidor', label: 'Número de medidor', type: 'text' },
            { key: 'numero_cuenta', label: 'Número de cuenta (NIS)', type: 'text' },
            { key: 'potencia_contratada_kw', label: 'Potencia contratada (kW)', type: 'number', step: 0.01 },
            { key: 'capacidad_solar_kwp', label: 'Capacidad solar (kWp)', type: 'number', step: 0.01 },
            { key: 'activo', label: 'Activa', type: 'checkbox' },
          ]}
          data={editFormData}
          onClose={() => setEditingId(null)}
          onSave={handleSaveEdit}
        />
      )}

      <div style={{ marginTop: '1.5rem' }}>
        {fuentesEnergia.length === 0 ? (
          <p style={{ color: '#888', fontStyle: 'italic' }}>No hay fuentes de energía registradas</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ backgroundColor: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                <th style={{ padding: '0.5rem', textAlign: 'left' }}>Nombre</th>
                <th style={{ padding: '0.5rem', textAlign: 'left' }}>Fuente de agua</th>
                <th style={{ padding: '0.5rem', textAlign: 'left' }}>Modo</th>
                <th style={{ padding: '0.5rem', textAlign: 'left' }}>Medidor</th>
                <th style={{ padding: '0.5rem', textAlign: 'left' }}>Potencia/Solar</th>
                <th style={{ padding: '0.5rem', textAlign: 'left' }}>Estado</th>
                <th style={{ padding: '0.5rem', textAlign: 'center' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {fuentesEnergia.map(f => {
                const fuenteAgua = fuentesAgua.find(fa => fa.id === f.fuente_agua_id)
                const modoLabel = f.modo_suministro === 'red' ? '🔌' : f.modo_suministro === 'solar_autonomo' ? '☀️' : '🔌☀️'
                return (
                  <tr key={f.id} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '0.5rem' }}>{f.nombre}</td>
                    <td style={{ padding: '0.5rem' }}>{fuenteAgua?.nombre || '?'}</td>
                    <td style={{ padding: '0.5rem' }}>{modoLabel}</td>
                    <td style={{ padding: '0.5rem' }}>{f.numero_medidor || '-'}</td>
                    <td style={{ padding: '0.5rem' }}>{f.potencia_contratada_kw ? `${f.potencia_contratada_kw}kW` : (f.capacidad_solar_kwp ? `${f.capacidad_solar_kwp}kWp` : '-')}</td>
                    <td style={{ padding: '0.5rem' }}>{f.activo ? '✓ Activa' : '✗ Inactiva'}</td>
                    <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                      {canEdit && (
                        <>
                          <button onClick={() => handleStartEdit(f)} style={{ marginRight: '0.5rem', padding: '0.25rem 0.75rem', backgroundColor: '#0066cc', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '0.85rem' }}>
                            Editar
                          </button>
                          <button onClick={() => handleDelete(f.id, f.nombre)} style={{ padding: '0.25rem 0.75rem', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer', fontSize: '0.85rem' }}>
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
