import { useState } from 'react'
import type { FacturaEnergia, FuenteEnergia, TarifaEnergia, ProveedorEnergia, Proyecto } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'
import FacturaEnergiaModal from '../FacturaEnergiaModal'
import { useCrearFacturaEnergiaMutation, useActualizarFacturaEnergiaMutation, useEliminarFacturaEnergiaMutation } from '../../../domain/energia/mutations'

interface FacturasTabProps {
  facturasEnergia: FacturaEnergia[]
  fuentesEnergia: FuenteEnergia[]
  tarifasEnergia: TarifaEnergia[]
  proveedoresEnergia: ProveedorEnergia[]
  proyectos: Proyecto[]
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
}

export default function FacturasTab({
  facturasEnergia,
  fuentesEnergia,
  tarifasEnergia,
  proveedoresEnergia,
  proyectos,
  companyId,
  moneda,
  canCreate,
  canEdit,
}: FacturasTabProps) {
  const [modalOpen, setModalOpen] = useState(false)
  const [editingFactura, setEditingFactura] = useState<FacturaEnergia | null>(null)
  const [filterFuente, setFilterFuente] = useState<string>('')
  const [filterEstado, setFilterEstado] = useState<string>('')

  const crearMutation = useCrearFacturaEnergiaMutation(companyId)
  const actualizarMutation = useActualizarFacturaEnergiaMutation(companyId)
  const eliminarMutation = useEliminarFacturaEnergiaMutation(companyId)

  const defaultProjectId = proyectos.length === 1 ? proyectos[0].id : null

  const filteredFacturas = facturasEnergia.filter(f => {
    if (filterFuente && f.fuente_energia_id !== filterFuente) return false
    if (filterEstado && f.estado !== filterEstado) return false
    return true
  })

  const handleCreateNew = () => {
    setEditingFactura(null)
    setModalOpen(true)
  }

  const handleEdit = (factura: FacturaEnergia) => {
    setEditingFactura(factura)
    setModalOpen(true)
  }

  const handleSaveFactura = async (formData: Partial<FacturaEnergia>) => {
    try {
      if (editingFactura?.id) {
        await actualizarMutation.mutateAsync({ id: editingFactura.id, patch: formData })
        notify({ variant: 'success', title: 'Factura actualizada', duration: 1500 })
      } else {
        // Derive project_id from the selected fuente_energia if possible
        const fuente = fuentesEnergia.find(f => f.id === formData.fuente_energia_id)
        const projectId = fuente?.project_id ?? defaultProjectId
        if (!projectId || !companyId) {
          throw new Error('No se pudo determinar el proyecto o la empresa')
        }
        await crearMutation.mutateAsync({ ...formData, project_id: projectId, company_id: companyId } as Parameters<typeof crearMutation.mutateAsync>[0])
        notify({ variant: 'success', title: 'Factura creada', duration: 1500 })
      }
    } catch (err: unknown) {
      notify({ variant: 'error', title: 'Error', text: err instanceof Error ? err.message : 'No se pudo guardar la factura' })
    }
  }

  const handleDelete = async (id: string) => {
    const { isConfirmed } = await confirm({ title: '¿Eliminar?', text: '¿Está seguro de que desea eliminar esta factura?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })

    if (!isConfirmed) return

    try {
      await eliminarMutation.mutateAsync(id)
      notify({ variant: 'success', title: 'Éxito', text: 'Factura eliminada' })
    } catch (err: unknown) {
      notify({ variant: 'error', title: 'Error', text: err instanceof Error ? err.message : 'No se pudo eliminar la factura' })
    }
  }

  const getEstadoColor = (estado: string) => {
    if (estado === 'pagada') return 'var(--at-primary)'
    if (estado === 'vencida') return 'var(--at-danger)'
    return 'var(--at-warning)'
  }

  return (
    <div>
      <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Facturas de Energía</h2>
        {canCreate && (
          <button
            onClick={handleCreateNew}
            style={{ padding: '0.5rem 1rem', backgroundColor: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            + Nueva Factura
          </button>
        )}
      </div>

      {modalOpen && (
        <FacturaEnergiaModal
          factura={editingFactura || {}}
          fuentesEnergia={fuentesEnergia}
          facturasEnergia={facturasEnergia}
          tarifasEnergia={tarifasEnergia}
          proveedoresEnergia={proveedoresEnergia}
          moneda={moneda}
          isEditing={!!editingFactura}
          onClose={() => {
            setModalOpen(false)
            setEditingFactura(null)
          }}
          onSave={handleSaveFactura}
        />
      )}

      {/* Filtros */}
      <div style={{ marginBottom: '1.5rem', display: 'flex', gap: '1rem' }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem', fontWeight: 'bold' }}>Filtrar por fuente:</label>
          <select
            value={filterFuente}
            onChange={e => setFilterFuente(e.target.value)}
            style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box' }}
          >
            <option value="">Todas las fuentes</option>
            {fuentesEnergia.map(f => (
              <option key={f.id} value={f.id}>
                {f.nombre}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem', fontWeight: 'bold' }}>Filtrar por estado:</label>
          <select value={filterEstado} onChange={e => setFilterEstado(e.target.value)} style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box' }}>
            <option value="">Todos los estados</option>
            <option value="pendiente">Pendiente</option>
            <option value="pagada">Pagada</option>
            <option value="vencida">Vencida</option>
          </select>
        </div>
      </div>

      {/* Tabla */}
      <div style={{ marginTop: '1.5rem' }}>
        {filteredFacturas.length === 0 ? (
          <p style={{ color: 'var(--at-ink-3)', fontStyle: 'italic' }}>No hay facturas con los filtros aplicados</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--at-surface-2)', borderBottom: '2px solid var(--at-line)' }}>
                <th style={{ padding: '0.5rem', textAlign: 'left' }}>Fuente</th>
                <th style={{ padding: '0.5rem', textAlign: 'left' }}>Período</th>
                <th style={{ padding: '0.5rem', textAlign: 'right' }}>kWh Consumidos</th>
                <th style={{ padding: '0.5rem', textAlign: 'right' }}>kWh Exportados</th>
                <th style={{ padding: '0.5rem', textAlign: 'right' }}>Total {moneda}</th>
                <th style={{ padding: '0.5rem', textAlign: 'left' }}>Estado</th>
                <th style={{ padding: '0.5rem', textAlign: 'center' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredFacturas.map(f => {
                const fuente = fuentesEnergia.find(fu => fu.id === f.fuente_energia_id)
                return (
                  <tr key={f.id} style={{ borderBottom: '1px solid var(--at-chip)' }}>
                    <td style={{ padding: '0.5rem' }}>{fuente?.nombre || '?'}</td>
                    <td style={{ padding: '0.5rem' }}>
                      {new Date(f.periodo_inicio).toLocaleDateString('es-MX', { month: 'short', day: 'numeric' })} -
                      {new Date(f.periodo_fin).toLocaleDateString('es-MX', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td style={{ padding: '0.5rem', textAlign: 'right' }}>{f.kwh_consumidos.toFixed(2)}</td>
                    <td style={{ padding: '0.5rem', textAlign: 'right' }}>{f.kwh_exportados ? f.kwh_exportados.toFixed(2) : '-'}</td>
                    <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 'bold' }}>{moneda} {f.monto_total.toFixed(2)}</td>
                    <td style={{ padding: '0.5rem' }}>
                      <span
                        style={{
                          padding: '0.25rem 0.5rem',
                          backgroundColor: getEstadoColor(f.estado),
                          color: 'white',
                          borderRadius: '3px',
                          fontSize: '0.8rem',
                        }}
                      >
                        {f.estado}
                      </span>
                    </td>
                    <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                      {canEdit && (
                        <>
                          <button
                            onClick={() => handleEdit(f)}
                            style={{
                              marginRight: '0.5rem',
                              padding: '0.25rem 0.75rem',
                              backgroundColor: 'var(--at-primary)',
                              color: 'white',
                              border: 'none',
                              borderRadius: '3px',
                              cursor: 'pointer',
                              fontSize: '0.75rem',
                            }}
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => handleDelete(f.id)}
                            style={{
                              padding: '0.25rem 0.75rem',
                              backgroundColor: 'var(--at-danger)',
                              color: 'white',
                              border: 'none',
                              borderRadius: '3px',
                              cursor: 'pointer',
                              fontSize: '0.75rem',
                            }}
                          >
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
