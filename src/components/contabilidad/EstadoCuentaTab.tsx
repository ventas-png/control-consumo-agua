// Estado de cuenta por auxiliar (cliente) o por unidad en el ledger activo.
//
// Lo que esta pantalla NO decide: qué es un movimiento, su saldo, los totales,
// qué documento queda fuera del saldo ni si el saldo cuadra. Lo resuelven
// `conta_estado_cuenta`, `conta_estado_cuenta_pendientes` y
// `conta_estado_cuenta_conciliacion`, que además validan permiso, proyecto y
// sujeto. El saldo acumulado de cada fila y los totales vienen calculados
// sobre TODO el rango: cambiar de página no los altera, y aquí no se suman.
//
// Tres zonas, separadas a propósito:
//   · movimientos contables PUBLICADOS (lo único que forma el saldo);
//   · documentos fuera del saldo (pendientes, borradores, camino histórico,
//     cargos adicionales «pagados» sin pago vinculado), que nunca se suman;
//   · conciliación contra la contabilidad, a pedido.
import { useEffect, useMemo, useState } from 'react'
import { StatusBadge } from '../shared/StatusBadge'
import {
  ESTADO_CUENTA_POR_PAGINA,
  FUERA_DE_SALDO_POR_PAGINA,
  useAuxiliaresQuery,
  useEstadoCuentaConciliacionQuery,
  useEstadoCuentaFueraQuery,
  useEstadoCuentaQuery,
  useUnidadesLedgerQuery,
} from '../../domain/contabilidad/queries'
import { formatCurrency, formatDateShort } from '../../lib/format'
import {
  CLASE_DISCREPANCIA_LABELS,
  CLASE_FUERA_LABELS,
  TIPO_CARGO_LABELS,
  type ClaseFueraDeSaldo,
  type MovimientoEstadoCuenta,
  type SujetoEstadoCuenta,
} from '../../types/contabilidad'
import { AsientoDetalleModal } from './AsientoDetalleModal'
import { Campo, btnLink, btnSecundario, input } from './ui'

interface Props {
  companyId: string
  /** Ledger activo: null = contabilidad de la empresa (sin unidades). */
  projectId: string | null
  monedaBase: string
}

type Modo = 'cliente' | 'unidad'

const TONO_CLASE: Record<ClaseFueraDeSaldo, 'warning' | 'info' | 'neutral' | 'danger'> = {
  pendiente: 'warning',
  borrador: 'info',
  fuera_del_auxiliar: 'neutral',
  cobro_sin_vinculo: 'danger',
}

/** Un rango con la fecha inicial después de la final no se consulta. */
export function rangoInvalido(desde: string, hasta: string): boolean {
  return desde !== '' && hasta !== '' && desde > hasta
}

export function etiquetaTipoCargo(tipo: string | null): string {
  if (!tipo) return '—'
  return TIPO_CARGO_LABELS[tipo] ?? tipo
}

/** Texto de la marca de reverso de una fila, si la tiene. */
export function marcaReverso(m: Pick<MovimientoEstadoCuenta,
  'es_reverso' | 'reversa_de_numero' | 'reversado_por_id' | 'reversado_por_numero' | 'reversado_por_fecha'>): string | null {
  if (m.es_reverso) return `Reverso de la póliza #${m.reversa_de_numero ?? '?'}`
  if (m.reversado_por_id) {
    return `Reversado con la póliza #${m.reversado_por_numero ?? '?'}` +
      (m.reversado_por_fecha ? ` el ${formatDateShort(m.reversado_por_fecha)}` : '')
  }
  return null
}

export function EstadoCuentaTab({ companyId, projectId, monedaBase }: Props) {
  const [modo, setModo] = useState<Modo>('cliente')
  const [textoCliente, setTextoCliente] = useState('')
  const [busquedaCliente, setBusquedaCliente] = useState('')
  const [clienteId, setClienteId] = useState('')
  const [unidadId, setUnidadId] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [pagina, setPagina] = useState(0)
  const [paginaFuera, setPaginaFuera] = useState(0)
  const [conciliar, setConciliar] = useState(false)
  const [asientoAbierto, setAsientoAbierto] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setBusquedaCliente(textoCliente.trim()), 350)
    return () => clearTimeout(t)
  }, [textoCliente])

  const clientes = useAuxiliaresQuery(companyId, busquedaCliente || null)
  const unidades = useUnidadesLedgerQuery(companyId, projectId)

  const rangoMal = rangoInvalido(desde, hasta)
  const sujeto: SujetoEstadoCuenta | null = useMemo(() => {
    if (rangoMal) return null
    if (modo === 'cliente') return clienteId ? { tipo: 'cliente', id: clienteId } : null
    return unidadId ? { tipo: 'unidad', id: unidadId } : null
  }, [modo, clienteId, unidadId, rangoMal])

  // Cualquier cambio de sujeto o rango vuelve a la primera página y oculta la
  // conciliación anterior (era de otro sujeto o de otro corte).
  useEffect(() => {
    setPagina(0)
    setPaginaFuera(0)
    setConciliar(false)
  }, [sujeto?.tipo, sujeto?.id, desde, hasta])

  const estado = useEstadoCuentaQuery({
    companyId, projectId, sujeto, desde: desde || null, hasta: hasta || null, pagina,
  })
  const fuera = useEstadoCuentaFueraQuery({
    companyId, projectId, sujeto, hasta: hasta || null, pagina: paginaFuera,
  })
  const conciliacion = useEstadoCuentaConciliacionQuery({
    companyId, projectId, sujeto, corte: hasta || null, enabled: conciliar,
  })

  const datos = estado.data
  const movimientos = datos?.movimientos ?? []
  const totalMovs = datos?.resumen.movimientos ?? 0
  const paginas = Math.max(1, Math.ceil(totalMovs / ESTADO_CUENTA_POR_PAGINA))
  const filasFuera = fuera.data?.filas ?? []
  const totalFuera = fuera.data?.total ?? 0
  const paginasFuera = Math.max(1, Math.ceil(totalFuera / FUERA_DE_SALDO_POR_PAGINA))
  const dinero = (v: number | null | undefined) => formatCurrency(v, monedaBase)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--at-space-4)' }}>
      <p style={{ margin: 0, color: 'var(--at-ink-soft)', fontSize: 13 }}>
        Cargos, cobros y reversos <strong>contabilizados</strong> de un auxiliar o de una unidad en
        esta contabilidad. Cada movimiento conserva el responsable que tenía al emitirse: cambiar el
        pagador de una unidad no mueve deudas anteriores. Los documentos que todavía no tienen asiento
        publicado se listan aparte y no suman al saldo.
      </p>

      <fieldset style={{ border: '1px solid var(--at-line)', borderRadius: 12, padding: 12, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <legend style={{ fontSize: 12, fontWeight: 700, padding: '0 6px' }}>Consultar</legend>
        <div role="radiogroup" aria-label="Tipo de estado de cuenta" style={{ display: 'flex', gap: 6 }}>
          {(['cliente', 'unidad'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={modo === m}
              disabled={m === 'unidad' && !projectId}
              onClick={() => setModo(m)}
              style={{ ...btnSecundario, ...(modo === m ? { borderColor: 'var(--at-accent)', color: 'var(--at-accent)' } : {}) }}
            >
              {m === 'cliente' ? 'Por auxiliar' : 'Por unidad'}
            </button>
          ))}
        </div>

        {modo === 'cliente' ? (
          <>
            <Campo label="Buscar auxiliar">
              <input
                type="search"
                value={textoCliente}
                onChange={(e) => setTextoCliente(e.target.value)}
                placeholder="Nombre del cliente…"
                style={{ ...input, minWidth: 180 }}
              />
            </Campo>
            <Campo label="Auxiliar">
              <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} style={{ ...input, minWidth: 220 }}>
                <option value="">Elige un auxiliar…</option>
                {(clientes.data ?? []).map((c) => (
                  <option key={c.cliente_id} value={c.cliente_id}>
                    {c.cliente_nombre}{c.codigo ? ` · ${c.codigo}` : ''}
                  </option>
                ))}
              </select>
            </Campo>
          </>
        ) : (
          <Campo label="Unidad">
            <select value={unidadId} onChange={(e) => setUnidadId(e.target.value)} style={{ ...input, minWidth: 220 }}>
              <option value="">Elige una unidad…</option>
              {(unidades.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>{u.nombre}</option>
              ))}
            </select>
          </Campo>
        )}

        <Campo label="Desde">
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} style={input} />
        </Campo>
        <Campo label="Hasta (corte)">
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} style={input} />
        </Campo>
      </fieldset>

      {!projectId && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--at-ink-soft)' }}>
          La contabilidad de la empresa no tiene unidades: el estado de cuenta por unidad se consulta en la
          contabilidad de su proyecto.
        </p>
      )}
      {rangoMal && (
        <p role="alert" style={{ margin: 0, color: 'var(--at-danger)', fontSize: 13 }}>
          La fecha inicial es posterior a la final.
        </p>
      )}

      {!sujeto ? (
        !rangoMal && (
          <div role="status" style={{ border: '1px dashed var(--at-line)', borderRadius: 12, padding: 24, textAlign: 'center' }}>
            <strong>Elige un {modo === 'cliente' ? 'auxiliar' : 'una unidad'}</strong>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--at-ink-soft)' }}>
              El estado de cuenta se calcula en el servidor para el rango de fechas elegido.
            </p>
          </div>
        )
      ) : estado.isError ? (
        <div role="alert" style={{ border: '1px solid var(--at-danger)', borderRadius: 12, padding: 16 }}>
          <strong>No se pudo cargar el estado de cuenta.</strong>
          <p style={{ margin: '6px 0 10px', fontSize: 13 }}>
            {estado.error instanceof Error ? estado.error.message : 'Error desconocido.'}
          </p>
          <button type="button" style={btnSecundario} onClick={() => void estado.refetch()}>Reintentar</button>
        </div>
      ) : estado.isLoading || !datos ? (
        <p role="status" style={{ margin: 0 }}>Calculando estado de cuenta…</p>
      ) : (
        <>
          <section aria-labelledby="ec-resumen">
            <h3 id="ec-resumen" style={{ margin: '0 0 8px', fontSize: 15 }}>
              {datos.sujeto?.nombre ?? 'Estado de cuenta'}
              {datos.sujeto?.codigo_auxiliar ? ` · ${datos.sujeto.codigo_auxiliar}` : ''}
            </h3>
            <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, margin: 0 }}>
              {[
                ['Saldo inicial', datos.resumen.saldo_inicial],
                ['Cargos del período', datos.resumen.cargos],
                ['Abonos del período', datos.resumen.abonos],
                ['Saldo final', datos.resumen.saldo_final],
              ].map(([label, valor]) => (
                <div key={label as string} style={{ border: '1px solid var(--at-line)', borderRadius: 10, padding: 10 }}>
                  <dt style={{ fontSize: 11, color: 'var(--at-ink-soft)', fontWeight: 600 }}>{label}</dt>
                  <dd style={{ margin: '4px 0 0', fontSize: 16, fontWeight: 800 }}>{dinero(valor as number)}</dd>
                </div>
              ))}
            </dl>
            {datos.por_tipo.length > 1 && (
              <table style={{ marginTop: 10, borderCollapse: 'collapse', fontSize: 12 }}>
                <caption style={{ textAlign: 'left', color: 'var(--at-ink-soft)', paddingBottom: 4 }}>Por tipo de cargo</caption>
                <thead>
                  <tr style={{ color: 'var(--at-ink-soft)', textAlign: 'left' }}>
                    <th style={{ padding: '2px 8px' }}>Tipo</th>
                    <th style={{ padding: '2px 8px', textAlign: 'right' }}>Cargos</th>
                    <th style={{ padding: '2px 8px', textAlign: 'right' }}>Abonos</th>
                    <th style={{ padding: '2px 8px', textAlign: 'right' }}>Saldo final</th>
                  </tr>
                </thead>
                <tbody>
                  {datos.por_tipo.map((t) => (
                    <tr key={t.tipo_cargo ?? 'sin-tipo'}>
                      <td style={{ padding: '2px 8px' }}>{etiquetaTipoCargo(t.tipo_cargo)}</td>
                      <td style={{ padding: '2px 8px', textAlign: 'right' }}>{dinero(t.cargos)}</td>
                      <td style={{ padding: '2px 8px', textAlign: 'right' }}>{dinero(t.abonos)}</td>
                      <td style={{ padding: '2px 8px', textAlign: 'right', fontWeight: 700 }}>{dinero(t.saldo_final)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section aria-labelledby="ec-movimientos">
            <h3 id="ec-movimientos" style={{ margin: '0 0 8px', fontSize: 15 }}>Movimientos contabilizados</h3>
            {movimientos.length === 0 ? (
              <p role="status" style={{ margin: 0, fontSize: 13, color: 'var(--at-ink-soft)' }}>
                Sin movimientos contabilizados en el rango.
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <caption style={{ textAlign: 'left', fontSize: 12, color: 'var(--at-ink-soft)', paddingBottom: 6 }}>
                    {totalMovs} movimiento{totalMovs === 1 ? '' : 's'} · saldo acumulado calculado sobre todo el rango
                  </caption>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--at-ink-soft)', fontSize: 11, borderBottom: '1px solid var(--at-line)' }}>
                      <th style={{ padding: 6 }}>Fecha</th>
                      <th style={{ padding: 6 }}>Documento</th>
                      <th style={{ padding: 6 }}>Concepto</th>
                      <th style={{ padding: 6 }}>Tipo de cargo</th>
                      <th style={{ padding: 6 }}>{modo === 'cliente' ? 'Unidad' : 'Responsable'}</th>
                      <th style={{ padding: 6, textAlign: 'right' }}>Cargo</th>
                      <th style={{ padding: 6, textAlign: 'right' }}>Abono</th>
                      <th style={{ padding: 6, textAlign: 'right' }}>Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movimientos.map((m) => {
                      const reverso = marcaReverso(m)
                      return (
                        <tr key={m.linea_id} style={{ borderBottom: '1px solid var(--at-line)', verticalAlign: 'top' }}>
                          <td style={{ padding: 6, whiteSpace: 'nowrap' }}>{formatDateShort(m.fecha)}</td>
                          <td style={{ padding: 6 }}>
                            <div style={{ fontWeight: 600 }}>{m.documento}</div>
                            <button type="button" style={btnLink} onClick={() => setAsientoAbierto(m.asiento_id)}>
                              Póliza #{m.asiento_numero ?? '—'}
                            </button>
                            {reverso && (
                              <div style={{ marginTop: 2 }}>
                                <StatusBadge tone={m.es_reverso ? 'info' : 'neutral'}>{reverso}</StatusBadge>
                              </div>
                            )}
                          </td>
                          <td style={{ padding: 6, maxWidth: 280 }}>
                            <div>{m.concepto}</div>
                            <div style={{ color: 'var(--at-ink-soft)', fontSize: 12 }}>
                              {m.cuenta_codigo} · {m.cuenta_nombre}
                            </div>
                          </td>
                          <td style={{ padding: 6 }}>
                            <div>{etiquetaTipoCargo(m.tipo_cargo)}</div>
                            {m.componente && m.documento_tabla === 'pagos' && (
                              <StatusBadge tone={m.componente === 'mora' ? 'warning' : 'neutral'}>
                                {m.componente === 'mora' ? 'Aplicado a mora' : 'Aplicado a principal'}
                              </StatusBadge>
                            )}
                          </td>
                          <td style={{ padding: 6 }}>
                            {modo === 'cliente' ? (m.unidad_nombre ?? '—') : (m.auxiliar_nombre ?? '—')}
                          </td>
                          <td style={{ padding: 6, textAlign: 'right', whiteSpace: 'nowrap' }}>{m.cargo ? dinero(m.cargo) : ''}</td>
                          <td style={{ padding: 6, textAlign: 'right', whiteSpace: 'nowrap' }}>{m.abono ? dinero(m.abono) : ''}</td>
                          <td style={{ padding: 6, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700 }}>{dinero(m.saldo)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {paginas > 1 && (
              <nav aria-label="Paginación de movimientos" style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" style={btnSecundario} disabled={pagina === 0} onClick={() => setPagina((p) => Math.max(0, p - 1))}>Anterior</button>
                <span style={{ fontSize: 12 }}>Página {pagina + 1} de {paginas}</span>
                <button type="button" style={btnSecundario} disabled={pagina + 1 >= paginas} onClick={() => setPagina((p) => p + 1)}>Siguiente</button>
              </nav>
            )}
          </section>

          <section aria-labelledby="ec-fuera">
            <h3 id="ec-fuera" style={{ margin: '0 0 4px', fontSize: 15 }}>Fuera del saldo contable</h3>
            <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--at-ink-soft)' }}>
              Documentos del {modo === 'cliente' ? 'auxiliar' : 'la unidad'} sin asiento publicado con su dimensión.
              Se informan con su motivo y <strong>no suman</strong> al saldo de arriba.
            </p>
            {datos.fuera_de_saldo.length > 0 && (
              <ul aria-label="Resumen fuera del saldo" style={{ listStyle: 'none', padding: 0, margin: '0 0 8px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {datos.fuera_de_saldo.map((f) => (
                  <li key={`${f.clase}:${f.naturaleza}`}>
                    <StatusBadge tone={TONO_CLASE[f.clase]}>
                      {CLASE_FUERA_LABELS[f.clase]} · {f.naturaleza === 'abono' ? 'cobros' : 'cargos'}: {f.documentos} · {dinero(f.monto)}
                    </StatusBadge>
                  </li>
                ))}
              </ul>
            )}
            {fuera.isError ? (
              <p role="alert" style={{ margin: 0, color: 'var(--at-danger)', fontSize: 13 }}>
                No se pudo cargar la lista: {fuera.error instanceof Error ? fuera.error.message : 'error desconocido'}.
              </p>
            ) : filasFuera.length === 0 ? (
              <p role="status" style={{ margin: 0, fontSize: 13, color: 'var(--at-ink-soft)' }}>
                {fuera.isLoading ? 'Cargando…' : 'Nada fuera del saldo.'}
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--at-ink-soft)', fontSize: 11, borderBottom: '1px solid var(--at-line)' }}>
                      <th style={{ padding: 6 }}>Fecha</th>
                      <th style={{ padding: 6 }}>Documento</th>
                      <th style={{ padding: 6 }}>Clase</th>
                      <th style={{ padding: 6, textAlign: 'right' }}>Importe</th>
                      <th style={{ padding: 6 }}>Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filasFuera.map((f) => (
                      <tr key={`${f.origen_tabla}:${f.origen_id}:${f.evento}`} style={{ borderBottom: '1px solid var(--at-line)', verticalAlign: 'top' }}>
                        <td style={{ padding: 6, whiteSpace: 'nowrap' }}>{formatDateShort(f.fecha)}</td>
                        <td style={{ padding: 6 }}>
                          <div style={{ fontWeight: 600 }}>{f.concepto}</div>
                          <div style={{ color: 'var(--at-ink-soft)', fontSize: 12 }}>
                            {etiquetaTipoCargo(f.tipo_cargo)} · {f.unidad_nombre ?? '—'} · {f.responsable_nombre ?? 'Sin responsable'}
                          </div>
                          {f.asiento_id && (
                            <button type="button" style={btnLink} onClick={() => setAsientoAbierto(f.asiento_id)}>
                              Póliza #{f.asiento_numero ?? '—'}
                            </button>
                          )}
                        </td>
                        <td style={{ padding: 6 }}>
                          <StatusBadge tone={TONO_CLASE[f.clase]}>{CLASE_FUERA_LABELS[f.clase]}</StatusBadge>
                        </td>
                        <td style={{ padding: 6, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {f.naturaleza === 'abono' ? `−${dinero(f.monto)}` : dinero(f.monto)}
                        </td>
                        <td style={{ padding: 6, maxWidth: 360, fontSize: 12 }}>{f.motivo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {paginasFuera > 1 && (
              <nav aria-label="Paginación de documentos fuera del saldo" style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" style={btnSecundario} disabled={paginaFuera === 0} onClick={() => setPaginaFuera((p) => Math.max(0, p - 1))}>Anterior</button>
                <span style={{ fontSize: 12 }}>Página {paginaFuera + 1} de {paginasFuera}</span>
                <button type="button" style={btnSecundario} disabled={paginaFuera + 1 >= paginasFuera} onClick={() => setPaginaFuera((p) => p + 1)}>Siguiente</button>
              </nav>
            )}
          </section>

          <section aria-labelledby="ec-conciliacion">
            <h3 id="ec-conciliacion" style={{ margin: '0 0 4px', fontSize: 15 }}>Conciliación con la contabilidad</h3>
            <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--at-ink-soft)' }}>
              Compara el saldo de las cuentas por cobrar con los documentos por tipo y las aplicaciones reales de
              los cobros, al corte {hasta ? formatDateShort(hasta) : 'de hoy (sin límite)'}.
            </p>
            {!conciliar ? (
              <button type="button" style={btnSecundario} onClick={() => setConciliar(true)}>Conciliar</button>
            ) : conciliacion.isError ? (
              <p role="alert" style={{ margin: 0, color: 'var(--at-danger)', fontSize: 13 }}>
                No se pudo conciliar: {conciliacion.error instanceof Error ? conciliacion.error.message : 'error desconocido'}.
              </p>
            ) : !conciliacion.data ? (
              <p role="status" style={{ margin: 0 }}>Conciliando…</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div>
                  <StatusBadge tone={conciliacion.data.cuadra ? 'success' : 'danger'}>
                    {conciliacion.data.cuadra ? 'Cuadra' : 'No cuadra'}
                  </StatusBadge>{' '}
                  <span style={{ fontSize: 13 }}>
                    Contable {dinero(conciliacion.data.saldo_contable)} · documentos {dinero(conciliacion.data.saldo_documentos)} ·
                    diferencia {dinero(conciliacion.data.diferencia)}
                  </span>
                </div>
                {conciliacion.data.por_cuenta.length > 0 && (
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--at-ink-soft)' }}>
                    Por cuenta: {conciliacion.data.por_cuenta.map((c) => `${c.codigo} ${dinero(c.saldo)}`).join(' · ')}
                  </p>
                )}
                {conciliacion.data.discrepancias.length > 0 && (
                  <ul aria-label="Discrepancias" style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                    {conciliacion.data.discrepancias.map((d, i) => (
                      <li key={`${d.clase}:${d.origen_id ?? ''}:${d.asiento_id ?? ''}:${i}`}>
                        {CLASE_DISCREPANCIA_LABELS[d.clase]}: contable {dinero(d.contable)}, documentos {dinero(d.documentos)}
                        {d.asiento_id && (
                          <>
                            {' · '}
                            <button type="button" style={btnLink} onClick={() => setAsientoAbierto(d.asiento_id)}>
                              Póliza #{d.asiento_numero ?? '—'}
                            </button>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {conciliacion.data.total_discrepancias > conciliacion.data.discrepancias.length && (
                  <p style={{ margin: 0, fontSize: 12 }}>
                    Se muestran {conciliacion.data.discrepancias.length} de {conciliacion.data.total_discrepancias} discrepancias.
                  </p>
                )}
              </div>
            )}
          </section>
        </>
      )}

      {asientoAbierto && (
        <AsientoDetalleModal asientoId={asientoAbierto} monedaBase={monedaBase} onClose={() => setAsientoAbierto(null)} />
      )}
    </div>
  )
}
