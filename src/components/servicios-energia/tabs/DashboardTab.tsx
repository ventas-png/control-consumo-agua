import type { CSSProperties } from 'react'
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

      {/* Tarjetas de resumen global: dos por fila en el teléfono (antes una sola,
          de 250px mínimo, con mucho relleno). */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))',
          gap: '0.75rem',
          marginBottom: '2rem',
        }}
      >
        <div style={{ ...tarjetaKpi, backgroundColor: 'var(--at-primary-tint)', borderLeft: '4px solid var(--at-primary)' }}>
          <div style={{ fontSize: '0.9rem', color: 'var(--at-ink-2)', marginBottom: '0.5rem' }}>kWh Consumidos</div>
          <div style={{ ...valorKpi, color: 'var(--at-primary)' }}>
            {totalesGlobales.kwh_consumidos.toFixed(2)}
          </div>
        </div>
        <div style={{ ...tarjetaKpi, backgroundColor: 'var(--at-warning-tint)', borderLeft: '4px solid var(--at-warning)' }}>
          <div style={{ fontSize: '0.9rem', color: 'var(--at-ink-2)', marginBottom: '0.5rem' }}>kWh Generados</div>
          <div style={{ ...valorKpi, color: 'var(--at-warning)' }}>
            {totalesGlobales.kwh_generados.toFixed(2)}
          </div>
        </div>
        <div style={{ ...tarjetaKpi, backgroundColor: 'var(--at-accent-tint)', borderLeft: '4px solid var(--at-accent)' }}>
          <div style={{ fontSize: '0.9rem', color: 'var(--at-ink-2)', marginBottom: '0.5rem' }}>kWh Netos</div>
          <div style={{ ...valorKpi, color: 'var(--at-accent)' }}>
            {(totalesGlobales.kwh_consumidos - totalesGlobales.kwh_exportados).toFixed(2)}
          </div>
        </div>
        <div style={{ ...tarjetaKpi, backgroundColor: 'var(--at-success-tint)', borderLeft: '4px solid var(--at-success)' }}>
          <div style={{ fontSize: '0.9rem', color: 'var(--at-ink-2)', marginBottom: '0.5rem' }}>Costo Total</div>
          <div style={{ ...valorKpi, color: 'var(--at-success)' }}>
            {moneda}{'\u00A0'}{totalesGlobales.monto_total.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Desglose de costos */}
      <div style={{ marginBottom: '2rem', padding: '1rem', backgroundColor: 'var(--at-surface-2)', borderRadius: '8px' }}>
        <h3 style={{ marginTop: 0 }}>Desglose de Costos Totales</h3>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 120px), 1fr))',
            gap: '1rem 0.75rem',
          }}
        >
          <div>
            <div style={{ fontSize: '0.85rem', color: 'var(--at-ink-2)' }}>Energía</div>
            <div style={valorDesglose}>{moneda}{'\u00A0'}{totalesGlobales.monto_energia.toFixed(2)}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.85rem', color: 'var(--at-ink-2)' }}>Potencia</div>
            <div style={valorDesglose}>{moneda}{'\u00A0'}{totalesGlobales.monto_potencia.toFixed(2)}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.85rem', color: 'var(--at-ink-2)' }}>Cargo Fijo</div>
            <div style={valorDesglose}>{moneda}{'\u00A0'}{totalesGlobales.monto_cargo_fijo.toFixed(2)}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.85rem', color: 'var(--at-ink-2)' }}>Alumbrado</div>
            <div style={valorDesglose}>{moneda}{'\u00A0'}{totalesGlobales.monto_alumbrado.toFixed(2)}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.85rem', color: 'var(--at-ink-2)' }}>IVA</div>
            <div style={valorDesglose}>{moneda}{'\u00A0'}{totalesGlobales.monto_iva.toFixed(2)}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.85rem', color: 'var(--at-ink-2)' }}>Crédito Exportación</div>
            <div style={{ ...valorDesglose, color: 'var(--at-danger)' }}>{moneda}{'\u00A0'}{totalesGlobales.monto_credito_exportacion.toFixed(2)}</div>
          </div>
        </div>
      </div>

      {/* Tabla por fuente: en el teléfono cada fuente (y el total) es una tarjeta. */}
      <div>
        <h3>Consumo por Fuente</h3>
        {totalsPorFuente.length === 0 ? (
          <p style={{ color: 'var(--at-ink-3)', fontStyle: 'italic' }}>No hay datos de facturas</p>
        ) : (
          <div className="table-scroll-wrapper">
          <table className="table-cards-on-mobile" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--at-surface-2)', borderBottom: '2px solid var(--at-line)' }}>
                <th scope="col" style={{ padding: '0.75rem', textAlign: 'left' }}>Fuente</th>
                <th scope="col" style={{ padding: '0.75rem', textAlign: 'right' }}>kWh Consumidos</th>
                <th scope="col" style={{ padding: '0.75rem', textAlign: 'right' }}>kWh Generados</th>
                <th scope="col" style={{ padding: '0.75rem', textAlign: 'right' }}>kWh Exportados</th>
                <th scope="col" style={{ padding: '0.75rem', textAlign: 'right' }}>kWh Netos</th>
                <th scope="col" style={{ padding: '0.75rem', textAlign: 'right' }}>Costo Total {moneda}</th>
                <th scope="col" style={{ padding: '0.75rem', textAlign: 'center' }}>Facturas</th>
              </tr>
            </thead>
            <tbody>
              {totalsPorFuente.map(t => (
                <tr key={t.fuente_id} style={{ borderBottom: '1px solid var(--at-chip)' }}>
                  <td data-label="Fuente" style={{ padding: '0.75rem', textAlign: 'left', fontWeight: 600 }}>{t.fuente_nombre}</td>
                  <td data-label="kWh Consumidos" style={{ padding: '0.75rem', textAlign: 'right' }}>{t.kwh_consumidos.toFixed(2)}</td>
                  <td data-label="kWh Generados" style={{ padding: '0.75rem', textAlign: 'right' }}>{t.kwh_generados.toFixed(2)}</td>
                  <td data-label="kWh Exportados" style={{ padding: '0.75rem', textAlign: 'right' }}>{t.kwh_exportados.toFixed(2)}</td>
                  <td data-label="kWh Netos" style={{ padding: '0.75rem', textAlign: 'right' }}>{t.kwh_netos.toFixed(2)}</td>
                  <td data-label="Costo Total" style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 'bold' }}>{moneda} {t.monto_total.toFixed(2)}</td>
                  <td data-label="Facturas" style={{ padding: '0.75rem', textAlign: 'center' }}>{t.cantidad_facturas}</td>
                </tr>
              ))}
              <tr style={{ backgroundColor: 'var(--at-chip)', fontWeight: 'bold', borderTop: '2px solid var(--at-line)' }}>
                {/* Sin data-label: en la tarjeta "TOTAL" queda como título centrado. */}
                <td style={{ padding: '0.75rem', textAlign: 'left' }}>TOTAL</td>
                <td data-label="kWh Consumidos" style={{ padding: '0.75rem', textAlign: 'right' }}>{totalesGlobales.kwh_consumidos.toFixed(2)}</td>
                <td data-label="kWh Generados" style={{ padding: '0.75rem', textAlign: 'right' }}>{totalesGlobales.kwh_generados.toFixed(2)}</td>
                <td data-label="kWh Exportados" style={{ padding: '0.75rem', textAlign: 'right' }}>{totalesGlobales.kwh_exportados.toFixed(2)}</td>
                <td data-label="kWh Netos" style={{ padding: '0.75rem', textAlign: 'right' }}>{(totalesGlobales.kwh_consumidos - totalesGlobales.kwh_exportados).toFixed(2)}</td>
                <td data-label="Costo Total" style={{ padding: '0.75rem', textAlign: 'right' }}>{moneda} {totalesGlobales.monto_total.toFixed(2)}</td>
                <td data-label="Facturas" style={{ padding: '0.75rem', textAlign: 'center' }}>{totalesGlobales.cantidad_facturas}</td>
              </tr>
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  )
}

const tarjetaKpi: CSSProperties = { padding: '0.875rem', borderRadius: '8px', minWidth: 0 }
// Los montos no se salen de la tarjeta angosta: bajan de tamaño en el teléfono
// y, si aún no caben, parten (la moneda va pegada a la cifra con un espacio duro).
const valorKpi: CSSProperties = { fontSize: 'clamp(1.05rem, 4.5vw, 1.8rem)', fontWeight: 'bold', overflowWrap: 'anywhere' }
const valorDesglose: CSSProperties = { fontSize: 'clamp(1.05rem, 4.5vw, 1.3rem)', fontWeight: 'bold', overflowWrap: 'anywhere' }
