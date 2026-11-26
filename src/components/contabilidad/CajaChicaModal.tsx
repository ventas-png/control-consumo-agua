// Caja chica como fondo fijo con reposición. La cuenta «Caja chica» guarda
// siempre el monto del fondo: se constituye una vez (Dr Caja chica / Cr Banco)
// y los vales llegan al gasto al REPONER (Dr gastos / Cr Banco), no al gastar.
// Las reglas viven en conta_caja_chica_constituir y conta_caja_chica_reponer.
import { useMemo, useState } from 'react'
import { EditModal } from '../shared/EditModal'
import { notify } from '../shared/Dialog'
import { useCajaChicaConstituirMutation, useCajaChicaReponerMutation } from '../../domain/contabilidad/mutations'
import { useCajasChicasQuery, useCuentasQuery } from '../../domain/contabilidad/queries'
import { formatCurrency, formatDateShort, hoyLocalISO } from '../../lib/format'
import type { ReposicionCajaFila } from '../../types/contabilidad'
import { Campo, btnPrimario, btnSecundario, input } from './ui'

interface Props {
  companyId: string
  projectId: string
  monedaBase: string
  /** Constituir y reponer exigen crear y cambiar estado en Contabilidad (y el permiso de caja chica en Condominios, que valida el servidor). */
  puedeRegistrar: boolean
  onClose: () => void
}

export function CajaChicaModal({ companyId, projectId, monedaBase, puedeRegistrar, onClose }: Props) {
  const { data: cajas = [], isLoading } = useCajasChicasQuery(companyId, projectId)
  const { data: cuentas = [] } = useCuentasQuery(companyId, projectId)
  const constituir = useCajaChicaConstituirMutation()
  const reponer = useCajaChicaReponerMutation()

  const [cajaSel, setCajaSel] = useState('')
  const [fecha, setFecha] = useState(hoyLocalISO())
  const [cuentaCaja, setCuentaCaja] = useState('')
  const [cuentaBanco, setCuentaBanco] = useState('')
  const [vales, setVales] = useState<ReposicionCajaFila[] | null>(null)
  const [cuentaDeVale, setCuentaDeVale] = useState<Record<string, string>>({})
  const [repuesto, setRepuesto] = useState(false)

  const abiertas = useMemo(() => cajas.filter((c) => c.estado === 'abierta'), [cajas])
  const caja = abiertas.find((c) => c.caja_id === cajaSel) ?? abiertas[0] ?? null
  const detalle = useMemo(() => cuentas.filter((c) => c.es_detalle && c.activa), [cuentas])
  const activos = useMemo(() => detalle.filter((c) => c.tipo === 'activo'), [detalle])
  // Para el vale: cualquier cuenta de detalle que no sea la caja ni el banco (lo usual es un gasto).
  const paraVale = useMemo(
    () => detalle.filter((c) => c.id !== caja?.cuenta_caja_id && c.id !== cuentaBanco)
      .sort((a, b) => Number(b.tipo === 'gasto') - Number(a.tipo === 'gasto')),
    [detalle, caja?.cuenta_caja_id, cuentaBanco],
  )

  function limpiar() { setVales(null); setRepuesto(false) }

  async function hacerConstituir() {
    if (!caja) return
    try {
      await constituir.mutateAsync({ cajaId: caja.caja_id, fecha, cuentaCajaId: cuentaCaja, cuentaBancoId: cuentaBanco })
      notify({ variant: 'success', title: 'Fondo constituido', text: `Caja chica por ${formatCurrency(caja.monto_fondo, monedaBase)} contra el banco.`, duration: 2800 })
    } catch (err) {
      notify({ variant: 'error', title: 'No se pudo constituir', text: err instanceof Error ? err.message : 'Intente de nuevo.' })
    }
  }

  async function hacerReponer(aplicar: boolean) {
    if (!caja) return
    try {
      const lineas = Object.entries(cuentaDeVale).filter(([, c]) => c).map(([movimiento_id, cuenta_gasto_id]) => ({ movimiento_id, cuenta_gasto_id }))
      const data = (await reponer.mutateAsync({ cajaId: caja.caja_id, fecha, cuentaBancoId: cuentaBanco, lineas, aplicar })) ?? []
      setVales(data)
      setRepuesto(aplicar)
      if (aplicar) {
        const hechos = data.filter((v) => v.resultado === 'repuesto')
        const total = Math.round(hechos.reduce((s, v) => s + v.monto, 0) * 100) / 100
        const pendientes = data.length - hechos.length
        notify({
          variant: pendientes > 0 ? 'warning' : 'success',
          title: 'Caja chica repuesta',
          text: `${hechos.length} vale(s) por ${formatCurrency(total, monedaBase)} pasaron al gasto.`
            + (pendientes > 0 ? ` ${pendientes} quedaron pendientes por falta de cuenta.` : ''),
          duration: 3200,
        })
      }
    } catch (err) {
      notify({ variant: 'error', title: 'No se pudo reponer', text: err instanceof Error ? err.message : 'Intente de nuevo.' })
    }
  }

  const conCuenta = (vales ?? []).filter((v) => (cuentaDeVale[v.movimiento_id] || v.cuenta_gasto_id) && v.resultado !== 'repuesto')
  const totalListo = Math.round(conCuenta.reduce((s, v) => s + v.monto, 0) * 100) / 100

  return (
    <EditModal title="Caja chica — fondo fijo" onClose={onClose} maxWidth="900px">
      <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--at-ink-3)', lineHeight: 1.6 }}>
        La caja chica se lleva como <strong>fondo fijo</strong>: se constituye una vez y su cuenta contable conserva
        siempre ese monto. Los vales se capturan en Condominios › Caja chica; aquí se <strong>reponen</strong>: una
        póliza lleva cada vale a su cuenta de gasto contra el banco, y la caja vuelve a su fondo.
      </p>

      {isLoading ? (
        <p style={{ fontSize: 13.5, color: 'var(--at-ink-3)' }}>Cargando cajas…</p>
      ) : !caja ? (
        <p style={{ fontSize: 13.5, color: 'var(--at-ink-3)', padding: '8px 0' }}>
          Este proyecto no tiene una caja chica abierta. Ábrala en Condominios › Caja chica, con su responsable y el monto del fondo.
        </p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
            <Campo label="Caja">
              <select aria-label="Caja" style={{ ...input, minWidth: 240 }} value={caja.caja_id} onChange={(e) => { setCajaSel(e.target.value); limpiar(); setCuentaDeVale({}) }}>
                {abiertas.map((c) => (
                  <option key={c.caja_id} value={c.caja_id}>{c.responsable} · fondo {formatCurrency(c.monto_fondo, monedaBase)}</option>
                ))}
              </select>
            </Campo>
            <Campo label="Fecha">
              <input aria-label="Fecha" type="date" style={input} value={fecha} max={hoyLocalISO()} onChange={(e) => { setFecha(e.target.value); limpiar() }} />
            </Campo>
            <Campo label="Banco que entrega el dinero">
              <select aria-label="Banco" style={{ ...input, minWidth: 260 }} value={cuentaBanco} onChange={(e) => { setCuentaBanco(e.target.value); limpiar() }}>
                <option value="">Elija la cuenta de banco…</option>
                {activos.filter((c) => c.id !== caja.cuenta_caja_id).map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
              </select>
            </Campo>
          </div>

          {!caja.cuenta_caja_id ? (
            <div style={{ border: '1px solid var(--at-line)', borderRadius: 8, padding: 12 }}>
              <p style={{ margin: '0 0 10px', fontSize: 13, lineHeight: 1.5 }}>
                <strong>Paso 1 · Constituir el fondo.</strong> Esta caja aún no existe en libros. Se registra
                Dr Caja chica / Cr Banco por {formatCurrency(caja.monto_fondo, monedaBase)}, una sola vez.
              </p>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <Campo label="Cuenta contable de la caja chica">
                  <select aria-label="Cuenta de caja chica" style={{ ...input, minWidth: 280 }} value={cuentaCaja} onChange={(e) => setCuentaCaja(e.target.value)}>
                    <option value="">Elija la cuenta…</option>
                    {activos.filter((c) => c.id !== cuentaBanco).map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
                  </select>
                </Campo>
                {puedeRegistrar && (
                  <button
                    style={{ ...btnPrimario, opacity: cuentaCaja && cuentaBanco ? 1 : 0.5 }}
                    disabled={!cuentaCaja || !cuentaBanco || !fecha || constituir.isPending}
                    onClick={() => void hacerConstituir()}
                  >
                    {constituir.isPending ? 'Registrando…' : 'Constituir fondo'}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
                <span style={{ fontSize: 13 }}>
                  Pendiente de reponer: <strong>{caja.vales_pendientes} vale(s) · {formatCurrency(caja.total_pendiente, monedaBase)}</strong>
                </span>
                <span style={{ flex: 1 }} />
                <button style={btnSecundario} disabled={!cuentaBanco || !fecha || reponer.isPending} onClick={() => void hacerReponer(false)}>
                  {reponer.isPending ? 'Consultando…' : '🔍 Ver vales pendientes'}
                </button>
                {puedeRegistrar && (
                  <button
                    style={{ ...btnPrimario, opacity: conCuenta.length > 0 && !repuesto ? 1 : 0.5 }}
                    disabled={conCuenta.length === 0 || repuesto || reponer.isPending}
                    onClick={() => void hacerReponer(true)}
                  >
                    ✓ Reponer {conCuenta.length > 0 && !repuesto ? formatCurrency(totalListo, monedaBase) : ''}
                  </button>
                )}
              </div>

              {vales !== null && (
                vales.length === 0 ? (
                  <p style={{ fontSize: 13.5, color: 'var(--at-ink-3)' }}>No hay vales pendientes de reponer a esa fecha.</p>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid var(--at-line)', textAlign: 'left' }}>
                          <th style={{ padding: '8px 6px' }}>Fecha</th>
                          <th style={{ padding: '8px 6px' }}>Vale</th>
                          <th style={{ padding: '8px 6px', textAlign: 'right' }}>Monto</th>
                          <th style={{ padding: '8px 6px' }}>Cuenta de gasto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {vales.map((v) => (
                          <tr key={v.movimiento_id} style={{ borderBottom: '1px solid var(--at-chip)' }}>
                            <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>{formatDateShort(v.fecha)}</td>
                            <td style={{ padding: '8px 6px' }}>
                              {v.concepto}
                              {v.comprobante && <span style={{ color: 'var(--at-ink-3)' }}> · {v.comprobante}</span>}
                            </td>
                            <td style={{ padding: '8px 6px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(v.monto, monedaBase)}</td>
                            <td style={{ padding: '8px 6px' }}>
                              {v.resultado === 'repuesto' ? (
                                <span style={{ color: 'var(--at-success-strong)', fontWeight: 600 }}>✓ {v.cuenta_codigo} · {v.cuenta_nombre}</span>
                              ) : (
                                <select
                                  aria-label={`Cuenta de gasto de ${v.concepto}`}
                                  style={{ ...input, width: '100%', minWidth: 220 }}
                                  value={cuentaDeVale[v.movimiento_id] ?? v.cuenta_gasto_id ?? ''}
                                  disabled={repuesto}
                                  onChange={(e) => setCuentaDeVale((m) => ({ ...m, [v.movimiento_id]: e.target.value }))}
                                >
                                  <option value="">Elija la cuenta…</option>
                                  {paraVale.map((c) => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
                                </select>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!repuesto && (
                      <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--at-ink-3)' }}>
                        Se reponen los vales con cuenta; los que no la tengan quedan pendientes para la siguiente reposición.
                      </p>
                    )}
                  </div>
                )
              )}
            </>
          )}

          {!puedeRegistrar && (
            <p style={{ fontSize: 12.5, color: 'var(--at-ink-3)', margin: '12px 0 0' }}>
              Solo consulta. Constituir y reponer requieren «Crear» y «Cambiar estado» en Contabilidad y el permiso de caja chica en Condominios.
            </p>
          )}
        </>
      )}
    </EditModal>
  )
}
