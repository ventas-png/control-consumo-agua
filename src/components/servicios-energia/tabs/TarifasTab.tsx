import { useState } from 'react'
import type { TarifaEnergia, ProveedorEnergia, Proyecto } from '../../../types'
import { confirm, notify } from '../../shared/Dialog'
import { openPromptDialog } from '../../shared/PromptDialog'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { sanitizeInput } from '../../../lib/validation'
import { useCrearTarifaEnergiaMutation, useActualizarTarifaEnergiaMutation, useEliminarTarifaEnergiaMutation } from '../../../domain/energia/mutations'
import { encabezadoTab, etiqueta, campo, rejilla, accionesFila } from '../ui'

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

  // No se cierra a mitad del guardado: cerrar ahí escondería el error.
  const guardando = actualizarMutation.isPending
  const cerrarEdicion = () => { if (!guardando) setEditingId(null) }

  const handleSaveEdit = async () => {
    if (!editingId || guardando) return
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
      <div style={encabezadoTab}>
        <h2 style={{ margin: 0 }}>Tarifas de Energía</h2>
        {canCreate && (
          <Button onClick={handleCreate}>+ Nueva Tarifa</Button>
        )}
      </div>

      {editingId && (
        <EditModal
          title="Editar Tarifa"
          onClose={cerrarEdicion}
          maxWidth="520px"
          fullScreenOnMobile
          closeOnBackdropClick={!guardando}
          closeOnEscape={!guardando}
          footer={
            <>
              <Button variant="secondary" onClick={cerrarEdicion} disabled={guardando}>Cancelar</Button>
              <Button type="submit" form="tarifa-energia-form" loading={guardando} loadingText="Guardando...">Guardar</Button>
            </>
          }
        >
          <form
            id="tarifa-energia-form"
            onSubmit={e => { e.preventDefault(); void handleSaveEdit() }}
            style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
          >
            <div>
              <label htmlFor="tarifa-nombre" style={etiqueta}>Nombre *</label>
              <input id="tarifa-nombre" type="text" value={editFormData.nombre ?? ''} onChange={e => setEditFormData(prev => ({ ...prev, nombre: e.target.value }))} style={campo} />
            </div>
            <div>
              <label htmlFor="tarifa-descripcion" style={etiqueta}>Descripción</label>
              <textarea id="tarifa-descripcion" value={editFormData.descripcion ?? ''} onChange={e => setEditFormData(prev => ({ ...prev, descripcion: e.target.value }))} rows={2} style={{ ...campo, fontFamily: 'inherit' }} />
            </div>
            <div style={rejilla(150, '0.5rem')}>
              <div>
                <label htmlFor="tarifa-kwh" style={etiqueta}>Precio kWh (energía)</label>
                <input id="tarifa-kwh" type="number" inputMode="decimal" step="0.000001" value={editFormData.precio_kwh_energia ?? 0} onChange={e => setEditFormData(prev => ({ ...prev, precio_kwh_energia: parseFloat(e.target.value) || 0 }))} style={campo} />
              </div>
              <div>
                <label htmlFor="tarifa-kw" style={etiqueta}>Precio kW (potencia)</label>
                <input id="tarifa-kw" type="number" inputMode="decimal" step="0.0001" value={editFormData.precio_kw_potencia ?? 0} onChange={e => setEditFormData(prev => ({ ...prev, precio_kw_potencia: parseFloat(e.target.value) || 0 }))} style={campo} />
              </div>
              <div>
                <label htmlFor="tarifa-cargo-fijo" style={etiqueta}>Cargo fijo ({moneda})</label>
                <input id="tarifa-cargo-fijo" type="number" inputMode="decimal" step="0.01" value={editFormData.cargo_fijo ?? 0} onChange={e => setEditFormData(prev => ({ ...prev, cargo_fijo: parseFloat(e.target.value) || 0 }))} style={campo} />
              </div>
              <div>
                <label htmlFor="tarifa-alumbrado" style={etiqueta}>Alumbrado público</label>
                <input id="tarifa-alumbrado" type="number" inputMode="decimal" step="0.0001" value={editFormData.alumbrado_publico ?? 0} onChange={e => setEditFormData(prev => ({ ...prev, alumbrado_publico: parseFloat(e.target.value) || 0 }))} style={campo} />
              </div>
              <div>
                <label htmlFor="tarifa-alumbrado-tipo" style={etiqueta}>Tipo alumbrado</label>
                <select id="tarifa-alumbrado-tipo" value={editFormData.alumbrado_tipo ?? 'fijo'} onChange={e => setEditFormData(prev => ({ ...prev, alumbrado_tipo: e.target.value as TarifaEnergia['alumbrado_tipo'] }))} style={campo}>
                  <option value="fijo">Fijo</option>
                  <option value="porcentual">Porcentual (%)</option>
                </select>
              </div>
              <div>
                <label htmlFor="tarifa-iva" style={etiqueta}>IVA (%)</label>
                <input id="tarifa-iva" type="number" inputMode="decimal" step="0.01" value={editFormData.iva_porcentaje ?? 0} onChange={e => setEditFormData(prev => ({ ...prev, iva_porcentaje: parseFloat(e.target.value) || 0 }))} style={campo} />
              </div>
              <div>
                <label htmlFor="tarifa-kwh-exportado" style={etiqueta}>Precio kWh exportado</label>
                <input id="tarifa-kwh-exportado" type="number" inputMode="decimal" step="0.000001" value={editFormData.precio_kwh_exportado ?? 0} onChange={e => setEditFormData(prev => ({ ...prev, precio_kwh_exportado: parseFloat(e.target.value) || 0 }))} style={campo} />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input type="checkbox" id="tarifa-activa" checked={editFormData.activa ?? false} onChange={e => setEditFormData(prev => ({ ...prev, activa: e.target.checked }))} />
              <label htmlFor="tarifa-activa">Activa</label>
            </div>
          </form>
        </EditModal>
      )}

      {tarifasEnergia.length === 0 ? (
        <p style={{ color: 'var(--at-ink-3)', fontStyle: 'italic', marginTop: '1.5rem' }}>No hay tarifas registradas</p>
      ) : (
        <div className="table-scroll-wrapper">
        {/* En el teléfono cada tarifa es una tarjeta con sus acciones al pie. */}
        <table className="table-cards-on-mobile" style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1.5rem', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ backgroundColor: 'var(--at-surface-2)', borderBottom: '2px solid var(--at-line)' }}>
              <th scope="col" style={{ padding: '0.5rem', textAlign: 'left' }}>Nombre</th>
              <th scope="col" style={{ padding: '0.5rem', textAlign: 'left' }}>Proveedor</th>
              <th scope="col" style={{ padding: '0.5rem', textAlign: 'right' }}>kWh</th>
              <th scope="col" style={{ padding: '0.5rem', textAlign: 'right' }}>Cargo fijo</th>
              <th scope="col" style={{ padding: '0.5rem', textAlign: 'right' }}>IVA%</th>
              <th scope="col" style={{ padding: '0.5rem', textAlign: 'left' }}>Estado</th>
              {(canEdit || canDelete) && <th scope="col" style={{ padding: '0.5rem', textAlign: 'center' }}>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {tarifasEnergia.map(t => {
              const prov = proveedoresEnergia.find(p => p.id === t.proveedor_id)
              return (
                <tr key={t.id} style={{ borderBottom: '1px solid var(--at-chip)' }}>
                  <td data-label="Nombre" style={{ padding: '0.5rem', fontWeight: 600 }}>{t.nombre}</td>
                  <td data-label="Proveedor" style={{ padding: '0.5rem' }}>{prov?.nombre ?? '—'}</td>
                  <td data-label="Precio kWh" style={{ padding: '0.5rem', textAlign: 'right' }}>{Number(t.precio_kwh_energia).toFixed(4)}</td>
                  <td data-label="Cargo fijo" style={{ padding: '0.5rem', textAlign: 'right' }}>{moneda} {Number(t.cargo_fijo).toFixed(2)}</td>
                  <td data-label="IVA%" style={{ padding: '0.5rem', textAlign: 'right' }}>{Number(t.iva_porcentaje).toFixed(2)}</td>
                  <td data-label="Estado" style={{ padding: '0.5rem' }}>
                    <span style={{ color: t.activa ? 'var(--at-primary)' : 'var(--at-danger)' }}>{t.activa ? '● Activa' : '● Inactiva'}</span>
                  </td>
                  {(canEdit || canDelete) && (
                    <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                      <div style={accionesFila}>
                        {canEdit && (
                          <Button size="sm" onClick={() => handleStartEdit(t)} aria-label={`Editar ${t.nombre}`}>Editar</Button>
                        )}
                        {canDelete && (
                          <Button size="sm" variant="danger" onClick={() => handleDelete(t.id, t.nombre)} aria-label={`Eliminar ${t.nombre}`}>Eliminar</Button>
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
