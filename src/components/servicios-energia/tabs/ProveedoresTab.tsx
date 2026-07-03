import { useState } from 'react'
import type { ProveedorEnergia, Proyecto } from '../../../types'
import { confirm, notify } from '../../shared/Dialog'
import { openPromptDialog } from '../../shared/PromptDialog'
import { EditModal } from '../../shared/EditModal'
import { sanitizeInput } from '../../../lib/validation'
import { useCrearProveedorEnergiaMutation, useActualizarProveedorEnergiaMutation, useEliminarProveedorEnergiaMutation } from '../../../domain/energia/mutations'

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

  const handleSaveEdit = async () => {
    if (!editingId) return
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
        <div className="table-scroll-wrapper">
        <table style={{ width: '100%', minWidth: 680, borderCollapse: 'collapse', marginTop: '1.5rem' }}>
          <thead>
            <tr style={{ backgroundColor: 'var(--at-surface-2)', borderBottom: '2px solid var(--at-line)' }}>
              <th style={{ padding: '0.75rem', textAlign: 'left' }}>Nombre</th>
              <th style={{ padding: '0.75rem', textAlign: 'left' }}>NIT</th>
              <th style={{ padding: '0.75rem', textAlign: 'left' }}>Tipo</th>
              <th style={{ padding: '0.75rem', textAlign: 'left' }}>Contacto</th>
              <th style={{ padding: '0.75rem', textAlign: 'left' }}>Estado</th>
              {(canEdit || canDelete) && <th style={{ padding: '0.75rem', textAlign: 'center' }}>Acciones</th>}
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
                  <span style={{ color: p.activo ? 'var(--at-primary)' : 'var(--at-danger)' }}>{p.activo ? '● Activo' : '● Inactivo'}</span>
                </td>
                {(canEdit || canDelete) && (
                  <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                    {canEdit && (
                      <button onClick={() => handleStartEdit(p)} style={{ marginRight: '0.5rem', padding: '0.25rem 0.75rem', backgroundColor: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>
                        Editar
                      </button>
                    )}
                    {canDelete && (
                      <button onClick={() => handleDelete(p.id, p.nombre)} style={{ padding: '0.25rem 0.75rem', backgroundColor: 'var(--at-danger)', color: 'var(--at-on-status)', border: 'none', borderRadius: '3px', cursor: 'pointer' }}>
                        Eliminar
                      </button>
                    )}
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
