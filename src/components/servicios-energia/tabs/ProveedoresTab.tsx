import { useState } from 'react'
import type { ProveedorEnergia, Proyecto } from '../../../types'
import { confirm, notify } from '../../shared/Dialog'
import { openPromptDialog } from '../../shared/PromptDialog'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { sanitizeInput } from '../../../lib/validation'
import { useCrearProveedorEnergiaMutation, useActualizarProveedorEnergiaMutation, useEliminarProveedorEnergiaMutation } from '../../../domain/energia/mutations'
import { encabezadoTab, etiqueta, campo, accionesFila } from '../ui'

interface ProveedoresTabProps {
  proveedoresEnergia: ProveedorEnergia[]
  proyectos: Proyecto[]
  companyId: string
  canCreate: boolean
  canEdit: boolean
  /** RBAC granular: permiso de eliminar (default true para no romper usos existentes) */
  canDelete?: boolean
}

export default function ProveedoresTab({
  proveedoresEnergia,
  proyectos,
  companyId,
  canCreate,
  canEdit,
  canDelete = true,
}: ProveedoresTabProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editFormData, setEditFormData] = useState<Partial<ProveedorEnergia>>({})

  const defaultProjectId = proyectos.length === 1 ? proyectos[0].id : null

  const crearMutation = useCrearProveedorEnergiaMutation(companyId)
  const actualizarMutation = useActualizarProveedorEnergiaMutation(companyId)
  const eliminarMutation = useEliminarProveedorEnergiaMutation(companyId)

  const handleCreate = async () => {
    if (!companyId) {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo identificar la empresa del usuario' })
      return
    }

    if (proyectos.length === 0) {
      notify({ variant: 'error', title: 'Error', text: 'Debe crear al menos un proyecto antes de crear un proveedor' })
      return
    }

    const proyectoOptions = proyectos.map(p => ({ value: p.id, label: p.nombre }))

    const fields = [
      { name: 'nombre', label: 'Nombre', placeholder: 'EEGSA', required: true, autoFocus: true } as const,
    ]
    if (proyectos.length > 1) {
      fields.push({
        name: 'project_id',
        label: 'Proyecto',
        control: 'select',
        options: proyectoOptions,
        required: true,
      } as never)
    }
    fields.push(
      { name: 'nit', label: 'NIT', placeholder: '9999999-9' } as never,
      { name: 'contacto', label: 'Contacto', placeholder: '2290-1234' } as never,
      {
        name: 'tipo',
        label: 'Tipo',
        control: 'select',
        options: [
          { value: 'distribuidora', label: 'Distribuidora' },
          { value: 'comercializadora', label: 'Comercializadora' },
          { value: 'autogeneracion', label: 'Autogeneración' },
        ],
        initialValue: 'distribuidora',
        required: true,
      } as never,
    )

    const result = await openPromptDialog({
      title: 'Nuevo Proveedor de Energía',
      fields,
      submitText: 'Crear',
      validate: (data) => {
        if (!data.nombre?.trim()) return 'El nombre es requerido'
        if (proyectos.length > 1 && (!data.project_id || data.project_id === 'null')) return 'Debe seleccionar un proyecto'
        return null
      },
    })

    if (!result) return
    const formValues = {
      nombre: sanitizeInput(result.nombre),
      nit: sanitizeInput(result.nit) || null,
      contacto: sanitizeInput(result.contacto) || null,
      tipo: result.tipo,
      project_id: proyectos.length > 1 ? result.project_id : (defaultProjectId ?? ''),
      company_id: companyId,
      activo: true,
    }

    try {
      await crearMutation.mutateAsync(formValues as Parameters<typeof crearMutation.mutateAsync>[0])
      notify({ variant: 'success', title: 'Proveedor creado', duration: 1500 })
    } catch (err: unknown) {
      notify({ variant: 'error', title: 'Error', text: err instanceof Error ? err.message : 'No se pudo crear el proveedor' })
    }
  }

  const handleStartEdit = (proveedor: ProveedorEnergia) => {
    setEditingId(proveedor.id)
    setEditFormData({ ...proveedor })
  }

  // No se cierra a mitad del guardado: cerrar ahí escondería el error.
  const guardando = actualizarMutation.isPending
  const cerrarEdicion = () => { if (!guardando) setEditingId(null) }

  const handleSaveEdit = async () => {
    if (!editingId || guardando) return
    try {
      await actualizarMutation.mutateAsync({ id: editingId, patch: editFormData })
      setEditingId(null)
      notify({ variant: 'success', title: 'Proveedor actualizado', duration: 1500 })
    } catch (err: unknown) {
      notify({ variant: 'error', title: 'Error', text: err instanceof Error ? err.message : 'No se pudo actualizar el proveedor' })
    }
  }

  const handleDelete = async (id: string, nombre: string) => {
    const { isConfirmed } = await confirm({
      title: '¿Eliminar proveedor?',
      text: `${nombre} será eliminado permanentemente.`,
      icon: 'warning',
      variant: 'danger',
      confirmText: 'Eliminar',
    })
    if (!isConfirmed) return
    try {
      await eliminarMutation.mutateAsync(id)
      notify({ variant: 'success', title: 'Proveedor eliminado', duration: 1500 })
    } catch (err: unknown) {
      notify({ variant: 'error', title: 'Error', text: err instanceof Error ? err.message : 'No se pudo eliminar el proveedor' })
    }
  }

  return (
    <div>
      <div style={encabezadoTab}>
        <h2 style={{ margin: 0 }}>Proveedores de Energía</h2>
        {canCreate && (
          <Button onClick={handleCreate}>+ Nuevo Proveedor</Button>
        )}
      </div>

      {editingId && (
        <EditModal
          title="Editar Proveedor"
          onClose={cerrarEdicion}
          maxWidth="480px"
          fullScreenOnMobile
          closeOnBackdropClick={!guardando}
          closeOnEscape={!guardando}
          footer={
            <>
              <Button variant="secondary" onClick={cerrarEdicion} disabled={guardando}>Cancelar</Button>
              <Button type="submit" form="prov-energia-form" loading={guardando} loadingText="Guardando...">Guardar</Button>
            </>
          }
        >
          <form
            id="prov-energia-form"
            onSubmit={e => { e.preventDefault(); void handleSaveEdit() }}
            style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
          >
            <div>
              <label htmlFor="prov-nombre" style={etiqueta}>Nombre *</label>
              <input id="prov-nombre" type="text" value={editFormData.nombre ?? ''} onChange={e => setEditFormData(prev => ({ ...prev, nombre: e.target.value }))} style={campo} />
            </div>
            <div>
              <label htmlFor="prov-nit" style={etiqueta}>NIT</label>
              <input id="prov-nit" type="text" value={editFormData.nit ?? ''} onChange={e => setEditFormData(prev => ({ ...prev, nit: e.target.value }))} style={campo} />
            </div>
            <div>
              <label htmlFor="prov-contacto" style={etiqueta}>Contacto</label>
              <input id="prov-contacto" type="text" value={editFormData.contacto ?? ''} onChange={e => setEditFormData(prev => ({ ...prev, contacto: e.target.value }))} style={campo} />
            </div>
            <div>
              <label htmlFor="prov-tipo" style={etiqueta}>Tipo</label>
              <select id="prov-tipo" value={editFormData.tipo ?? 'distribuidora'} onChange={e => setEditFormData(prev => ({ ...prev, tipo: e.target.value as ProveedorEnergia['tipo'] }))} style={campo}>
                <option value="distribuidora">Distribuidora</option>
                <option value="comercializadora">Comercializadora</option>
                <option value="autogeneracion">Autogeneración</option>
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input type="checkbox" id="prov-activo" checked={editFormData.activo ?? false} onChange={e => setEditFormData(prev => ({ ...prev, activo: e.target.checked }))} />
              <label htmlFor="prov-activo">Activo</label>
            </div>
          </form>
        </EditModal>
      )}

      {proveedoresEnergia.length === 0 ? (
        <p style={{ color: 'var(--at-ink-3)', fontStyle: 'italic', marginTop: '1.5rem' }}>No hay proveedores registrados</p>
      ) : (
        <div className="table-scroll-wrapper">
        {/* En el teléfono cada proveedor es una tarjeta (data-label por celda)
            con sus acciones al pie, en vez de una tabla que se arrastraba de lado. */}
        <table className="table-cards-on-mobile" style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1.5rem' }}>
          <thead>
            <tr style={{ backgroundColor: 'var(--at-surface-2)', borderBottom: '2px solid var(--at-line)' }}>
              <th scope="col" style={{ padding: '0.75rem', textAlign: 'left' }}>Nombre</th>
              <th scope="col" style={{ padding: '0.75rem', textAlign: 'left' }}>NIT</th>
              <th scope="col" style={{ padding: '0.75rem', textAlign: 'left' }}>Tipo</th>
              <th scope="col" style={{ padding: '0.75rem', textAlign: 'left' }}>Contacto</th>
              <th scope="col" style={{ padding: '0.75rem', textAlign: 'left' }}>Estado</th>
              {(canEdit || canDelete) && <th scope="col" style={{ padding: '0.75rem', textAlign: 'center' }}>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {proveedoresEnergia.map(p => (
              <tr key={p.id} style={{ borderBottom: '1px solid var(--at-chip)' }}>
                <td data-label="Nombre" style={{ padding: '0.75rem', fontWeight: 600 }}>{p.nombre}</td>
                <td data-label="NIT" style={{ padding: '0.75rem' }}>{p.nit || '-'}</td>
                <td data-label="Tipo" style={{ padding: '0.75rem', textTransform: 'capitalize' }}>{p.tipo}</td>
                <td data-label="Contacto" style={{ padding: '0.75rem' }}>{p.contacto || '-'}</td>
                <td data-label="Estado" style={{ padding: '0.75rem' }}>
                  <span style={{ color: p.activo ? 'var(--at-primary)' : 'var(--at-danger)' }}>{p.activo ? '● Activo' : '● Inactivo'}</span>
                </td>
                {(canEdit || canDelete) && (
                  <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                    <div style={accionesFila}>
                      {canEdit && (
                        <Button size="sm" onClick={() => handleStartEdit(p)} aria-label={`Editar ${p.nombre}`}>Editar</Button>
                      )}
                      {canDelete && (
                        <Button size="sm" variant="danger" onClick={() => handleDelete(p.id, p.nombre)} aria-label={`Eliminar ${p.nombre}`}>Eliminar</Button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </div>
  )
}
