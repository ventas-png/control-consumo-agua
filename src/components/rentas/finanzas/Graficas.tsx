import type { ResumenMes } from '../../../domain/rentas/finanzas'
import { formatCurrency } from '../../../lib/format'
import { tenue } from '../ui'

const tarjeta = {
  border: '1px solid var(--at-line)', borderRadius: '10px', padding: '1rem', background: 'var(--at-surface)', minWidth: 0,
} as const

/** Ocupación del mes: parte de un todo con dos partes → una barra, no un pastel. */
export function OcupacionMes({ r }: { r: ResumenMes }) {
  return (
    <section style={tarjeta} aria-label="Ocupación del mes">
      <h3 style={{ margin: '0 0 0.25rem', fontSize: '14px' }}>Ocupación</h3>
      <div style={{ fontSize: '32px', fontWeight: 700, lineHeight: 1.1 }}>{r.ocupacionPct}%</div>
      <div role="img" aria-label={`${r.nochesOcupadas} noches ocupadas de ${r.dias}`}
        style={{ display: 'flex', gap: '2px', height: '14px', margin: '0.6rem 0 0.5rem' }}>
        {r.nochesOcupadas > 0 && (
          <div title={`${r.nochesOcupadas} noches ocupadas`} style={{ flex: r.nochesOcupadas, background: 'var(--at-primary)', borderRadius: '4px' }} />
        )}
        {r.nochesLibres > 0 && (
          <div title={`${r.nochesLibres} noches libres`} style={{ flex: r.nochesLibres, background: 'var(--at-chip)', borderRadius: '4px' }} />
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
        <span><strong>{r.nochesOcupadas}</strong> noches ocupadas</span>
        <span style={tenue}><strong>{r.nochesLibres}</strong> libres de {r.dias}</span>
      </div>
      <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.25rem 1rem', margin: '0.9rem 0 0', fontSize: '13px' }}>
        <dt style={tenue}>Estadías recibidas</dt><dd style={{ margin: 0, textAlign: 'right' }}>{r.estadias}</dd>
        <dt style={tenue}>Personas recibidas</dt><dd style={{ margin: 0, textAlign: 'right' }}>{r.personas}</dd>
        <dt style={tenue}>Personas por estadía</dt><dd style={{ margin: 0, textAlign: 'right' }}>{r.personasPromedio ?? '—'}</dd>
      </dl>
    </section>
  )
}

/**
 * Ingresos del mes por concepto (bloque del anfitrión) y lo acreditado. Una
 * sola serie → un solo color; lo que resta se distingue por el signo del
 * rótulo y el relleno claro, no por otro tono.
 */
export function IngresosMes({ r, moneda }: { r: ResumenMes; moneda: string }) {
  const filas = r.porConcepto.filter(x => x.concepto.bloque === 'anfitrion' && (x.total !== 0 || x.concepto.activo))
    .map(x => ({ id: x.concepto.id, nombre: x.concepto.nombre, total: x.total, resta: x.concepto.signo === -1 }))
  if (r.rentaContratos > 0) filas.push({ id: 'contratos', nombre: 'Renta de contratos', total: r.rentaContratos, resta: false })
  const max = Math.max(1, r.acreditado, ...filas.map(f => f.total))
  const ancho = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`
  const rejilla = { display: 'grid', gridTemplateColumns: 'minmax(90px, 38%) minmax(0, 1fr) auto', gap: '0.6rem', alignItems: 'center' } as const

  return (
    <section style={tarjeta} aria-label="Ingresos del mes">
      <h3 style={{ margin: '0 0 0.75rem', fontSize: '14px' }}>Ingresos del mes</h3>
      <div style={{ display: 'grid', gap: '0.45rem', fontSize: '13px' }}>
        {filas.map(f => (
          <div key={f.id} style={rejilla} title={`${f.nombre}: ${f.resta ? '−' : ''}${formatCurrency(f.total, moneda)}`}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.resta ? '− ' : ''}{f.nombre}</span>
            <div style={{ height: '12px' }}>
              <div style={{
                width: ancho(f.total), height: '100%', borderRadius: '0 4px 4px 0', boxSizing: 'border-box',
                background: f.resta ? 'var(--at-primary-tint)' : 'var(--at-primary)',
                border: f.resta && f.total > 0 ? '1px solid var(--at-primary)' : undefined,
              }} />
            </div>
            <span style={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{f.resta && f.total > 0 ? '−' : ''}{formatCurrency(f.total, moneda)}</span>
          </div>
        ))}
        <div style={{ ...rejilla, borderTop: '1px solid var(--at-line)', paddingTop: '0.5rem', fontWeight: 700 }}>
          <span>Acreditación del mes</span>
          <div style={{ height: '12px' }}>
            <div style={{ width: ancho(r.acreditado), height: '100%', borderRadius: '0 4px 4px 0', background: 'var(--at-ink)' }} />
          </div>
          <span style={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{formatCurrency(r.acreditado, moneda)}</span>
        </div>
      </div>
      {r.reservasSinDesglose > 0 && (
        <p style={{ ...tenue, margin: '0.75rem 0 0' }}>
          {r.reservasSinDesglose === 1 ? '1 estadía no tiene desglose' : `${r.reservasSinDesglose} estadías no tienen desglose`}: su total entra en lo acreditado, pero no en las barras por concepto.
        </p>
      )}
    </section>
  )
}
