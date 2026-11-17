import { useMemo, useState } from 'react'
import type {
  ConceptoRenta, ContratoRenta, GastoRenta, LiquidacionRenta, PropiedadRenta, Proyecto, ReservaUnificada,
} from '../../../types'
import {
  BLOQUE_TOTAL_LABEL, MONEDA_DEFECTO, POLITICA_CANCELACION_LABEL, calendarioMes, claveReserva, conceptosDeBloque, esMes, mesDesplazado,
  monedaDeReserva, nombreMes, resumenCarteraMes, resumenMes, tieneDesglose, totalesDesglose,
} from '../../../domain/rentas/finanzas'
import { TIPO_RENTA_ICONO } from '../../../domain/rentas/logica'
import { formatCurrency } from '../../../lib/format'
import { notify } from '../../shared/Dialog'
import { Button } from '../../shared/Button'
import { EmptyState } from '../../shared/EmptyState'
import { StatTile } from '../../shared/StatTile'
import type { PermisosModulo } from '../RentasSection'
import { ConceptosModal } from '../finanzas/ConceptosModal'
import { GastosPanel } from '../finanzas/GastosPanel'
import { IngresosMes, OcupacionMes } from '../finanzas/Graficas'
import { ImportarReservasModal } from '../finanzas/ImportarReservasModal'
import { SelectMoneda } from '../finanzas/SelectMoneda'
import { barraFiltros, campo, encabezadoTab, fila, rejillaTiles, td, tenue, th, thead } from '../ui'

interface Props {
  propiedades: PropiedadRenta[]
  reservas: ReservaUnificada[]
  contratos: ContratoRenta[]
  conceptos: ConceptoRenta[]
  liquidaciones: Map<string, LiquidacionRenta>
  gastos: GastoRenta[]
  proyectos: Proyecto[]
  companyId: string
  hoy: string
  permisos: PermisosModulo
  /** Permisos del módulo Reservas: importar reservas es crearlas. */
  permisosReservas: PermisosModulo
  cargando: boolean
}

const num = { textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' } as const
const tarjeta = { border: '1px solid var(--at-line)', borderRadius: '10px', padding: '1rem', background: 'var(--at-surface)', minWidth: 0 } as const

/**
 * Finanzas de Rentas: el mes de la cartera y, por propiedad, la hoja que las
 * administradoras llevan en Excel —calendario día por día con el desglose de
 * cada reserva, ocupación, ingresos— más gastos y el estado del propietario.
 */
export default function FinanzasTab({
  propiedades, reservas, contratos, conceptos, liquidaciones, gastos, proyectos, companyId, hoy,
  permisos, permisosReservas, cargando,
}: Props) {
  const [mes, setMes] = useState(hoy.slice(0, 7))
  const [propiedadId, setPropiedadId] = useState('')
  // No hay tipo de cambio: se ve una moneda a la vez.
  const [moneda, setMoneda] = useState(MONEDA_DEFECTO)
  const [columnas, setColumnas] = useState(false)
  const [modal, setModal] = useState<'conceptos' | 'importar' | null>(null)
  const [generando, setGenerando] = useState(false)

  const nombreProyecto = useMemo(() => new Map(proyectos.map(p => [p.id, p.nombre])), [proyectos])
  const propiedad = propiedades.find(p => p.id === propiedadId)
  const $ = (n: number) => formatCurrency(n, moneda)

  const cartera = useMemo(
    () => resumenCarteraMes(propiedades, mes, reservas, contratos, gastos, conceptos, liquidaciones, moneda),
    [propiedades, mes, reservas, contratos, gastos, conceptos, liquidaciones, moneda])
  /** Monedas que aparecen en los datos (para ofrecerlas en el selector). */
  const monedasUsadas = useMemo(() => [...new Set([
    ...[...liquidaciones.values()].map(l => l.moneda), ...gastos.map(g => g.moneda), ...contratos.map(c => c.moneda),
  ].filter((m): m is string => !!m))], [liquidaciones, gastos, contratos])

  const detalle = useMemo(() => {
    if (!propiedad) return null
    const suyas = reservas.filter(r => r.propiedad_id === propiedad.id)
    const gastosMes = gastos.filter(g => g.propiedad_id === propiedad.id && g.fecha.slice(0, 7) === mes)
      .sort((a, b) => a.fecha.localeCompare(b.fecha))
    return {
      reservas: suyas, gastosMes,
      dias: calendarioMes(mes, suyas),
      resumen: resumenMes({
        propiedad, mes, reservas: suyas, conceptos, liquidaciones, moneda,
        contratos: contratos.filter(c => c.propiedad_id === propiedad.id),
        gastos: gastos.filter(g => g.propiedad_id === propiedad.id),
      }),
    }
  }, [propiedad, mes, reservas, contratos, gastos, conceptos, liquidaciones, moneda])

  const delHuesped = useMemo(() => conceptosDeBloque(conceptos, 'huesped'), [conceptos])
  const delAnfitrion = useMemo(() => conceptosDeBloque(conceptos, 'anfitrion'), [conceptos])

  const descargar = async () => {
    if (!propiedad || !detalle || generando) return
    setGenerando(true)
    try {
      const { descargarEstadoMensual } = await import('../finanzas/estadoMensualPdf')
      await descargarEstadoMensual({
        propiedad, resumen: detalle.resumen, liquidaciones, conceptos, moneda,
        gastos: detalle.gastosMes.filter(g => (g.moneda ?? MONEDA_DEFECTO) === moneda),
        reservas: detalle.reservas.filter(r => r.estado !== 'cancelada' && r.fecha_entrada.slice(0, 7) === mes && monedaDeReserva(r, liquidaciones) === moneda)
          .sort((a, b) => a.fecha_entrada.localeCompare(b.fecha_entrada)),
      })
    } catch {
      notify({ variant: 'error', title: 'No se pudo generar el PDF', text: 'Intenta de nuevo.' })
    } finally {
      setGenerando(false)
    }
  }

  if (cargando) return <p style={tenue}>Cargando las finanzas…</p>
  if (propiedades.length === 0) {
    return <EmptyState icon="💵" title="Aún no hay propiedades en renta"
      description="Registra las propiedades en la pestaña Propiedades. Aquí verás su mes: ocupación, ingresos, gastos y lo que le toca al propietario." />
  }

  return (
    <div>
      <div style={encabezadoTab}>
        <h2 style={{ margin: 0 }}>{propiedad ? propiedad.nombre : 'Finanzas de la cartera'}</h2>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {propiedad && permisosReservas.crear && propiedad.tipo_renta === 'corto_plazo' && (
            <Button variant="secondary" onClick={() => setModal('importar')}>Importar reservas</Button>
          )}
          {permisos.editar && <Button variant="secondary" onClick={() => setModal('conceptos')}>Configurar conceptos</Button>}
          {propiedad && <Button onClick={() => void descargar()} loading={generando} loadingText="Generando...">Descargar estado (PDF)</Button>}
        </div>
      </div>

      <div style={barraFiltros}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <Button size="sm" variant="secondary" onClick={() => setMes(m => mesDesplazado(m, -1))} aria-label="Mes anterior">‹</Button>
          <input type="month" aria-label="Mes" value={mes} onChange={e => { if (esMes(e.target.value)) setMes(e.target.value) }}
            style={{ ...campo, width: 'auto' }} />
          <Button size="sm" variant="secondary" onClick={() => setMes(m => mesDesplazado(m, 1))} aria-label="Mes siguiente">›</Button>
        </div>
        <select value={propiedadId} onChange={e => setPropiedadId(e.target.value)} aria-label="Propiedad" style={{ ...campo, maxWidth: '320px' }}>
          <option value="">Toda la cartera</option>
          {propiedades.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        <SelectMoneda id="rf-moneda" ariaLabel="Moneda de los montos" value={moneda} onChange={setMoneda} extra={monedasUsadas} />
        <span style={{ ...tenue, fontSize: '13px' }}>{nombreMes(mes)}</span>
      </div>
      {(detalle?.resumen.otrasMonedas ?? cartera.otrasMonedas).length > 0 && (
        <p role="status" style={{ margin: '0 0 1rem', padding: '0.5rem 0.75rem', borderRadius: '6px', background: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', fontSize: '13px' }}>
          Este mes también hay montos en {(detalle?.resumen.otrasMonedas ?? cartera.otrasMonedas).join(', ')}. Aquí sólo se suman los de {moneda}: cambia la moneda arriba para verlos.
        </p>
      )}

      {!propiedad || !detalle ? (
        <>
          <div style={rejillaTiles}>
            <StatTile label="Ocupación del mes" value={`${cartera.total.ocupacionPct}%`} icon="🔑"
              hint={`${cartera.total.nochesOcupadas} de ${cartera.total.dias} noches · ${cartera.total.estadias} estadías`} />
            <StatTile label="Acreditado" value={$(cartera.total.acreditado)} icon="💰" hint="Recibido por reservas y contratos" />
            <StatTile label="Comisión de administración" value={$(cartera.total.comision)} icon="🏢"
              hint={cartera.total.gastosAdministradora > 0 ? `Neto ${$(cartera.total.ingresoAdministradora)} tras gastos propios` : 'Lo que cobra la administradora'} />
            <StatTile label="Gastos" value={$(cartera.total.gastosPropietario + cartera.total.gastosAdministradora)} icon="🧾"
              hint={`${$(cartera.total.gastosPropietario)} a cargo de propietarios`} />
            <StatTile label="A pagar a propietarios" value={$(cartera.total.pagoPropietario)} icon="🤝" hint="Acreditado − comisión − sus gastos" />
          </div>
          <div className="table-scroll-wrapper">
            <table className="table-cards-on-mobile" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={thead}>
                  <th scope="col" style={th}>Propiedad</th>
                  <th scope="col" style={{ ...th, textAlign: 'right' }}>Ocupación</th>
                  <th scope="col" style={{ ...th, textAlign: 'right' }}>Estadías</th>
                  <th scope="col" style={{ ...th, textAlign: 'right' }}>Acreditado</th>
                  <th scope="col" style={{ ...th, textAlign: 'right' }}>Comisión</th>
                  <th scope="col" style={{ ...th, textAlign: 'right' }}>Gastos</th>
                  <th scope="col" style={{ ...th, textAlign: 'right' }}>A pagar al propietario</th>
                  <th scope="col" style={th}><span className="sr-only">Detalle</span></th>
                </tr>
              </thead>
              <tbody>
                {cartera.filas.map(({ propiedad: p, resumen: r }) => (
                  <tr key={p.id} style={fila}>
                    <td data-label="Propiedad" style={td}>
                      <div style={{ fontWeight: 600 }}>{TIPO_RENTA_ICONO[p.tipo_renta]} {p.nombre}</div>
                      <div style={tenue}>{[p.project_id ? nombreProyecto.get(p.project_id) ?? 'Condominio' : 'Independiente', p.propietario_nombre].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td data-label="Ocupación" style={{ ...td, ...num }}>{r.ocupacionPct}% <span style={tenue}>({r.nochesOcupadas}/{r.dias})</span></td>
                    <td data-label="Estadías" style={{ ...td, ...num }}>{r.estadias}</td>
                    <td data-label="Acreditado" style={{ ...td, ...num }}>{$(r.acreditado)}</td>
                    <td data-label="Comisión" style={{ ...td, ...num }}>{r.comisionPct > 0 ? $(r.comision) : <span style={tenue}>sin %</span>}</td>
                    <td data-label="Gastos" style={{ ...td, ...num }}>{$(r.gastosPropietario + r.gastosAdministradora)}</td>
                    <td data-label="A pagar al propietario" style={{ ...td, ...num, fontWeight: 600 }}>{$(r.pagoPropietario)}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      <Button size="sm" variant="secondary" onClick={() => setPropiedadId(p.id)} aria-label={`Ver el mes de ${p.nombre}`}>Ver mes</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <div style={rejillaTiles}>
            <StatTile label="Ocupación" value={`${detalle.resumen.ocupacionPct}%`} icon="🔑"
              hint={`${detalle.resumen.nochesOcupadas} noches ocupadas · ${detalle.resumen.nochesLibres} libres`} />
            <StatTile label="Estadías" value={detalle.resumen.estadias} icon="🛎️"
              hint={`${detalle.resumen.personas} personas${detalle.resumen.personasPromedio === null ? '' : ` · ${detalle.resumen.personasPromedio} por estadía`}`} />
            <StatTile label="Acreditación del mes" value={$(detalle.resumen.acreditado)} icon="💰"
              hint={detalle.resumen.totalHuesped > 0 ? `Los huéspedes pagaron ${$(detalle.resumen.totalHuesped)}` : 'Recibido por el anfitrión'} />
            <StatTile label="A pagar al propietario" value={$(detalle.resumen.pagoPropietario)} icon="🤝"
              hint={propiedad.propietario_nombre ?? 'Sin propietario registrado'} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
            <OcupacionMes r={detalle.resumen} />
            <IngresosMes r={detalle.resumen} moneda={moneda} />
            <section style={tarjeta} aria-label="Estado del propietario">
              <h3 style={{ margin: '0 0 0.75rem', fontSize: '14px' }}>Estado del propietario</h3>
              <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.4rem 1rem', margin: 0, fontSize: '13px' }}>
                <dt>Acreditación del mes</dt><dd style={{ margin: 0, ...num }}>{$(detalle.resumen.acreditado)}</dd>
                <dt>− Comisión de administración{detalle.resumen.comisionPct > 0 ? ` (${detalle.resumen.comisionPct}%)` : ''}</dt>
                <dd style={{ margin: 0, ...num }}>{$(detalle.resumen.comision)}</dd>
                <dt>− Gastos a su cargo</dt><dd style={{ margin: 0, ...num }}>{$(detalle.resumen.gastosPropietario)}</dd>
                <dt style={{ borderTop: '1px solid var(--at-line)', paddingTop: '0.5rem', fontWeight: 700 }}>A pagar al propietario</dt>
                <dd style={{ margin: 0, ...num, borderTop: '1px solid var(--at-line)', paddingTop: '0.5rem', fontWeight: 700 }}>{$(detalle.resumen.pagoPropietario)}</dd>
              </dl>
              <p style={{ ...tenue, margin: '0.75rem 0 0' }}>
                {propiedad.comision_pct === null
                  ? 'Esta propiedad no tiene porcentaje de comisión: defínelo en la pestaña Propiedades.'
                  : `La comisión se calcula sobre ${$(detalle.resumen.baseComision)} (los conceptos marcados «Comisión»).`}
                {detalle.resumen.gastosAdministradora > 0 && ` La administradora absorbe ${$(detalle.resumen.gastosAdministradora)} en gastos: le quedan ${$(detalle.resumen.ingresoAdministradora)}.`}
              </p>
            </section>
          </div>

          {propiedad.tipo_renta === 'corto_plazo' && (
            <section aria-label="Calendario del mes" style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                <h3 style={{ margin: 0, fontSize: '16px' }}>El mes, día por día</h3>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '13px' }}>
                  <input type="checkbox" checked={columnas} onChange={e => setColumnas(e.target.checked)} />
                  Ver todas las columnas del desglose
                </label>
              </div>
              <div className="table-scroll-wrapper">
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <thead>
                    {columnas && (
                      <tr style={thead}>
                        <th colSpan={4} />
                        <th colSpan={delHuesped.length + 1} scope="colgroup" style={{ ...th, textAlign: 'center', borderLeft: '2px solid var(--at-line)' }}>Cobro al huésped</th>
                        <th colSpan={delAnfitrion.length + 1} scope="colgroup" style={{ ...th, textAlign: 'center', borderLeft: '2px solid var(--at-line)' }}>Recibido por el anfitrión</th>
                      </tr>
                    )}
                    <tr style={thead}>
                      <th scope="col" style={th}>Día</th>
                      <th scope="col" style={th}>Reserva</th>
                      <th scope="col" style={{ ...th, textAlign: 'right' }}>Huéspedes</th>
                      <th scope="col" style={th}>Política</th>
                      {columnas && delHuesped.map((c, i) => (
                        <th key={c.id} scope="col" style={{ ...th, textAlign: 'right', whiteSpace: 'normal', minWidth: '90px', borderLeft: i === 0 ? '2px solid var(--at-line)' : undefined }}>{c.nombre}</th>
                      ))}
                      <th scope="col" style={{ ...th, textAlign: 'right', whiteSpace: 'normal', borderLeft: columnas && delHuesped.length === 0 ? '2px solid var(--at-line)' : undefined }}>{BLOQUE_TOTAL_LABEL.huesped}</th>
                      {columnas && delAnfitrion.map((c, i) => (
                        <th key={c.id} scope="col" style={{ ...th, textAlign: 'right', whiteSpace: 'normal', minWidth: '90px', borderLeft: i === 0 ? '2px solid var(--at-line)' : undefined }}>
                          {c.signo === -1 ? '− ' : ''}{c.nombre}
                        </th>
                      ))}
                      <th scope="col" style={{ ...th, textAlign: 'right', whiteSpace: 'normal' }}>{BLOQUE_TOTAL_LABEL.anfitrion}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalle.dias.map(d => {
                      const r = d.reserva
                      const importes = r && d.esEntrada ? liquidaciones.get(claveReserva(r))?.importes : undefined
                      const suMoneda = r ? monedaDeReserva(r, liquidaciones) : moneda
                      const $r = (n: number) => formatCurrency(n, suMoneda)
                      const con = tieneDesglose(importes)
                      const t = con ? totalesDesglose(conceptos, importes) : null
                      const celda = { padding: '0.35rem 0.75rem' } as const
                      const monto = (id: string) => (con && typeof importes?.[id] === 'number' ? $r(importes[id]) : '')
                      return (
                        <tr key={d.fecha} style={{ ...fila, background: r ? 'var(--at-primary-tint)' : undefined, fontWeight: d.esEntrada ? 600 : undefined }}>
                          <th scope="row" style={{ ...celda, textAlign: 'left', whiteSpace: 'nowrap', fontWeight: d.fecha === hoy ? 700 : 400 }}>{d.dia}{d.fecha === hoy ? ' · hoy' : ''}</th>
                          <td style={celda}>
                            {r ? (d.esEntrada
                              ? <>{r.codigo_confirmacion ?? r.huesped_nombre}{r.codigo_confirmacion && <span style={{ ...tenue, fontWeight: 400 }}> · {r.huesped_nombre}</span>}</>
                              : <span style={tenue}>{r.codigo_confirmacion ?? r.huesped_nombre}</span>) : <span style={tenue}>libre</span>}
                          </td>
                          <td style={{ ...celda, ...num }}>{r && d.esEntrada ? r.num_huespedes : ''}</td>
                          <td style={celda}>{r && d.esEntrada && r.politica_cancelacion ? POLITICA_CANCELACION_LABEL[r.politica_cancelacion] : ''}</td>
                          {columnas && delHuesped.map(c => <td key={c.id} style={{ ...celda, ...num }}>{monto(c.id)}</td>)}
                          <td style={{ ...celda, ...num }}>{t ? $r(t.huesped) : ''}</td>
                          {columnas && delAnfitrion.map(c => <td key={c.id} style={{ ...celda, ...num }}>{monto(c.id)}</td>)}
                          <td style={{ ...celda, ...num }}>
                            {t ? $r(t.anfitrion) : r && d.esEntrada && r.monto_total !== null ? <>{$r(r.monto_total)} <span style={{ ...tenue, fontWeight: 400 }}>sin desglose</span></> : ''}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ ...thead, fontWeight: 700 }}>
                      <td style={{ padding: '0.6rem 0.75rem' }} colSpan={2}>Totales del mes</td>
                      <td style={{ padding: '0.6rem 0.75rem', ...num }}>{detalle.resumen.personas}</td>
                      <td />
                      {columnas && delHuesped.map(c => (
                        <td key={c.id} style={{ padding: '0.6rem 0.75rem', ...num }}>{$(detalle.resumen.porConcepto.find(x => x.concepto.id === c.id)?.total ?? 0)}</td>
                      ))}
                      <td style={{ padding: '0.6rem 0.75rem', ...num }}>{$(detalle.resumen.totalHuesped)}</td>
                      {columnas && delAnfitrion.map(c => (
                        <td key={c.id} style={{ padding: '0.6rem 0.75rem', ...num }}>{$(detalle.resumen.porConcepto.find(x => x.concepto.id === c.id)?.total ?? 0)}</td>
                      ))}
                      <td style={{ padding: '0.6rem 0.75rem', ...num }}>{$(detalle.resumen.acreditadoReservas)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p style={{ ...tenue, margin: '0.5rem 0 0' }}>
                Los montos se anotan el día de entrada de cada reserva. El desglose se captura al crear o editar la reserva, en la pestaña Reservas, o con «Importar reservas».
              </p>
            </section>
          )}

          <GastosPanel propiedad={propiedad} gastos={detalle.gastosMes} mes={mes} hoy={hoy} companyId={companyId} moneda={moneda} permisos={permisos} />
        </>
      )}

      {modal === 'conceptos' && <ConceptosModal conceptos={conceptos} companyId={companyId} onClose={() => setModal(null)} />}
      {modal === 'importar' && propiedad && detalle && (
        <ImportarReservasModal propiedades={[propiedad]} propiedadFija={propiedad} reservas={detalle.reservas} conceptos={conceptos} hoy={hoy} onClose={() => setModal(null)} />
      )}
    </div>
  )
}
