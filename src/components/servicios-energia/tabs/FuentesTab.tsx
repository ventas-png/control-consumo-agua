import { useState } from 'react'
import type { FuenteEnergia, FuenteAgua, ProveedorEnergia, TarifaEnergia, Proyecto, ModoSuministroEnergia } from '../../../types'
import { confirm, notify } from '../../shared/Dialog'
import { openPromptDialog } from '../../shared/PromptDialog'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { sanitizeInput } from '../../../lib/validation'
import { useCrearFuenteEnergiaMutation, useActualizarFuenteEnergiaMutation, useEliminarFuenteEnergiaMutation } from '../../../domain/energia/mutations'
import { encabezadoTab, etiqueta, campo, rejilla, accionesFila } from '../ui'

interface FuentesTabProps {
  fuentesEnergia: FuenteEnergia[]
  fuentesAgua: FuenteAgua[]
  proveedoresEnergia: ProveedorEnergia[]
  tarifasEnergia: TarifaEnergia[]
  proyectos: Proyecto[]
  companyId: string
  canCreate: boolean
  canEdit: boolean
  /** RBAC granular: permiso de eliminar (default true para no romper usos existentes) */
  canDelete?: boolean
}

export default function FuentesTab({
  fuentesEnergia,
  fuentesAgua,
  proveedoresEnergia,
  tarifasEnergia,
  proyectos,
  companyId,
  canCreate,
  canEdit,
  canDelete = true,
}: FuentesTabProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editFormData, setEditFormData] = useState<Partial<FuenteEnergia>>({})

  const crearMutation = useCrearFuenteEnergiaMutation(companyId)
  const actualizarMutation = useActualizarFuenteEnergiaMutation(companyId)
  const eliminarMutation = useEliminarFuenteEnergiaMutation(companyId)

  const defaultProjectId = proyectos.length === 1 ? proyectos[0].id : null

  const handleCreate = async () => {
    if (proyectos.length === 0) {
      notify({ variant: 'error', title: 'Error', text: 'Debe crear al menos un proyecto antes de crear una fuente de energía' })
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
        // serv:S2 — Energía es servicio de 1er nivel: el vínculo con una fuente
        // de agua es opcional (puede no alimentar ningún pozo).
        name: 'fuente_agua_id',
        label: 'Fuente de agua asociada (opcional)',
        control: 'select',
        options: [
          { value: '', label: 'Sin fuente de agua asociada' },
          ...fuentesAgua.map(f => ({ value: f.id, label: `${f.nombre} (${f.tipo_agua})` })),
        ],
        helpText: 'Vincula esta energía a una fuente de agua (p. ej. bombeo de pozo). Déjalo vacío si es un servicio energético independiente.',
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
        return null
      },
    })

    if (!result) return
    const modo = result.modo_suministro
    const formValues: Record<string, unknown> = {
      nombre: sanitizeInput(result.nombre),
      fuente_agua_id: result.fuente_agua_id || null,
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
      await crearMutation.mutateAsync(formValues as Parameters<typeof crearMutation.mutateAsync>[0])
      notify({ variant: 'success', title: 'Fuente de energía creada', duration: 1500 })
    } catch (err: unknown) {
      notify({ variant: 'error', title: 'Error', text: err instanceof Error ? err.message : 'No se pudo crear la fuente de energía' })
    }
  }

  const handleStartEdit = (fuente: FuenteEnergia) => {
    setEditingId(fuente.id)
    setEditFormData({ ...fuente })
  }

  // No se cierra a mitad del guardado: cerrar ahí escondería el error.
  const guardando = actualizarMutation.isPending
  const cerrarEdicion = () => { if (!guardando) setEditingId(null) }

  const handleSaveEdit = async () => {
    if (!editingId || guardando) return
    try {
      await actualizarMutation.mutateAsync({ id: editingId, patch: editFormData })
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
      await eliminarMutation.mutateAsync(id)
      notify({ variant: 'success', title: 'Fuente eliminada', duration: 1500 })
    } catch (err: unknown) {
      notify({ variant: 'error', title: 'Error', text: err instanceof Error ? err.message : 'No se pudo eliminar la fuente' })
    }
  }

  const modoLabel = (m: string) =>
    m === 'red' ? '🔌 Red' : m === 'solar_autonomo' ? '☀️ Solar' : '🔌☀️ Híbrido'

  return (
    <div>
      <div style={encabezadoTab}>
        <h2 style={{ margin: 0 }}>Fuentes de Energía</h2>
        {canCreate && (
          <Button onClick={handleCreate}>+ Nueva Fuente</Button>
        )}
      </div>

      {editingId && (
        <EditModal
          title="Editar Fuente de Energía"
          onClose={cerrarEdicion}
          maxWidth="500px"
          fullScreenOnMobile
          closeOnBackdropClick={!guardando}
          closeOnEscape={!guardando}
          footer={
            <>
              <Button variant="secondary" onClick={cerrarEdicion} disabled={guardando}>Cancelar</Button>
              <Button type="submit" form="fuente-energia-form" loading={guardando} loadingText="Guardando...">Guardar</Button>
            </>
          }
        >
          <form
            id="fuente-energia-form"
            onSubmit={e => { e.preventDefault(); void handleSaveEdit() }}
            style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
          >
            <div>
              <label htmlFor="fuente-nombre" style={etiqueta}>Nombre *</label>
              <input id="fuente-nombre" type="text" value={editFormData.nombre ?? ''} onChange={e => setEditFormData(prev => ({ ...prev, nombre: e.target.value }))} style={campo} />
            </div>
            <div>
              <label htmlFor="fuente-modo" style={etiqueta}>Modo de suministro</label>
              <select id="fuente-modo" value={editFormData.modo_suministro ?? 'red'} onChange={e => setEditFormData(prev => ({ ...prev, modo_suministro: e.target.value as ModoSuministroEnergia }))} style={campo}>
                <option value="red">🔌 Red eléctrica</option>
                <option value="solar_autonomo">☀️ Solar autónomo</option>
                <option value="hibrido">🔌☀️ Híbrido</option>
              </select>
            </div>
            <div style={rejilla(150)}>
              <div>
                <label htmlFor="fuente-medidor" style={etiqueta}>Número de medidor</label>
                <input id="fuente-medidor" type="text" value={editFormData.numero_medidor ?? ''} onChange={e => setEditFormData(prev => ({ ...prev, numero_medidor: e.target.value }))} style={campo} />
              </div>
              <div>
                <label htmlFor="fuente-cuenta" style={etiqueta}>Número de cuenta (NIS)</label>
                <input id="fuente-cuenta" type="text" value={editFormData.numero_cuenta ?? ''} onChange={e => setEditFormData(prev => ({ ...prev, numero_cuenta: e.target.value }))} style={campo} />
              </div>
              <div>
                <label htmlFor="fuente-potencia" style={etiqueta}>Potencia contratada (kW)</label>
                <input id="fuente-potencia" type="number" inputMode="decimal" step="0.01" value={editFormData.potencia_contratada_kw ?? ''} onChange={e => setEditFormData(prev => ({ ...prev, potencia_contratada_kw: e.target.value === '' ? undefined : parseFloat(e.target.value) }))} style={campo} />
              </div>
              <div>
                <label htmlFor="fuente-solar" style={etiqueta}>Capacidad solar (kWp)</label>
                <input id="fuente-solar" type="number" inputMode="decimal" step="0.01" value={editFormData.capacidad_solar_kwp ?? ''} onChange={e => setEditFormData(prev => ({ ...prev, capacidad_solar_kwp: e.target.value === '' ? undefined : parseFloat(e.target.value) }))} style={campo} />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input type="checkbox" id="fuente-activo" checked={editFormData.activo ?? false} onChange={e => setEditFormData(prev => ({ ...prev, activo: e.target.checked }))} />
              <label htmlFor="fuente-activo">Activa</label>
            </div>
          </form>
        </EditModal>
      )}

      {fuentesEnergia.length === 0 ? (
        <p style={{ color: 'var(--at-ink-3)', fontStyle: 'italic', marginTop: '1.5rem' }}>No hay fuentes de energía registradas</p>
      ) : (
        <div className="table-scroll-wrapper">
        {/* En el teléfono cada fuente es una tarjeta con sus acciones al pie. */}
        <table className="table-cards-on-mobile" style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1.5rem', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ backgroundColor: 'var(--at-surface-2)', borderBottom: '2px solid var(--at-line)' }}>
              <th scope="col" style={{ padding: '0.5rem', textAlign: 'left' }}>Nombre</th>
              <th scope="col" style={{ padding: '0.5rem', textAlign: 'left' }}>Fuente de agua</th>
              <th scope="col" style={{ padding: '0.5rem', textAlign: 'left' }}>Modo</th>
              <th scope="col" style={{ padding: '0.5rem', textAlign: 'left' }}>Medidor</th>
              <th scope="col" style={{ padding: '0.5rem', textAlign: 'left' }}>Capacidad</th>
              <th scope="col" style={{ padding: '0.5rem', textAlign: 'left' }}>Estado</th>
              {(canEdit || canDelete) && <th scope="col" style={{ padding: '0.5rem', textAlign: 'center' }}>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {fuentesEnergia.map(f => {
              const fa = fuentesAgua.find(x => x.id === f.fuente_agua_id)
              // Un híbrido tiene las dos: antes salían pegadas ("10 kW12.5 kWp").
              const capacidad = [
                f.potencia_contratada_kw ? `${f.potencia_contratada_kw} kW` : null,
                f.capacidad_solar_kwp ? `${f.capacidad_solar_kwp} kWp` : null,
              ].filter(Boolean).join(' · ') || '—'
              return (
                <tr key={f.id} style={{ borderBottom: '1px solid var(--at-chip)' }}>
                  <td data-label="Nombre" style={{ padding: '0.5rem', fontWeight: 600 }}>{f.nombre}</td>
                  <td data-label="Fuente de agua" style={{ padding: '0.5rem' }}>{fa?.nombre ?? '—'}</td>
                  <td data-label="Modo" style={{ padding: '0.5rem' }}>{modoLabel(f.modo_suministro)}</td>
                  <td data-label="Medidor" style={{ padding: '0.5rem' }}>{f.numero_medidor || '—'}</td>
                  <td data-label="Capacidad" style={{ padding: '0.5rem' }}>{capacidad}</td>
                  <td data-label="Estado" style={{ padding: '0.5rem' }}>
                    <span style={{ color: f.activo ? 'var(--at-primary)' : 'var(--at-danger)' }}>{f.activo ? '● Activa' : '● Inactiva'}</span>
                  </td>
                  {(canEdit || canDelete) && (
                    <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                      <div style={accionesFila}>
                        {canEdit && (
                          <Button size="sm" onClick={() => handleStartEdit(f)} aria-label={`Editar ${f.nombre}`}>Editar</Button>
                        )}
                        {canDelete && (
                          <Button size="sm" variant="danger" onClick={() => handleDelete(f.id, f.nombre)} aria-label={`Eliminar ${f.nombre}`}>Eliminar</Button>
                        )}
                      </div>
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
