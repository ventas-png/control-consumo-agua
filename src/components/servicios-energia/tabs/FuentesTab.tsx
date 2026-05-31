import { useState } from 'react'
import type { FuenteEnergia, FuenteAgua, ProveedorEnergia, TarifaEnergia, Proyecto, UserSession, ModoSuministroEnergia } from '../../../types'
import { confirm, notify } from '../../shared/Dialog'
import { openPromptDialog } from '../../shared/PromptDialog'
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
      notify({ variant: 'error', title: 'Error', text: 'No se pudo identificar la empresa del usuario' })
      return
    }

    if (proyectos.length === 0) {
      notify({ variant: 'error', title: 'Error', text: 'Debe crear al menos un proyecto antes de crear una fuente de energía' })
      return
    }

    if (fuentesAgua.length === 0) {
      notify({ variant: 'error', title: 'Error', text: 'Debe crear al menos una fuente de agua antes de crear una fuente de energía' })
      return
    }

    const fields: Array<Parameters<typeof openPromptDialog>[0]['fields'][number]> = [
      { name: 'nombre', label: 'Nombre', placeholder: 'Bomba pozo norte', required: true, autoFocus: true },
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
        name: 'fuente_agua_id',
        label: 'Fuente de agua',
        control: 'select',
        required: true,
        options: fuentesAgua.map(f => ({ value: f.id, label: `${f.nombre} (${f.tipo_agua})` })),
      },
      {
        name: 'modo_suministro',
        label: 'Modo de suministro',
        control: 'select',
        required: true,
        initialValue: 'red',
        options: [
          { value: 'red', label: '🔌 Red eléctrica' },
          { value: 'solar_autonomo', label: '☀️ Solar autónomo' },
          { value: 'hibrido', label: '🔌☀️ Híbrido (red + solar)' },
        ],
        helpText: 'Si seleccionas Solar autónomo, los campos de red eléctrica se ignoran. Y viceversa.',
      },
      {
        name: 'proveedor_id',
        label: 'Proveedor (solo modo red/híbrido)',
        control: 'select',
        options: [
          { value: '', label: 'Sin proveedor' },
          ...proveedoresEnergia.map(p => ({ value: p.id, label: p.nombre })),
        ],
      },
      {
        name: 'tarifa_id',
        label: 'Tarifa (solo modo red/híbrido)',
        control: 'select',
        options: [
          { value: '', label: 'Sin tarifa' },
          ...tarifasEnergia.map(t => ({ value: t.id, label: t.nombre })),
        ],
      },
      { name: 'numero_medidor', label: 'Nº medidor (solo red/híbrido)' },
      { name: 'numero_cuenta', label: 'Nº cuenta NIS (solo red/híbrido)' },
      { name: 'potencia_contratada_kw', label: 'Potencia contratada kW (solo red/híbrido)', type: 'number', step: 0.01, initialValue: '0' },
      { name: 'capacidad_solar_kwp', label: 'Capacidad solar kWp (solo solar/híbrido)', type: 'number', step: 0.01, initialValue: '0' },
    )

    const result = await openPromptDialog({
      title: 'Nueva Fuente de Energía',
      fields,
      submitText: 'Crear',
      validate: (data) => {
        if (!data.nombre?.trim()) return 'El nombre es requerido'
        if (proyectos.length > 1 && !data.project_id) return 'Debe seleccionar un proyecto'
        if (!data.fuente_agua_id) return 'Debe seleccionar una fuente de agua'
        return null
      },
    })

    if (!result) return
    const modo = result.modo_suministro
    const formValues: Record<string, unknown> = {
      nombre: sanitizeInput(result.nombre),
      fuente_agua_id: result.fuente_agua_id,
      modo_suministro: modo,
      project_id: proyectos.length > 1 ? result.project_id : (defaultProjectId ?? ''),
      company_id: companyId,
      activo: true,
    }
    if (modo === 'red' || modo === 'hibrido') {
      formValues.proveedor_id = result.proveedor_id || null
      formValues.tarifa_id = result.tarifa_id || null
      formValues.numero_medidor = sanitizeInput(result.numero_medidor) || null
      formValues.numero_cuenta = sanitizeInput(result.numero_cuenta) || null
      const pot = parseFloat(result.potencia_contratada_kw || '0')
      formValues.potencia_contratada_kw = pot > 0 ? pot : null
    }
    if (modo === 'solar_autonomo' || modo === 'hibrido') {
      const kwp = parseFloat(result.capacidad_solar_kwp || '0')
      formValues.capacidad_solar_kwp = kwp > 0 ? kwp : null
    }

    try {
      const { data, error } = await supabase.from('fuentes_energia').insert([formValues]).select().single()
      if (error) throw error
      onFuenteAdded(data as FuenteEnergia)
      notify({ variant: 'success', title: 'Fuente de energía creada', duration: 1500 })
    } catch (err: unknown) {
      notify({ variant: 'error', title: 'Error', text: err instanceof Error ? err.message : 'No se pudo crear la fuente de energía' })
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
      notify({ variant: 'success', title: 'Fuente actualizada', duration: 1500 })
    } catch (err: unknown) {
      notify({ variant: 'error', title: 'Error', text: err instanceof Error ? err.message : 'No se pudo actualizar la fuente' })
    }
  }

  const handleDelete = async (id: string, nombre: string) => {
    const { isConfirmed } = await confirm({
      title: '¿Eliminar fuente?',
      text: `${nombre} y todas sus facturas serán eliminadas.`,
      icon: 'warning',
      variant: 'danger',
      confirmText: 'Eliminar',
    })
    if (!isConfirmed) return
    try {
      const { error } = await supabase.from('fuentes_energia').delete().eq('id', id)
      if (error) throw error
      onFuenteDeleted(id)
      notify({ variant: 'success', title: 'Fuente eliminada', duration: 1500 })
    } catch (err: unknown) {
      notify({ variant: 'error', title: 'Error', text: err instanceof Error ? err.message : 'No se pudo eliminar la fuente' })
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
