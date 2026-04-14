import React, { useState } from 'react'
import type { FacturaEnergia, FuenteEnergia } from '../../../types'

interface DashboardTabProps {
  facturasEnergia: FacturaEnergia[]
  fuentesEnergia: FuenteEnergia[]
  moneda: string
}

export default function DashboardTab({ facturasEnergia, fuentesEnergia, moneda }: DashboardTabProps) {
  const [selectedPeriod, setSelectedPeriod] = useState<'mes' | 'trimestre' | 'ano'>('mes')

  // Calcular totales por fuente
  const totalsPorFuente = fuentesEnergia.map(fuente => {
    const facturasDelFuente = facturasEnergia.filter(f => f.fuente_energia_id === fuente.id)

    const totales = {
      fuente_id: fuente.id,
      fuente_nombre: fuente.nombre,
      kwh_consumidos: facturasDelFuente.reduce((sum, f) => sum + f.kwh_consumidos, 0),
      kwh_generados: facturasDelFuente.reduce((sum, f) => sum + f.kwh_generados, 0),
      kwh_exportados: facturasDelFuente.reduce((sum, f) => sum + f.kwh_exportados, 0),
      kwh_netos: 0,
      monto_total: facturasDelFuente.reduce((sum, f) => sum + f.monto_total, 0),
      cantidad_facturas: facturasDelFuente.length,
    }

    totales.kwh_netos = totales.kwh_consumidos - totales.kwh_exportados

    return totales
  })

  // Calcular totales globales
  const totalesGlobales = {
    kwh_consumidos: facturasEnergia.reduce((sum, f) => sum + f.kwh_consumidos, 0),
    kwh_generados: facturasEnergia.reduce((sum, f) => sum + f.kwh_generados, 0),
    kwh_exportados: facturasEnergia.reduce((sum, f) => sum + f.kwh_exportados, 0),
    monto_total: facturasEnergia.reduce((sum, f) => sum + f.monto_total, 0),
    monto_energia: facturasEnergia.reduce((sum, f) => sum + f.monto_energia, 0),
    monto_potencia: facturasEnergia.reduce((sum, f) => sum + f.monto_potencia, 0),
    monto_cargo_fijo: facturasEnergia.reduce((sum, f) => sum + f.monto_cargo_fijo, 0),
    monto_alumbrado: facturasEnergia.reduce((sum, f) => sum + f.monto_alumbrado, 0),
    monto_iva: facturasEnergia.reduce((sum, f) => sum + f.monto_iva, 0),
    monto_credito_exportacion: facturasEnergia.reduce((sum, f) => sum + f.monto_credito_exportacion, 0),
    cantidad_facturas: facturasEnergia.length,
  }

  totalesGlobales.kwh_consumidos = parseFloat(totalesGlobales.kwh_consumidos.toFixed(3))
  totalesGlobales.kwh_generados = parseFloat(totalesGlobales.kwh_generados.toFixed(3))
  totalesGlobales.kwh_exportados = parseFloat(totalesGlobales.kwh_exportados.toFixed(3))

  return (
    <div>
      <h2 style={{ marginBottom: '1.5rem' }}>📊 Dashboard de Consumo Energético</h2>

      {/* Tarjetas de resumen global */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: '1rem',
          marginBottom: '2rem',
        }}
      >
        <div
          style={{
            backgroundColor: '#e3f2fd',
            padding: '1.5rem',
            borderRadius: '8px',
            borderLeft: '4px solid #1976d2',
          }}
        >
          <div style={{ fontSize: '0.9rem', color: '#666', marginBottom: '0.5rem' }}>kWh Consumidos</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#1976d2' }}>
            {totalesGlobales.kwh_consumidos.toFixed(2)}
          </div>
        </div>

        <div
          style={{
            backgroundColor: '#fff3e0',
            padding: '1.5rem',
            borderRadius: '8px',
            borderLeft: '4px solid #f57c00',
          }}
        >
          <div style={{ fontSize: '0.9rem', color: '#666', marginBottom: '0.5rem' }}>kWh Generados</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#f57c00' }}>
            {totalesGlobales.kwh_generados.toFixed(2)}
          </div>
        </div>

        <div
          style={{
            backgroundColor: '#f3e5f5',
            padding: '1.5rem',
            borderRadius: '8px',
            borderLeft: '4px solid #7b1fa2',
          }}
        >
          <div style={{ fontSize: '0.9rem', color: '#666', marginBottom: '0.5rem' }}>kWh Netos</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#7b1fa2' }}>
            {(totalesGlobales.kwh_consumidos - totalesGlobales.kwh_exportados).toFixed(2)}
          </div>
        </div>

        <div
          style={{
            backgroundColor: '#e8f5e9',
            padding: '1.5rem',
            borderRadius: '8px',
            borderLeft: '4px solid #388e3c',
          }}
        >
          <div style={{ fontSize: '0.9rem', color: '#666', marginBottom: '0.5rem' }}>Costo Total</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#388e3c' }}>
            {moneda} {totalesGlobales.monto_total.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Desglose de costos */}
      <div style={{ marginBottom: '2rem', padding: '1rem', backgroundColor: '#f9f9f9', borderRadius: '8px' }}>
        <h3 style={{ marginTop: 0 }}>Desglose de Costos Totales</h3>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem',
          }}
        >
          <div>
            <div style={{ fontSize: '0.85rem', color: '#666' }}>Energía</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 'bold' }}>{moneda} {totalesGlobales.monto_energia.toFixed(2)}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.85rem', color: '#666' }}>Potencia</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 'bold' }}>{moneda} {totalesGlobales.monto_potencia.toFixed(2)}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.85rem', color: '#666' }}>Cargo Fijo</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 'bold' }}>{moneda} {totalesGlobales.monto_cargo_fijo.toFixed(2)}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.85rem', color: '#666' }}>Alumbrado</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 'bold' }}>{moneda} {totalesGlobales.monto_alumbrado.toFixed(2)}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.85rem', color: '#666' }}>IVA</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 'bold' }}>{moneda} {totalesGlobales.monto_iva.toFixed(2)}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.85rem', color: '#666' }}>Crédito Exportación</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 'bold', color: '#d32f2f' }}>
              {moneda} {totalesGlobales.monto_credito_exportacion.toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      {/* Tabla por fuente */}
      <div>
        <h3>Consumo por Fuente</h3>
        {totalsPorFuente.length === 0 ? (
          <p style={{ color: '#888', fontStyle: 'italic' }}>No hay datos de facturas</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                <th style={{ padding: '0.75rem', textAlign: 'left' }}>Fuente</th>
                <th style={{ padding: '0.75rem', textAlign: 'right' }}>kWh Consumidos</th>
                <th style={{ padding: '0.75rem', textAlign: 'right' }}>kWh Generados</th>
                <th style={{ padding: '0.75rem', textAlign: 'right' }}>kWh Exportados</th>
                <th style={{ padding: '0.75rem', textAlign: 'right' }}>kWh Netos</th>
                <th style={{ padding: '0.75rem', textAlign: 'right' }}>Costo Total {moneda}</th>
                <th style={{ padding: '0.75rem', textAlign: 'center' }}>Facturas</th>
              </tr>
            </thead>
            <tbody>
              {totalsPorFuente.map(t => (
                <tr key={t.fuente_id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '0.75rem' }}>{t.fuente_nombre}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'right' }}>{t.kwh_consumidos.toFixed(2)}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'right' }}>{t.kwh_generados.toFixed(2)}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'right' }}>{t.kwh_exportados.toFixed(2)}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'right' }}>{t.kwh_netos.toFixed(2)}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 'bold' }}>{moneda} {t.monto_total.toFixed(2)}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'center' }}>{t.cantidad_facturas}</td>
                </tr>
              ))}
              <tr style={{ backgroundColor: '#f0f0f0', fontWeight: 'bold', borderTop: '2px solid #ddd' }}>
                <td style={{ padding: '0.75rem' }}>TOTAL</td>
                <td style={{ padding: '0.75rem', textAlign: 'right' }}>{totalesGlobales.kwh_consumidos.toFixed(2)}</td>
                <td style={{ padding: '0.75rem', textAlign: 'right' }}>{totalesGlobales.kwh_generados.toFixed(2)}</td>
                <td style={{ padding: '0.75rem', textAlign: 'right' }}>{totalesGlobales.kwh_exportados.toFixed(2)}</td>
                <td style={{ padding: '0.75rem', textAlign: 'right' }}>{(totalesGlobales.kwh_consumidos - totalesGlobales.kwh_exportados).toFixed(2)}</td>
                <td style={{ padding: '0.75rem', textAlign: 'right' }}>{moneda} {totalesGlobales.monto_total.toFixed(2)}</td>
                <td style={{ padding: '0.75rem', textAlign: 'center' }}>{totalesGlobales.cantidad_facturas}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
