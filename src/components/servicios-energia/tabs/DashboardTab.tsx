import type { FacturaEnergia, FuenteEnergia } from '../../../types'

interface DashboardTabProps {
  facturasEnergia: FacturaEnergia[]
  fuentesEnergia: FuenteEnergia[]
  moneda: string
}

export default function DashboardTab({ facturasEnergia, fuentesEnergia, moneda }: DashboardTabProps) {
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
            backgroundColor: 'var(--at-primary-tint)',
            padding: '1.5rem',
            borderRadius: '8px',
            borderLeft: '4px solid var(--at-primary)',
          }}
        >
          <div style={{ fontSize: '0.9rem', color: 'var(--at-ink-2)', marginBottom: '0.5rem' }}>kWh Consumidos</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--at-primary)' }}>
            {totalesGlobales.kwh_consumidos.toFixed(2)}
          </div>
        </div>

        <div
          style={{
            backgroundColor: 'var(--at-warning-tint)',
            padding: '1.5rem',
            borderRadius: '8px',
            borderLeft: '4px solid var(--at-warning)',
          }}
        >
          <div style={{ fontSize: '0.9rem', color: 'var(--at-ink-2)', marginBottom: '0.5rem' }}>kWh Generados</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--at-warning)' }}>
            {totalesGlobales.kwh_generados.toFixed(2)}
          </div>
        </div>

        <div
          style={{
            backgroundColor: '#F4EBE3',
            padding: '1.5rem',
            borderRadius: '8px',
            borderLeft: '4px solid var(--at-accent)',
          }}
        >
          <div style={{ fontSize: '0.9rem', color: 'var(--at-ink-2)', marginBottom: '0.5rem' }}>kWh Netos</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--at-accent)' }}>
            {(totalesGlobales.kwh_consumidos - totalesGlobales.kwh_exportados).toFixed(2)}
          </div>
        </div>

        <div
          style={{
            backgroundColor: 'var(--at-success-tint)',
            padding: '1.5rem',
            borderRadius: '8px',
            borderLeft: '4px solid var(--at-success)',
          }}
        >
          <div style={{ fontSize: '0.9rem', color: 'var(--at-ink-2)', marginBottom: '0.5rem' }}>Costo Total</div>
          <div style={{ fontSize: '1.8rem', fontWeight: 'bold', color: 'var(--at-success)' }}>
            {moneda} {totalesGlobales.monto_total.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Desglose de costos */}
      <div style={{ marginBottom: '2rem', padding: '1rem', backgroundColor: 'var(--at-surface-2)', borderRadius: '8px' }}>
        <h3 style={{ marginTop: 0 }}>Desglose de Costos Totales</h3>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem',
          }}
        >
          <div>
            <div style={{ fontSize: '0.85rem', color: 'var(--at-ink-2)' }}>Energía</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 'bold' }}>{moneda} {totalesGlobales.monto_energia.toFixed(2)}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.85rem', color: 'var(--at-ink-2)' }}>Potencia</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 'bold' }}>{moneda} {totalesGlobales.monto_potencia.toFixed(2)}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.85rem', color: 'var(--at-ink-2)' }}>Cargo Fijo</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 'bold' }}>{moneda} {totalesGlobales.monto_cargo_fijo.toFixed(2)}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.85rem', color: 'var(--at-ink-2)' }}>Alumbrado</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 'bold' }}>{moneda} {totalesGlobales.monto_alumbrado.toFixed(2)}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.85rem', color: 'var(--at-ink-2)' }}>IVA</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 'bold' }}>{moneda} {totalesGlobales.monto_iva.toFixed(2)}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.85rem', color: 'var(--at-ink-2)' }}>Crédito Exportación</div>
            <div style={{ fontSize: '1.3rem', fontWeight: 'bold', color: 'var(--at-danger)' }}>
              {moneda} {totalesGlobales.monto_credito_exportacion.toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      {/* Tabla por fuente */}
      <div>
        <h3>Consumo por Fuente</h3>
        {totalsPorFuente.length === 0 ? (
          <p style={{ color: 'var(--at-ink-3)', fontStyle: 'italic' }}>No hay datos de facturas</p>
        ) : (
          <div className="table-scroll-wrapper">
          <table style={{ width: '100%', minWidth: 680, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--at-surface-2)', borderBottom: '2px solid var(--at-line)' }}>
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
                <tr key={t.fuente_id} style={{ borderBottom: '1px solid var(--at-chip)' }}>
                  <td style={{ padding: '0.75rem' }}>{t.fuente_nombre}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'right' }}>{t.kwh_consumidos.toFixed(2)}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'right' }}>{t.kwh_generados.toFixed(2)}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'right' }}>{t.kwh_exportados.toFixed(2)}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'right' }}>{t.kwh_netos.toFixed(2)}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 'bold' }}>{moneda} {t.monto_total.toFixed(2)}</td>
                  <td style={{ padding: '0.75rem', textAlign: 'center' }}>{t.cantidad_facturas}</td>
                </tr>
              ))}
              <tr style={{ backgroundColor: 'var(--at-chip)', fontWeight: 'bold', borderTop: '2px solid var(--at-line)' }}>
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
          </div>
        )}
      </div>
    </div>
  )
}
