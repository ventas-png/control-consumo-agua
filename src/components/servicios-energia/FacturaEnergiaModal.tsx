import React, { useState, useEffect } from 'react'
import type { FacturaEnergia, FuenteEnergia, TarifaEnergia, ProveedorEnergia } from '../../types'
import Swal from 'sweetalert2'
import { calcularFacturaEnergia } from '../../lib/businessEnergia'
import { sanitizeInput } from '../../lib/validation'

interface FacturaEnergiaModalProps {
  factura: Partial<FacturaEnergia> | null
  fuentesEnergia: FuenteEnergia[]
  tarifasEnergia: TarifaEnergia[]
  proveedoresEnergia: ProveedorEnergia[]
  moneda: string
  onClose: () => void
  onSave: (factura: any) => Promise<void>
  isEditing?: boolean
}

export default function FacturaEnergiaModal({
  factura,
  fuentesEnergia,
  tarifasEnergia,
  proveedoresEnergia: _proveedoresEnergia,
  moneda,
  onClose,
  onSave,
  isEditing = false,
}: FacturaEnergiaModalProps) {
  const [formData, setFormData] = useState<Partial<FacturaEnergia>>(factura || {})
  const [loading, setLoading] = useState(false)
  const [selectedFuente, setSelectedFuente] = useState<FuenteEnergia | null>(null)

  useEffect(() => {
    if (formData.fuente_energia_id) {
      const fuente = fuentesEnergia.find(f => f.id === formData.fuente_energia_id)
      setSelectedFuente(fuente || null)
    }
  }, [formData.fuente_energia_id, fuentesEnergia])

  const handleCalculateFromTariff = () => {
    if (!selectedFuente?.tarifa_id) {
      Swal.fire('Error', 'La fuente debe tener una tarifa asignada', 'error')
      return
    }

    const tarifa = tarifasEnergia.find(t => t.id === selectedFuente.tarifa_id)
    if (!tarifa) {
      Swal.fire('Error', 'No se encontró la tarifa', 'error')
      return
    }

    const calculo = calcularFacturaEnergia({
      tarifa,
      kwhConsumidos: formData.kwh_consumidos || 0,
      kwhExportados: formData.kwh_exportados || 0,
      kwDemandaMax: formData.kw_demanda_max || 0,
    })

    setFormData(prev => ({
      ...prev,
      ...calculo,
      moneda: tarifa.moneda,
    }))

    Swal.fire('Éxito', 'Montos calculados desde la tarifa', 'success')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      if (!formData.fuente_energia_id) {
        throw new Error('Debe seleccionar una fuente')
      }

      if (!formData.periodo_inicio || !formData.periodo_fin) {
        throw new Error('Debe indicar el período')
      }

      const dataToSave = {
        ...formData,
        kwh_consumidos: parseFloat(String(formData.kwh_consumidos || 0)),
        kwh_generados: parseFloat(String(formData.kwh_generados || 0)),
        kwh_exportados: parseFloat(String(formData.kwh_exportados || 0)),
        kw_demanda_max: formData.kw_demanda_max ? parseFloat(String(formData.kw_demanda_max)) : null,
        monto_energia: parseFloat(String(formData.monto_energia || 0)),
        monto_potencia: parseFloat(String(formData.monto_potencia || 0)),
        monto_cargo_fijo: parseFloat(String(formData.monto_cargo_fijo || 0)),
        monto_alumbrado: parseFloat(String(formData.monto_alumbrado || 0)),
        monto_iva: parseFloat(String(formData.monto_iva || 0)),
        monto_credito_exportacion: parseFloat(String(formData.monto_credito_exportacion || 0)),
        monto_otros: parseFloat(String(formData.monto_otros || 0)),
        monto_total: parseFloat(String(formData.monto_total || 0)),
      }

      await onSave(dataToSave)
      onClose()
    } catch (err: any) {
      Swal.fire('Error', err.message || 'No se pudo guardar la factura', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          padding: '2rem',
          maxWidth: '600px',
          width: '90%',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={e => e.stopPropagation()}
      >
        <h2 style={{ marginBottom: '1.5rem' }}>{isEditing ? '📝 Editar Factura' : '📝 Nueva Factura de Energía'}</h2>

        <form onSubmit={handleSubmit}>
          {/* Fuente de Energía */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.5rem' }}>
              Fuente de Energía <span style={{ color: 'red' }}>*</span>
            </label>
            <select
              value={formData.fuente_energia_id || ''}
              onChange={e => setFormData(prev => ({ ...prev, fuente_energia_id: e.target.value }))}
              style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box' }}
              required
            >
              <option value="">Seleccionar fuente</option>
              {fuentesEnergia.map(f => (
                <option key={f.id} value={f.id}>
                  {f.nombre}
                </option>
              ))}
            </select>
          </div>

          {/* Período */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.5rem' }}>
                Período inicio <span style={{ color: 'red' }}>*</span>
              </label>
              <input
                type="date"
                value={formData.periodo_inicio || ''}
                onChange={e => setFormData(prev => ({ ...prev, periodo_inicio: e.target.value }))}
                style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box' }}
                required
              />
            </div>
            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.5rem' }}>
                Período fin <span style={{ color: 'red' }}>*</span>
              </label>
              <input
                type="date"
                value={formData.periodo_fin || ''}
                onChange={e => setFormData(prev => ({ ...prev, periodo_fin: e.target.value }))}
                style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box' }}
                required
              />
            </div>
          </div>

          {/* Número de factura */}
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.5rem' }}>Número de factura</label>
            <input
              type="text"
              value={formData.numero_factura || ''}
              onChange={e => setFormData(prev => ({ ...prev, numero_factura: sanitizeInput(e.target.value) }))}
              placeholder="FAC-2024-001"
              style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box' }}
            />
          </div>

          {/* kWh */}
          <div style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: '#f9f9f9', borderRadius: '4px' }}>
            <h4 style={{ margin: '0 0 0.75rem 0' }}>Consumo/Generación (kWh)</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' }}>Consumidos</label>
                <input
                  type="number"
                  step="0.001"
                  value={formData.kwh_consumidos || ''}
                  onChange={e => setFormData(prev => ({ ...prev, kwh_consumidos: parseFloat(e.target.value) }))}
                  style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box' }}
                />
              </div>
              {selectedFuente?.modo_suministro !== 'red' && (
                <>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' }}>Generados</label>
                    <input
                      type="number"
                      step="0.001"
                      value={formData.kwh_generados || ''}
                      onChange={e => setFormData(prev => ({ ...prev, kwh_generados: parseFloat(e.target.value) }))}
                      style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' }}>Exportados</label>
                    <input
                      type="number"
                      step="0.001"
                      value={formData.kwh_exportados || ''}
                      onChange={e => setFormData(prev => ({ ...prev, kwh_exportados: parseFloat(e.target.value) }))}
                      style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box' }}
                    />
                  </div>
                </>
              )}
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' }}>Demanda máx. (kW)</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.kw_demanda_max || ''}
                  onChange={e => setFormData(prev => ({ ...prev, kw_demanda_max: parseFloat(e.target.value) }))}
                  style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box' }}
                />
              </div>
            </div>
          </div>

          {/* Botón Calcular */}
          {selectedFuente?.tarifa_id && (
            <div style={{ marginBottom: '1rem' }}>
              <button
                type="button"
                onClick={handleCalculateFromTariff}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  backgroundColor: '#17a2b8',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontWeight: 'bold',
                }}
              >
                🧮 Calcular desde tarifa
              </button>
            </div>
          )}

          {/* Desglose de montos */}
          <div style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: '#f9f9f9', borderRadius: '4px' }}>
            <h4 style={{ margin: '0 0 0.75rem 0' }}>Desglose ({moneda})</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.9rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem' }}>Energía</label>
                <input type="number" step="0.01" value={formData.monto_energia || ''} onChange={e => setFormData(prev => ({ ...prev, monto_energia: parseFloat(e.target.value) }))} style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem' }}>Potencia</label>
                <input type="number" step="0.01" value={formData.monto_potencia || ''} onChange={e => setFormData(prev => ({ ...prev, monto_potencia: parseFloat(e.target.value) }))} style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem' }}>Cargo fijo</label>
                <input type="number" step="0.01" value={formData.monto_cargo_fijo || ''} onChange={e => setFormData(prev => ({ ...prev, monto_cargo_fijo: parseFloat(e.target.value) }))} style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem' }}>Alumbrado</label>
                <input type="number" step="0.01" value={formData.monto_alumbrado || ''} onChange={e => setFormData(prev => ({ ...prev, monto_alumbrado: parseFloat(e.target.value) }))} style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem' }}>IVA</label>
                <input type="number" step="0.01" value={formData.monto_iva || ''} onChange={e => setFormData(prev => ({ ...prev, monto_iva: parseFloat(e.target.value) }))} style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem' }}>Crédito exportación</label>
                <input type="number" step="0.01" value={formData.monto_credito_exportacion || ''} onChange={e => setFormData(prev => ({ ...prev, monto_credito_exportacion: parseFloat(e.target.value) }))} style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem' }}>Otros</label>
                <input type="number" step="0.01" value={formData.monto_otros || ''} onChange={e => setFormData(prev => ({ ...prev, monto_otros: parseFloat(e.target.value) }))} style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box' }} />
              </div>
              <div style={{ fontWeight: 'bold', paddingTop: '0.5rem' }}>
                <label style={{ display: 'block', marginBottom: '0.25rem' }}>Total</label>
                <div style={{ padding: '0.5rem', backgroundColor: '#e3f2fd', borderRadius: '3px' }}>{moneda} {(formData.monto_total || 0).toFixed(2)}</div>
              </div>
            </div>
          </div>

          {/* Estado y pago */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.5rem' }}>Estado</label>
              <select
                value={formData.estado || 'pendiente'}
                onChange={e => setFormData(prev => ({ ...prev, estado: e.target.value as FacturaEnergia['estado'] }))}
                style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box' }}
              >
                <option value="pendiente">Pendiente</option>
                <option value="pagada">Pagada</option>
                <option value="vencida">Vencida</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.5rem' }}>Fecha de pago</label>
              <input
                type="date"
                value={formData.fecha_pago || ''}
                onChange={e => setFormData(prev => ({ ...prev, fecha_pago: e.target.value }))}
                style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box' }}
              />
            </div>
          </div>

          {/* Notas */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '0.5rem' }}>Notas</label>
            <textarea
              value={formData.notas || ''}
              onChange={e => setFormData(prev => ({ ...prev, notas: sanitizeInput(e.target.value) }))}
              placeholder="Observaciones..."
              style={{ width: '100%', padding: '0.5rem', boxSizing: 'border-box', minHeight: '80px' }}
            />
          </div>

          {/* Botones */}
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
