import { mesCorto, nombreMes, resumenTendencia, type PuntoTendencia } from '../../../domain/rentas/finanzas'
import { formatCurrency } from '../../../lib/format'
import { StatTile } from '../../shared/StatTile'
import { fila, rejillaTiles, td, tenue, th, thead } from '../ui'

interface Props {
  puntos: PuntoTendencia[]
  moneda: string
  /** Al pulsar un mes de la tabla, ir a su detalle. */
  onVerMes: (mes: string) => void
}

const tarjeta = { border: '1px solid var(--at-line)', borderRadius: '10px', padding: '1rem', background: 'var(--at-surface)', minWidth: 0 } as const
const num = { textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } as const
const ALTO = 150

interface Columna { clave: string; etiqueta: string; anio?: string; valor: number; texto: string; ayuda: string }

/**
 * Columnas por mes de UNA medida (una serie → un color). Rotula sólo el
 * máximo y el último mes; el resto se lee al pasar el cursor y en la tabla.
 */
function Columnas({ titulo, columnas, maximo }: { titulo: string; columnas: Columna[]; maximo: number }) {
  const tope = Math.max(maximo, ...columnas.map(c => c.valor), 0) || 1
  const iMax = columnas.reduce((m, c, i) => (c.valor > columnas[m].valor ? i : m), 0)
  return (
    <section style={tarjeta} aria-label={titulo}>
      <h3 style={{ margin: '0 0 0.75rem', fontSize: '14px' }}>{titulo}</h3>
      <div role="img" aria-label={`${titulo}: ${columnas.map(c => c.ayuda).join('; ')}`}
        style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: `${ALTO + 18}px`, borderBottom: '1px solid var(--at-line)' }}>
        {columnas.map((c, i) => {
          // El último mes se rotula salvo que quede pegado al máximo (los dos números se encimarían).
          const ultimo = i === columnas.length - 1 && iMax !== i - 1
          const rotular = c.valor > 0 && (i === iMax || ultimo)
          return (
            <div key={c.clave} title={c.ayuda} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', height: '100%' }}>
              <span style={{ fontSize: '11px', lineHeight: '16px', height: '16px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{rotular ? c.texto : ''}</span>
              <div style={{
                width: '100%', maxWidth: '42px', height: `${Math.round((c.valor / tope) * ALTO)}px`, minHeight: c.valor > 0 ? '2px' : 0,
                background: 'var(--at-primary)', borderRadius: '4px 4px 0 0',
              }} />
            </div>
          )
        })}
      </div>
      <div aria-hidden="true" style={{ display: 'flex', gap: '2px', marginTop: '0.3rem' }}>
        {columnas.map((c, i) => (
          <span key={c.clave} style={{ ...tenue, flex: 1, minWidth: 0, textAlign: 'center', fontSize: '10px', lineHeight: 1.25, whiteSpace: 'nowrap' }}>
            {columnas.length <= 12 || i % 2 === (columnas.length - 1) % 2 ? c.etiqueta : ''}
            {/* El año va debajo, sólo donde cambia: en enero y en la primera columna. */}
            <br />{c.anio ?? ''}
          </span>
        ))}
      </div>
    </section>
  )
}

/** Desempeño mes a mes: totales del periodo, dos gráficas (una medida cada una) y la tabla. */
export function Tendencia({ puntos, moneda, onVerMes }: Props) {
  const r = resumenTendencia(puntos)
  const $ = (n: number) => formatCurrency(n, moneda)
  /** Rótulo del eje: el mes en tres letras y, debajo, el año sólo en enero y en la primera columna. */
  const eje = (mes: string, i: number) => ({
    etiqueta: mesCorto(mes).slice(0, 3), anio: i === 0 || mes.endsWith('-01') ? mes.slice(0, 4) : undefined,
  })
  const compacto = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)))

  return (
    <div>
      <div style={rejillaTiles}>
        <StatTile label="Acreditado en el periodo" value={$(r.acreditado)} icon="💰" hint={`${puntos.length} meses · ${r.estadias} estadías`} />
        <StatTile label="Ocupación del periodo" value={`${r.ocupacionPct}%`} icon="🔑" hint={`${r.nochesOcupadas} de ${r.dias} noches`} />
        <StatTile label="Ingreso por noche ocupada" value={r.ingresoPorNoche === null ? '—' : $(r.ingresoPorNoche)} icon="🌙" hint="Acreditado ÷ noches ocupadas" />
        <StatTile label="Mejor mes" value={r.mejorMes ? mesCorto(r.mejorMes.mes) : '—'} icon="🏆"
          hint={r.mejorMes ? `${$(r.mejorMes.acreditado)} · ${r.mejorMes.ocupacionPct}% de ocupación` : 'Sin ingresos en el periodo'} />
        <StatTile label="A pagar a propietarios" value={$(r.pagoPropietario)} icon="🤝" hint={`Tras comisión y ${$(r.gastos)} en gastos`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <Columnas titulo={`Acreditado por mes (${moneda})`} maximo={0} columnas={puntos.map((p, i) => ({
          clave: p.mes, ...eje(p.mes, i), valor: Math.max(0, p.acreditado), texto: compacto(p.acreditado),
          ayuda: `${nombreMes(p.mes)}: ${$(p.acreditado)}`,
        }))} />
        <Columnas titulo="Ocupación por mes (%)" maximo={100} columnas={puntos.map((p, i) => ({
          clave: p.mes, ...eje(p.mes, i), valor: p.ocupacionPct, texto: `${p.ocupacionPct}%`,
          ayuda: `${nombreMes(p.mes)}: ${p.ocupacionPct}% (${p.nochesOcupadas} de ${p.dias} noches)`,
        }))} />
      </div>

      <div className="table-scroll-wrapper">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={thead}>
              <th scope="col" style={th}>Mes</th>
              <th scope="col" style={{ ...th, textAlign: 'right' }}>Ocupación</th>
              <th scope="col" style={{ ...th, textAlign: 'right' }}>Estadías</th>
              <th scope="col" style={{ ...th, textAlign: 'right' }}>Acreditado</th>
              <th scope="col" style={{ ...th, textAlign: 'right' }}>Por noche</th>
              <th scope="col" style={{ ...th, textAlign: 'right' }}>Gastos</th>
              <th scope="col" style={{ ...th, textAlign: 'right' }}>A pagar al propietario</th>
            </tr>
          </thead>
          <tbody>
            {[...puntos].reverse().map(p => (
              <tr key={p.mes} style={fila}>
                <th scope="row" style={{ ...td, textAlign: 'left', fontWeight: 400 }}>
                  <button type="button" onClick={() => onVerMes(p.mes)} aria-label={`Ver el detalle de ${nombreMes(p.mes)}`}
                    style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', textDecoration: 'underline', cursor: 'pointer' }}>
                    {nombreMes(p.mes).replace(/^./, c => c.toUpperCase())}
                  </button>
                </th>
                <td style={{ ...td, ...num }}>{p.ocupacionPct}% <span style={tenue}>({p.nochesOcupadas}/{p.dias})</span></td>
                <td style={{ ...td, ...num }}>{p.estadias}</td>
                <td style={{ ...td, ...num }}>{$(p.acreditado)}</td>
                <td style={{ ...td, ...num }}>{p.ingresoPorNoche === null ? '—' : $(p.ingresoPorNoche)}</td>
                <td style={{ ...td, ...num }}>{$(p.gastos)}</td>
                <td style={{ ...td, ...num, fontWeight: 600 }}>{$(p.pagoPropietario)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ ...thead, fontWeight: 700 }}>
              <td style={td}>Periodo</td>
              <td style={{ ...td, ...num }}>{r.ocupacionPct}%</td>
              <td style={{ ...td, ...num }}>{r.estadias}</td>
              <td style={{ ...td, ...num }}>{$(r.acreditado)}</td>
              <td style={{ ...td, ...num }}>{r.ingresoPorNoche === null ? '—' : $(r.ingresoPorNoche)}</td>
              <td style={{ ...td, ...num }}>{$(r.gastos)}</td>
              <td style={{ ...td, ...num }}>{$(r.pagoPropietario)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
