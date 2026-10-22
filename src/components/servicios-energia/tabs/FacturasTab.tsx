import { useState, type CSSProperties } from 'react'
import type { FacturaEnergia, FuenteEnergia, TarifaEnergia, ProveedorEnergia, Proyecto } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'
import FacturaEnergiaModal from '../FacturaEnergiaModal'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { encabezadoTab, campo, accionesFila } from '../ui'
import { useCrearFacturaEnergiaMutation, useActualizarFacturaEnergiaMutation, useEliminarFacturaEnergiaMutation } from '../../../domain/energia/mutations'
import { formatFechaCalendario } from '../../../lib/format'

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
  /** RBAC granular: permiso de eliminar (default true para no romper usos existentes) */
  canDelete?: boolean
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
  canDelete = true,
}: FacturasTabProps) {
  const [modalOpen, setModalOpen] = useState(false)
  const [editingFactura, setEditingFactura] = useState<FacturaEnergia | null>(null)
  const [filterFuente, setFilterFuente] = useState<string>('')
  const [filterEstado, setFilterEstado] = useState<string>('')
  const [detalleId, setDetalleId] = useState<string | null>(null)

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

  // Los errores suben a FacturaEnergiaModal, que los avisa y sigue abierta con
  // lo escrito. Antes se avisaban aquí y la ventana se cerraba igual.
  const handleSaveFactura = async (formData: Partial<FacturaEnergia>) => {
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
  }

  const handleDelete = async (id: string) => {
    const { isConfirmed } = await confirm({ title: '¿Eliminar?', text: '¿Está seguro de que desea eliminar esta factura?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })

    if (!isConfirmed) return

    try {
      await eliminarMutation.mutateAsync(id)
      setDetalleId(prev => (prev === id ? null : prev))
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

  const nombreFuente = (f: FacturaEnergia) => fuentesEnergia.find(fu => fu.id === f.fuente_energia_id)?.nombre || '?'
  const periodo = (f: FacturaEnergia) =>
    `${formatFechaCalendario(f.periodo_inicio, { month: 'short', day: 'numeric' }, 'es-MX', '—')} – ${formatFechaCalendario(f.periodo_fin, { month: 'short', day: 'numeric', year: 'numeric' }, 'es-MX', '—')}`
  const estadoPill = (estado: string) => (
    <span
      style={{
        padding: '0.25rem 0.5rem',
        backgroundColor: getEstadoColor(estado),
        color: 'white',
        borderRadius: '3px',
        fontSize: '0.8rem',
      }}
    >
      {estado}
    </span>
  )

  // Se lee la fila vigente (no una copia): tras editar desde el detalle, este
  // muestra los datos nuevos.
  const detalle = detalleId ? facturasEnergia.find(f => f.id === detalleId) ?? null : null

  return (
    <div>
      <div style={encabezadoTab}>
        <h2 style={{ margin: 0 }}>Facturas de Energía</h2>
        {canCreate && (
          <Button onClick={handleCreateNew}>+ Nueva Factura</Button>
        )}
      </div>

      {detalle && (
        <EditModal
          title={`📄 ${nombreFuente(detalle)}`}
          subtitle={
            <span style={{ display: 'inline-flex', gap: '4px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <span>{periodo(detalle)}</span>
              {estadoPill(detalle.estado)}
            </span>
          }
          maxWidth="560px"
          fullScreenOnMobile
          onClose={() => setDetalleId(null)}
          // Las mismas acciones y permisos que la fila.
          footer={
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, width: '100%' }}>
              {canDelete && (
                <Button variant="outline-danger" onClick={() => handleDelete(detalle.id)} style={{ marginRight: 'auto' }}>Eliminar</Button>
              )}
              <Button variant="secondary" onClick={() => setDetalleId(null)}>Cerrar</Button>
              {canEdit && (
                <Button onClick={() => handleEdit(detalle)}>Editar</Button>
              )}
            </div>
          }
        >
          <FacturaDetalle factura={detalle} moneda={moneda} />
        </EditModal>
      )}

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

      {/* Filtros: uno debajo del otro cuando no caben lado a lado. */}
      <div style={{ marginBottom: '1.5rem', display: 'flex', gap: '0.75rem 1rem', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px' }}>
          <label htmlFor="facturas-filtro-fuente" style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem', fontWeight: 'bold' }}>Filtrar por fuente:</label>
          <select
            id="facturas-filtro-fuente"
            value={filterFuente}
            onChange={e => setFilterFuente(e.target.value)}
            style={campo}
          >
            <option value="">Todas las fuentes</option>
            {fuentesEnergia.map(f => (
              <option key={f.id} value={f.id}>
                {f.nombre}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: '1 1 200px' }}>
          <label htmlFor="facturas-filtro-estado" style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem', fontWeight: 'bold' }}>Filtrar por estado:</label>
          <select id="facturas-filtro-estado" value={filterEstado} onChange={e => setFilterEstado(e.target.value)} style={campo}>
            <option value="">Todos los estados</option>
            <option value="pendiente">Pendiente</option>
            <option value="pagada">Pagada</option>
            <option value="vencida">Vencida</option>
          </select>
        </div>
      </div>

      {/* Tabla: en el teléfono cada factura es una tarjeta. Tocar la fila abre
          su detalle; el botón "Ver" es el camino de teclado. */}
      <div style={{ marginTop: '1.5rem' }}>
        {filteredFacturas.length === 0 ? (
          <p style={{ color: 'var(--at-ink-3)', fontStyle: 'italic' }}>No hay facturas con los filtros aplicados</p>
        ) : (
          <div className="table-scroll-wrapper">
          <table className="table-cards-on-mobile" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--at-surface-2)', borderBottom: '2px solid var(--at-line)' }}>
                <th scope="col" style={{ padding: '0.5rem', textAlign: 'left' }}>Fuente</th>
                <th scope="col" style={{ padding: '0.5rem', textAlign: 'left' }}>Período</th>
                <th scope="col" style={{ padding: '0.5rem', textAlign: 'right' }}>kWh Consumidos</th>
                <th scope="col" className="table-col-secondary" style={{ padding: '0.5rem', textAlign: 'right' }}>kWh Exportados</th>
                <th scope="col" style={{ padding: '0.5rem', textAlign: 'right' }}>Total {moneda}</th>
                <th scope="col" style={{ padding: '0.5rem', textAlign: 'left' }}>Estado</th>
                <th scope="col" style={{ padding: '0.5rem', textAlign: 'center' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredFacturas.map(f => (
                <tr key={f.id} onClick={() => setDetalleId(f.id)} style={{ borderBottom: '1px solid var(--at-chip)', cursor: 'pointer' }}>
                  <td data-label="Fuente" style={{ padding: '0.5rem', fontWeight: 600 }}>{nombreFuente(f)}</td>
                  <td data-label="Período" style={{ padding: '0.5rem' }}>{periodo(f)}</td>
                  <td data-label="kWh Consumidos" style={{ padding: '0.5rem', textAlign: 'right' }}>{f.kwh_consumidos.toFixed(2)}</td>
                  <td data-label="kWh Exportados" className="table-col-secondary" style={{ padding: '0.5rem', textAlign: 'right' }}>{f.kwh_exportados ? f.kwh_exportados.toFixed(2) : '-'}</td>
                  <td data-label="Total" style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 'bold' }}>{moneda} {f.monto_total.toFixed(2)}</td>
                  <td data-label="Estado" style={{ padding: '0.5rem' }}>{estadoPill(f.estado)}</td>
                  <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                    <div style={accionesFila} onClick={e => e.stopPropagation()}>
                      <Button size="sm" variant="secondary" onClick={() => setDetalleId(f.id)} aria-label={`Ver factura de ${nombreFuente(f)}, ${periodo(f)}`}>Ver</Button>
                      {canEdit && (
                        <Button size="sm" onClick={() => handleEdit(f)} aria-label={`Editar factura de ${nombreFuente(f)}, ${periodo(f)}`}>Editar</Button>
                      )}
                      {canDelete && (
                        <Button size="sm" variant="danger" onClick={() => handleDelete(f.id)} aria-label={`Eliminar factura de ${nombreFuente(f)}, ${periodo(f)}`}>Eliminar</Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  )
}

/** Detalle de solo lectura: consumo, desglose y notas que la tabla no muestra. */
function FacturaDetalle({ factura: f, moneda }: { factura: FacturaEnergia; moneda: string }) {
  const fila = (label: string, valor: string, extra?: CSSProperties) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.4rem 0', borderBottom: '1px solid var(--at-chip)', ...extra }}>
      <span style={{ color: 'var(--at-ink-2)' }}>{label}</span>
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{valor}</span>
    </div>
  )
  const dinero = (n: number | undefined) => `${moneda} ${Number(n ?? 0).toFixed(2)}`
  const seccion: CSSProperties = { margin: '0 0 0.5rem', fontSize: '0.95rem' }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', fontSize: '0.9rem' }}>
      <div>
        {fila('Número de factura', f.numero_factura || '—')}
        {fila('Fecha de pago', formatFechaCalendario(f.fecha_pago, { day: 'numeric', month: 'short', year: 'numeric' }, 'es-MX', '—'))}
      </div>
      <div>
        <h3 style={seccion}>Consumo/Generación</h3>
        {fila('kWh consumidos', f.kwh_consumidos.toFixed(2))}
        {fila('kWh generados', Number(f.kwh_generados ?? 0).toFixed(2))}
        {fila('kWh exportados', Number(f.kwh_exportados ?? 0).toFixed(2))}
        {fila('Demanda máx. (kW)', f.kw_demanda_max != null ? Number(f.kw_demanda_max).toFixed(2) : '—')}
      </div>
      <div>
        <h3 style={seccion}>Desglose ({moneda})</h3>
        {fila('Energía', dinero(f.monto_energia))}
        {fila('Potencia', dinero(f.monto_potencia))}
        {fila('Cargo fijo', dinero(f.monto_cargo_fijo))}
        {fila('Alumbrado', dinero(f.monto_alumbrado))}
        {fila('IVA', dinero(f.monto_iva))}
        {fila('Crédito exportación', dinero(f.monto_credito_exportacion))}
        {fila('Otros', dinero(f.monto_otros))}
        {fila('Total', dinero(f.monto_total), { fontWeight: 'bold', borderBottom: 'none' })}
      </div>
      {f.notas && (
        <div>
          <h3 style={seccion}>Notas</h3>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{f.notas}</p>
        </div>
      )}
    </div>
  )
}
