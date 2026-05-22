import { useState } from 'react'
import type { FuenteEnergia, FuenteAgua, ProveedorEnergia, TarifaEnergia, Proyecto, UserSession, ModoSuministroEnergia } from '../../../types'
import Swal from 'sweetalert2'
import { EditModal } from '../../shared/EditModal'
import { sanitizeInput } from '../../../lib/validation'
import { supabase } from '../../../lib/supabase'

interface FuentesTabProps {
  fuentesEnergia: FuenteEnergia[]
  fuentesAgua: FuenteAgua[]
  proveedoresEnergia: ProveedorEnergia[]
  tarifasEnergia: TarifaEnergia[]
  proyectos: Proyecto[]
  currentUser: UserSession | null
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
  proyectos,
  currentUser,
  canCreate,
  canEdit,
  onFuenteAdded,
  onFuenteUpdated,
  onFuenteDeleted,
}: FuentesTabProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editFormData, setEditFormData] = useState<Partial<FuenteEnergia>>({})

  const companyId = currentUser?.company_id ?? null
  const defaultProjectId = proyectos.length === 1 ? proyectos[0].id : null

  const handleCreate = async () => {
    if (!companyId) {
      Swal.fire('Error', 'No se pudo identificar la empresa del usuario', 'error')
      return
    }

    if (proyectos.length === 0) {
      Swal.fire('Error', 'Debe crear al menos un proyecto antes de crear una fuente de energía', 'error')
      return
    }

    if (fuentesAgua.length === 0) {
      Swal.fire('Error', 'Debe crear al menos una fuente de agua antes de crear una fuente de energía', 'error')
      return
    }

    const proyectoOptions = proyectos.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('')
    const aguaOptions = fuentesAgua.map(f => `<option value="${f.id}">${f.nombre} (${f.tipo_agua})</option>`).join('')
    const proveedorOptions = proveedoresEnergia.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('')
    const tarifaOptions = tarifasEnergia.map(t => `<option value="${t.id}">${t.nombre}</option>`).join('')

    const { value: formValues } = await Swal.fire({
      title: 'Nueva Fuente de Energía',
      html: `
        <div style="text-align:left;max-height:480px;overflow-y:auto;padding-right:4px;">
          <label style="display:block;margin:0.4rem 0 0.2rem;font-weight:bold;">Nombre *</label>
          <input id="fe_nombre" placeholder="Bomba pozo norte" style="width:100%;padding:0.45rem;box-sizing:border-box;border:1px solid var(--at-line-strong);border-radius:4px;" />

          ${proyectos.length > 1 ? `
          <label style="display:block;margin:0.75rem 0 0.2rem;font-weight:bold;">Proyecto *</label>
          <select id="fe_project" style="width:100%;padding:0.45rem;box-sizing:border-box;border:1px solid var(--at-line-strong);border-radius:4px;">
            <option value="">Seleccionar proyecto</option>
            ${proyectoOptions}
          </select>
          ` : `<input type="hidden" id="fe_project" value="${defaultProjectId ?? ''}" />`}

          <label style="display:block;margin:0.75rem 0 0.2rem;font-weight:bold;">Fuente de agua *</label>
          <select id="fe_agua" style="width:100%;padding:0.45rem;box-sizing:border-box;border:1px solid var(--at-line-strong);border-radius:4px;">
            ${aguaOptions}
          </select>

          <label style="display:block;margin:0.75rem 0 0.2rem;font-weight:bold;">Modo de suministro *</label>
          <select id="fe_modo" onchange="
            const m=this.value;
            document.getElementById('fe_red_block').style.display=(m==='red'||m==='hibrido')?'block':'none';
            document.getElementById('fe_solar_block').style.display=(m==='solar_autonomo'||m==='hibrido')?'block':'none';
          " style="width:100%;padding:0.45rem;box-sizing:border-box;border:1px solid var(--at-line-strong);border-radius:4px;">
            <option value="red">🔌 Red eléctrica</option>
            <option value="solar_autonomo">☀️ Solar autónomo</option>
            <option value="hibrido">🔌☀️ Híbrido (red + solar)</option>
          </select>

          <div id="fe_red_block" style="margin-top:0.75rem;">
            <label style="display:block;margin-bottom:0.2rem;">Proveedor</label>
            <select id="fe_proveedor" style="width:100%;padding:0.45rem;box-sizing:border-box;border:1px solid var(--at-line-strong);border-radius:4px;">
              <option value="">Sin proveedor</option>
              ${proveedorOptions}
            </select>
            <label style="display:block;margin:0.5rem 0 0.2rem;">Tarifa</label>
            <select id="fe_tarifa" style="width:100%;padding:0.45rem;box-sizing:border-box;border:1px solid var(--at-line-strong);border-radius:4px;">
              <option value="">Sin tarifa</option>
              ${tarifaOptions}
            </select>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-top:0.5rem;">
              <div>
                <label style="display:block;margin-bottom:0.2rem;font-size:0.9rem;">Nº medidor</label>
                <input id="fe_medidor" style="width:100%;padding:0.45rem;box-sizing:border-box;border:1px solid var(--at-line-strong);border-radius:4px;" />
              </div>
              <div>
                <label style="display:block;margin-bottom:0.2rem;font-size:0.9rem;">Nº cuenta (NIS)</label>
                <input id="fe_cuenta" style="width:100%;padding:0.45rem;box-sizing:border-box;border:1px solid var(--at-line-strong);border-radius:4px;" />
              </div>
              <div>
                <label style="display:block;margin-bottom:0.2rem;font-size:0.9rem;">Potencia contratada (kW)</label>
                <input id="fe_potencia" type="number" step="0.01" value="0" style="width:100%;padding:0.45rem;box-sizing:border-box;border:1px solid var(--at-line-strong);border-radius:4px;" />
              </div>
            </div>
          </div>

          <div id="fe_solar_block" style="margin-top:0.75rem;display:none;">
            <label style="display:block;margin-bottom:0.2rem;">Capacidad solar (kWp)</label>
            <input id="fe_solar" type="number" step="0.01" value="0" style="width:100%;padding:0.45rem;box-sizing:border-box;border:1px solid var(--at-line-strong);border-radius:4px;" />
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Crear',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const nombre = (document.getElementById('fe_nombre') as HTMLInputElement)?.value?.trim() ?? ''
        const projectId = (document.getElementById('fe_project') as HTMLInputElement | HTMLSelectElement)?.value ?? ''
        const fuenteAguaId = (document.getElementById('fe_agua') as HTMLSelectElement)?.value ?? ''
        const modo = (document.getElementById('fe_modo') as HTMLSelectElement)?.value ?? 'red'

        if (!nombre) { Swal.showValidationMessage('El nombre es requerido'); return null }
        if (!projectId || projectId === 'null') { Swal.showValidationMessage('Debe seleccionar un proyecto'); return null }
        if (!fuenteAguaId) { Swal.showValidationMessage('Debe seleccionar una fuente de agua'); return null }

        const payload: Record<string, unknown> = {
          nombre: sanitizeInput(nombre),
          fuente_agua_id: fuenteAguaId,
          modo_suministro: modo,
          project_id: projectId,
          company_id: companyId,
          activo: true,
        }

        if (modo === 'red' || modo === 'hibrido') {
          const prov = (document.getElementById('fe_proveedor') as HTMLSelectElement)?.value
          const tar = (document.getElementById('fe_tarifa') as HTMLSelectElement)?.value
          payload.proveedor_id = prov || null
          payload.tarifa_id = tar || null
          payload.numero_medidor = sanitizeInput((document.getElementById('fe_medidor') as HTMLInputElement)?.value ?? '') || null
          payload.numero_cuenta = sanitizeInput((document.getElementById('fe_cuenta') as HTMLInputElement)?.value ?? '') || null
          const pot = parseFloat((document.getElementById('fe_potencia') as HTMLInputElement)?.value ?? '0')
          payload.potencia_contratada_kw = pot > 0 ? pot : null
        }

        if (modo === 'solar_autonomo' || modo === 'hibrido') {
          const kwp = parseFloat((document.getElementById('fe_solar') as HTMLInputElement)?.value ?? '0')
          payload.capacidad_solar_kwp = kwp > 0 ? kwp : null
        }

        return payload
      },
    })

    if (!formValues) return

    try {
      const { data, error } = await supabase.from('fuentes_energia').insert([formValues]).select().single()
      if (error) throw error
      onFuenteAdded(data as FuenteEnergia)
      Swal.fire({ icon: 'success', title: 'Fuente de energía creada', timer: 1500, showConfirmButton: false })
    } catch (err: unknown) {
      Swal.fire('Error', err instanceof Error ? err.message : 'No se pudo crear la fuente de energía', 'error')
    }
  }

  const handleStartEdit = (fuente: FuenteEnergia) => {
    setEditingId(fuente.id)
    setEditFormData({ ...fuente })
  }

  const handleSaveEdit = async () => {
    if (!editingId) return
    try {
      const { error } = await supabase
        .from('fuentes_energia')
        .update({ ...editFormData, updated_at: new Date().toISOString() })
        .eq('id', editingId)
      if (error) throw error
      onFuenteUpdated(editingId, editFormData)
      setEditingId(null)
      Swal.fire({ icon: 'success', title: 'Fuente actualizada', timer: 1500, showConfirmButton: false })
    } catch (err: unknown) {
      Swal.fire('Error', err instanceof Error ? err.message : 'No se pudo actualizar la fuente', 'error')
    }
  }

  const handleDelete = async (id: string, nombre: string) => {
    const { isConfirmed } = await Swal.fire({
      title: '¿Eliminar fuente?',
      html: `<b>${nombre}</b> y todas sus facturas serán eliminadas.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: 'var(--at-danger)',
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar',
    })
    if (!isConfirmed) return
    try {
      const { error } = await supabase.from('fuentes_energia').delete().eq('id', id)
      if (error) throw error
      onFuenteDeleted(id)
      Swal.fire({ icon: 'success', title: 'Fuente eliminada', timer: 1500, showConfirmButton: false })
    } catch (err: unknown) {
      Swal.fire('Error', err instanceof Error ? err.message : 'No se pudo eliminar la fuente', 'error')
    }
  }

  const modoLabel = (m: string) =>
    m === 'red' ? '🔌 Red' : m === 'solar_autonomo' ? '☀️ Solar' : '🔌☀️ Híbrido'

  return (
    <div>
      <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>Fuentes de Energía</h2>
        {canCreate && (
          <button onClick={handleCreate} style={{ padding: '0.5rem 1rem', backgroundColor: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            + Nueva Fuente
          </button>
        )}
      </div>

      {editingId && (
        <EditModal title="Editar Fuente de Energía" onClose={() => setEditingId(null)} maxWidth="500px">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.25rem' }}>Nombre *</label>
              <input type="text" value={editFormData.nombre ?? ''} onChange={e => setEditFormData(prev => ({ ...prev, nombre: e.target.value }))} style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box', border: '1px solid var(--at-line-strong)', borderRadius: '4px' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.25rem' }}>Modo de suministro</label>
              <select value={editFormData.modo_suministro ?? 'red'} onChange={e => setEditFormData(prev => ({ ...prev, modo_suministro: e.target.value as ModoSuministroEnergia }))} style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box', border: '1px solid var(--at-line-strong)', borderRadius: '4px' }}>
                <option value="red">🔌 Red eléctrica</option>
                <option value="solar_autonomo">☀️ Solar autónomo</option>
                <option value="hibrido">🔌☀️ Híbrido</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.25rem' }}>Número de medidor</label>
              <input type="text" value={editFormData.numero_medidor ?? ''} onChange={e => setEditFormData(prev => ({ ...prev, numero_medidor: e.target.value }))} style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box', border: '1px solid var(--at-line-strong)', borderRadius: '4px' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.25rem' }}>Número de cuenta (NIS)</label>
              <input type="text" value={editFormData.numero_cuenta ?? ''} onChange={e => setEditFormData(prev => ({ ...prev, numero_cuenta: e.target.value }))} style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box', border: '1px solid var(--at-line-strong)', borderRadius: '4px' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.25rem' }}>Potencia contratada (kW)</label>
              <input type="number" step="0.01" value={editFormData.potencia_contratada_kw ?? ''} onChange={e => setEditFormData(prev => ({ ...prev, potencia_contratada_kw: e.target.value === '' ? undefined : parseFloat(e.target.value) }))} style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box', border: '1px solid var(--at-line-strong)', borderRadius: '4px' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.25rem' }}>Capacidad solar (kWp)</label>
              <input type="number" step="0.01" value={editFormData.capacidad_solar_kwp ?? ''} onChange={e => setEditFormData(prev => ({ ...prev, capacidad_solar_kwp: e.target.value === '' ? undefined : parseFloat(e.target.value) }))} style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box', border: '1px solid var(--at-line-strong)', borderRadius: '4px' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input type="checkbox" id="fuente-activo" checked={editFormData.activo ?? false} onChange={e => setEditFormData(prev => ({ ...prev, activo: e.target.checked }))} />
              <label htmlFor="fuente-activo">Activa</label>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
              <button onClick={() => setEditingId(null)} style={{ padding: '0.5rem 1rem', border: '1px solid var(--at-line-strong)', borderRadius: '4px', cursor: 'pointer', background: 'var(--at-surface)' }}>Cancelar</button>
              <button onClick={handleSaveEdit} style={{ padding: '0.5rem 1rem', backgroundColor: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>Guardar</button>
            </div>
          </div>
        </EditModal>
      )}

      {fuentesEnergia.length === 0 ? (
        <p style={{ color: 'var(--at-ink-3)', fontStyle: 'italic', marginTop: '1.5rem' }}>No hay fuentes de energía registradas</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1.5rem', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ backgroundColor: 'var(--at-surface-2)', borderBottom: '2px solid var(--at-line)' }}>
              <th style={{ padding: '0.5rem', textAlign: 'left' }}>Nombre</th>
              <th style={{ padding: '0.5rem', textAlign: 'left' }}>Fuente de agua</th>
              <th style={{ padding: '0.5rem', textAlign: 'left' }}>Modo</th>
              <th style={{ padding: '0.5rem', textAlign: 'left' }}>Medidor</th>
              <th style={{ padding: '0.5rem', textAlign: 'left' }}>Capacidad</th>
              <th style={{ padding: '0.5rem', textAlign: 'left' }}>Estado</th>
              {canEdit && <th style={{ padding: '0.5rem', textAlign: 'center' }}>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {fuentesEnergia.map(f => {
              const fa = fuentesAgua.find(x => x.id === f.fuente_agua_id)
              return (
                <tr key={f.id} style={{ borderBottom: '1px solid var(--at-chip)' }}>
                  <td style={{ padding: '0.5rem' }}>{f.nombre}</td>
                  <td style={{ padding: '0.5rem' }}>{fa?.nombre ?? '—'}</td>
                  <td style={{ padding: '0.5rem' }}>{modoLabel(f.modo_suministro)}</td>
                  <td style={{ padding: '0.5rem' }}>{f.numero_medidor || '—'}</td>
                  <td style={{ padding: '0.5rem' }}>
                    {f.potencia_contratada_kw ? `${f.potencia_contratada_kw} kW` : ''}
                    {f.capacidad_solar_kwp ? `${f.capacidad_solar_kwp} kWp` : ''}
                    {!f.potencia_contratada_kw && !f.capacidad_solar_kwp ? '—' : ''}
                  </td>
                  <td style={{ padding: '0.5rem' }}>
                    <span style={{ color: f.activo ? 'var(--at-primary)' : 'var(--at-danger)' }}>{f.activo ? '● Activa' : '● Inactiva'}</span>
                  </td>
                  {canEdit && (
                    <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                      <button onClick={() => handleStartEdit(f)} style={{ marginRight: '0.5rem', padding: '0.25rem 0.75rem', backgroundColor: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>Editar</button>
                      <button onClick={() => handleDelete(f.id, f.nombre)} style={{ padding: '0.25rem 0.75rem', backgroundColor: 'var(--at-danger)', color: 'var(--at-on-status)', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>Eliminar</button>
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
