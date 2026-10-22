import { useState, useEffect, type FormEvent } from 'react'
import type { FacturaEnergia, FuenteEnergia, TarifaEnergia, ProveedorEnergia } from '../../types'
import { notify } from '../shared/Dialog'
import { calcularFacturaEnergia, validarFacturaEnergia, totalFacturaEnergia } from '../../lib/businessEnergia'
import { redondear2 } from '../../lib/business'
import { sanitizeInput } from '../../lib/validation'
import { EditModal } from '../shared/EditModal'
import { Button } from '../shared/Button'
import { etiqueta, campo, rejilla } from './ui'

const etiquetaChica = { display: 'block', marginBottom: '0.25rem', fontSize: '0.9rem' } as const

interface FacturaEnergiaModalProps {
  factura: Partial<FacturaEnergia> | null
  fuentesEnergia: FuenteEnergia[]
  facturasEnergia: FacturaEnergia[]
  tarifasEnergia: TarifaEnergia[]
  proveedoresEnergia: ProveedorEnergia[]
  moneda: string
  onClose: () => void
  onSave: (factura: Partial<FacturaEnergia>) => Promise<void>
  isEditing?: boolean
}

export default function FacturaEnergiaModal({
  factura,
  fuentesEnergia,
  facturasEnergia,
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
      notify({ variant: 'error', title: 'Error', text: 'La fuente debe tener una tarifa asignada' })
      return
    }

    const tarifa = tarifasEnergia.find(t => t.id === selectedFuente.tarifa_id)
    if (!tarifa) {
      notify({ variant: 'error', title: 'Error', text: 'No se encontró la tarifa' })
      return
    }

    const calculo = calcularFacturaEnergia({
      tarifa,
      kwhConsumidos: formData.kwh_consumidos || 0,
      kwhExportados: formData.kwh_exportados || 0,
      kwDemandaMax: formData.kw_demanda_max || 0,
    })

    // Solo los montos, a centavos como los guarda la base. Antes se copiaba el
    // resultado entero, con `subtotal`, que no es columna de facturas_energia:
    // guardar después de calcular fallaba. El total sale del desglose.
    setFormData(prev => ({
      ...prev,
      monto_energia: redondear2(calculo.monto_energia),
      monto_potencia: redondear2(calculo.monto_potencia),
      monto_cargo_fijo: redondear2(calculo.monto_cargo_fijo),
      monto_alumbrado: redondear2(calculo.monto_alumbrado),
      monto_iva: redondear2(calculo.monto_iva),
      monto_credito_exportacion: redondear2(calculo.monto_credito_exportacion),
      moneda: tarifa.moneda,
    }))

    notify({ variant: 'success', title: 'Éxito', text: 'Montos calculados desde la tarifa' })
  }

  // Se recalcula con cada cambio del desglose y es lo que se guarda.
  const total = totalFacturaEnergia(formData)

  const handleSubmit = async (e: FormEvent) => {
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
        kw_demanda_max: formData.kw_demanda_max ? parseFloat(String(formData.kw_demanda_max)) : undefined,
        monto_energia: parseFloat(String(formData.monto_energia || 0)),
        monto_potencia: parseFloat(String(formData.monto_potencia || 0)),
        monto_cargo_fijo: parseFloat(String(formData.monto_cargo_fijo || 0)),
        monto_alumbrado: parseFloat(String(formData.monto_alumbrado || 0)),
        monto_iva: parseFloat(String(formData.monto_iva || 0)),
        // El crédito se guarda siempre en negativo, como lo deja el cálculo desde
        // tarifa: así el Dashboard no mezcla signos al sumarlo.
        monto_credito_exportacion: -Math.abs(parseFloat(String(formData.monto_credito_exportacion || 0))),
        monto_otros: parseFloat(String(formData.monto_otros || 0)),
        monto_total: total,
      }

      // serv:S6 — valida kWh no negativos + secuencialidad del período.
      // serv:S12 — + rechaza numero_factura duplicado dentro de la empresa.
      const validacion = validarFacturaEnergia(
        {
          id: factura?.id,
          fuente_energia_id: dataToSave.fuente_energia_id,
          numero_factura: dataToSave.numero_factura,
          periodo_inicio: dataToSave.periodo_inicio,
          periodo_fin: dataToSave.periodo_fin,
          kwh_consumidos: dataToSave.kwh_consumidos,
          kwh_generados: dataToSave.kwh_generados,
          kwh_exportados: dataToSave.kwh_exportados,
          kw_demanda_max: dataToSave.kw_demanda_max,
        },
        facturasEnergia,
      )
      if (!validacion.valido) {
        throw new Error(validacion.motivo)
      }

      await onSave(dataToSave)
      onClose()
    } catch (err: unknown) {
      notify({ variant: 'error', title: 'Error', text: err instanceof Error ? err.message : 'No se pudo guardar la factura' })
    } finally {
      setLoading(false)
    }
  }

  // No se cierra a mitad del guardado: cerrar ahí escondería el error (y lo
  // escrito). Si el guardado falla, la ventana sigue abierta con los datos.
  const cerrar = () => { if (!loading) onClose() }

  return (
    <EditModal
      title={isEditing ? '📝 Editar Factura' : '📝 Nueva Factura de Energía'}
      onClose={cerrar}
      maxWidth="600px"
      fullScreenOnMobile
      closeOnBackdropClick={!loading}
      closeOnEscape={!loading}
      footer={
        <>
          <Button variant="secondary" onClick={cerrar} disabled={loading}>Cancelar</Button>
          <Button type="submit" form="factura-energia-form" loading={loading} loadingText="Guardando...">Guardar</Button>
        </>
      }
    >
        <form id="factura-energia-form" onSubmit={handleSubmit}>
          {/* Fuente de Energía */}
          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="factura-fuente" style={etiqueta}>
              Fuente de Energía <span style={{ color: 'var(--at-danger)' }}>*</span>
            </label>
            <select
              id="factura-fuente"
              value={formData.fuente_energia_id || ''}
              onChange={e => setFormData(prev => ({ ...prev, fuente_energia_id: e.target.value }))}
              style={campo}
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

          {/* Período: una fecha por línea en el teléfono (lado a lado se salían). */}
          <div style={{ ...rejilla(170, '1rem'), marginBottom: '1rem' }}>
            <div>
              <label htmlFor="factura-periodo-inicio" style={etiqueta}>
                Período inicio <span style={{ color: 'var(--at-danger)' }}>*</span>
              </label>
              <input
                id="factura-periodo-inicio"
                type="date"
                value={formData.periodo_inicio || ''}
                onChange={e => setFormData(prev => ({ ...prev, periodo_inicio: e.target.value }))}
                style={campo}
                required
              />
            </div>
            <div>
              <label htmlFor="factura-periodo-fin" style={etiqueta}>
                Período fin <span style={{ color: 'var(--at-danger)' }}>*</span>
              </label>
              <input
                id="factura-periodo-fin"
                type="date"
                value={formData.periodo_fin || ''}
                onChange={e => setFormData(prev => ({ ...prev, periodo_fin: e.target.value }))}
                style={campo}
                required
              />
            </div>
          </div>

          {/* Número de factura */}
          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="factura-numero" style={etiqueta}>Número de factura</label>
            <input
              id="factura-numero"
              type="text"
              value={formData.numero_factura || ''}
              onChange={e => setFormData(prev => ({ ...prev, numero_factura: sanitizeInput(e.target.value) }))}
              placeholder="FAC-2024-001"
              style={campo}
            />
          </div>

          {/* kWh */}
          <div style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: 'var(--at-surface-2)', borderRadius: '8px' }}>
            <h4 style={{ margin: '0 0 0.75rem 0' }}>Consumo/Generación (kWh)</h4>
            <div style={rejilla(130)}>
              <div>
                <label htmlFor="factura-kwh-consumidos" style={etiquetaChica}>Consumidos</label>
                <input id="factura-kwh-consumidos" type="number" inputMode="decimal" step="0.001" value={formData.kwh_consumidos || ''} onChange={e => setFormData(prev => ({ ...prev, kwh_consumidos: parseFloat(e.target.value) }))} style={campo} />
              </div>
              {selectedFuente?.modo_suministro !== 'red' && (
                <>
                  <div>
                    <label htmlFor="factura-kwh-generados" style={etiquetaChica}>Generados</label>
                    <input id="factura-kwh-generados" type="number" inputMode="decimal" step="0.001" value={formData.kwh_generados || ''} onChange={e => setFormData(prev => ({ ...prev, kwh_generados: parseFloat(e.target.value) }))} style={campo} />
                  </div>
                  <div>
                    <label htmlFor="factura-kwh-exportados" style={etiquetaChica}>Exportados</label>
                    <input id="factura-kwh-exportados" type="number" inputMode="decimal" step="0.001" value={formData.kwh_exportados || ''} onChange={e => setFormData(prev => ({ ...prev, kwh_exportados: parseFloat(e.target.value) }))} style={campo} />
                  </div>
                </>
              )}
              <div>
                <label htmlFor="factura-kw-demanda" style={etiquetaChica}>Demanda máx. (kW)</label>
                <input id="factura-kw-demanda" type="number" inputMode="decimal" step="0.01" value={formData.kw_demanda_max || ''} onChange={e => setFormData(prev => ({ ...prev, kw_demanda_max: parseFloat(e.target.value) }))} style={campo} />
              </div>
            </div>
          </div>

          {/* Botón Calcular */}
          {selectedFuente?.tarifa_id && (
            <div style={{ marginBottom: '1rem' }}>
              <Button
                block
                onClick={handleCalculateFromTariff}
                style={{ background: 'var(--at-accent-2)', borderColor: 'var(--at-accent-2)', fontWeight: 'bold' }}
              >
                🧮 Calcular desde tarifa
              </Button>
            </div>
          )}

          {/* Desglose de montos */}
          <div style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: 'var(--at-surface-2)', borderRadius: '8px' }}>
            <h4 style={{ margin: '0 0 0.75rem 0' }}>Desglose ({moneda})</h4>
            <div style={{ ...rejilla(130), fontSize: '0.9rem' }}>
              <div>
                <label htmlFor="factura-monto-energia" style={etiquetaChica}>Energía</label>
                <input id="factura-monto-energia" type="number" inputMode="decimal" step="0.01" value={formData.monto_energia || ''} onChange={e => setFormData(prev => ({ ...prev, monto_energia: parseFloat(e.target.value) }))} style={campo} />
              </div>
              <div>
                <label htmlFor="factura-monto-potencia" style={etiquetaChica}>Potencia</label>
                <input id="factura-monto-potencia" type="number" inputMode="decimal" step="0.01" value={formData.monto_potencia || ''} onChange={e => setFormData(prev => ({ ...prev, monto_potencia: parseFloat(e.target.value) }))} style={campo} />
              </div>
              <div>
                <label htmlFor="factura-monto-cargo-fijo" style={etiquetaChica}>Cargo fijo</label>
                <input id="factura-monto-cargo-fijo" type="number" inputMode="decimal" step="0.01" value={formData.monto_cargo_fijo || ''} onChange={e => setFormData(prev => ({ ...prev, monto_cargo_fijo: parseFloat(e.target.value) }))} style={campo} />
              </div>
              <div>
                <label htmlFor="factura-monto-alumbrado" style={etiquetaChica}>Alumbrado</label>
                <input id="factura-monto-alumbrado" type="number" inputMode="decimal" step="0.01" value={formData.monto_alumbrado || ''} onChange={e => setFormData(prev => ({ ...prev, monto_alumbrado: parseFloat(e.target.value) }))} style={campo} />
              </div>
              <div>
                <label htmlFor="factura-monto-iva" style={etiquetaChica}>IVA</label>
                <input id="factura-monto-iva" type="number" inputMode="decimal" step="0.01" value={formData.monto_iva || ''} onChange={e => setFormData(prev => ({ ...prev, monto_iva: parseFloat(e.target.value) }))} style={campo} />
              </div>
              {/* Crédito y Otros sin teclado decimal: pueden ser negativos (el cálculo
                  deja el crédito en negativo) y ese teclado de iOS no trae el signo. */}
              <div>
                <label htmlFor="factura-monto-credito" style={etiquetaChica}>Crédito exportación</label>
                <input id="factura-monto-credito" type="number" step="0.01" value={formData.monto_credito_exportacion || ''} onChange={e => setFormData(prev => ({ ...prev, monto_credito_exportacion: parseFloat(e.target.value) }))} style={campo} />
              </div>
              <div>
                <label htmlFor="factura-monto-otros" style={etiquetaChica}>Otros</label>
                <input id="factura-monto-otros" type="number" step="0.01" value={formData.monto_otros || ''} onChange={e => setFormData(prev => ({ ...prev, monto_otros: parseFloat(e.target.value) }))} style={campo} />
              </div>
              <div style={{ fontWeight: 'bold' }}>
                <div style={etiquetaChica}>Total</div>
                {/* <output>: resultado de un cálculo; el lector de pantalla anuncia el total nuevo. */}
                <output aria-label="Total de la factura" style={{ display: 'block', padding: '0.5rem', backgroundColor: 'var(--at-primary-tint)', borderRadius: '4px' }}>{moneda} {total.toFixed(2)}</output>
                <div style={{ fontSize: '0.75rem', fontWeight: 'normal', color: 'var(--at-ink-3)', marginTop: '0.25rem' }}>Suma del desglose; el crédito resta.</div>
              </div>
            </div>
          </div>

          {/* Estado y pago */}
          <div style={{ ...rejilla(170, '1rem'), marginBottom: '1rem' }}>
            <div>
              <label htmlFor="factura-estado" style={etiqueta}>Estado</label>
              <select
                id="factura-estado"
                value={formData.estado || 'pendiente'}
                onChange={e => setFormData(prev => ({ ...prev, estado: e.target.value as FacturaEnergia['estado'] }))}
                style={campo}
              >
                <option value="pendiente">Pendiente</option>
                <option value="pagada">Pagada</option>
                <option value="vencida">Vencida</option>
              </select>
            </div>
            <div>
              <label htmlFor="factura-fecha-pago" style={etiqueta}>Fecha de pago</label>
              <input
                id="factura-fecha-pago"
                type="date"
                value={formData.fecha_pago || ''}
                onChange={e => setFormData(prev => ({ ...prev, fecha_pago: e.target.value }))}
                style={campo}
              />
            </div>
          </div>

          {/* Notas */}
          <div>
            <label htmlFor="factura-notas" style={etiqueta}>Notas</label>
            <textarea
              id="factura-notas"
              value={formData.notas || ''}
              onChange={e => setFormData(prev => ({ ...prev, notas: sanitizeInput(e.target.value) }))}
              placeholder="Observaciones..."
              style={{ ...campo, minHeight: '80px', fontFamily: 'inherit' }}
            />
          </div>
        </form>
    </EditModal>
  )
}
