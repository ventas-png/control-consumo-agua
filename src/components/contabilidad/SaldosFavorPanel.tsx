// Saldos a favor del sujeto del estado de cuenta (20261007000000).
//
// Tres cosas, en este orden:
//   · de dónde sale cada saldo (excedente de un cobro o anticipo) y cuánto
//     queda disponible, con los anticipos que todavía no son saldo;
//   · aplicar un saldo a UN documento posterior: el usuario elige el origen,
//     el documento y el importe. No hay prioridad automática;
//   · las aplicaciones hechas, con su reverso (quién, cuándo y por qué).
//
// Nada se calcula aquí: disponible, saldo del documento, titular, moneda y el
// reparto mora/principal los decide el servidor, que también valida permisos.
// Las claves de idempotencia se fijan al abrir cada formulario y se conservan
// en los reintentos: un doble clic o una respuesta perdida no duplican nada.
import { useEffect, useMemo, useState } from 'react'
import { StatusBadge } from '../shared/StatusBadge'
import { notify } from '../shared/Dialog'
import { openTextPrompt } from '../shared/PromptDialog'
import { usePermissionsContext } from '../shared/PermissionsContext'
import { formatCurrency, formatDateShort, hoyLocalISO } from '../../lib/format'
import {
  METODOS_ANTICIPO,
  TIPO_ORIGEN_LABELS,
  clasificarFalloSaldoFavor,
  explicarErrorSaldoFavor,
  useAnularAnticipoMutation,
  useAplicarSaldoFavorMutation,
  useDocumentosSaldoFavorQuery,
  useRegistrarAnticipoMutation,
  useRevertirAplicacionMutation,
  useSaldosFavorQuery,
  type MetodoAnticipo,
  type OrigenSaldoFavor,
} from '../../domain/contabilidad/saldosFavor'
import type { SujetoEstadoCuenta } from '../../types/contabilidad'
import { Campo, btnLink, btnPrimario, btnSecundario, input } from './ui'

interface Props {
  companyId: string
  projectId: string
  sujeto: SujetoEstadoCuenta
  /** Para registrar un anticipo: las unidades del ledger y los auxiliares. */
  unidades: Array<{ id: string; nombre: string }>
  clientes: Array<{ cliente_id: string; cliente_nombre: string }>
  onAbrirAsiento: (asientoId: string) => void
}

const TONO_ESTADO: Record<string, 'success' | 'neutral' | 'warning'> = {
  vigente: 'success',
  reversado: 'neutral',
  borrador: 'warning',
}

export function SaldosFavorPanel({ companyId, projectId, sujeto, unidades, clientes, onAbrirAsiento }: Props) {
  const perms = usePermissionsContext()
  const puedeAnticipo = perms.canEdit('condominios')
  const saldos = useSaldosFavorQuery({
    companyId, projectId,
    clienteId: sujeto.tipo === 'cliente' ? sujeto.id : null,
    unidadId: sujeto.tipo === 'unidad' ? sujeto.id : null,
  })
  const anular = useAnularAnticipoMutation(companyId)
  const revertir = useRevertirAplicacionMutation(companyId)
  const [origenAplicar, setOrigenAplicar] = useState<OrigenSaldoFavor | null>(null)
  const [anticipoAbierto, setAnticipoAbierto] = useState(false)

  // Otro sujeto: cerrar los formularios del anterior.
  useEffect(() => { setOrigenAplicar(null); setAnticipoAbierto(false) }, [sujeto.tipo, sujeto.id])

  const d = saldos.data
  const puedeAplicar = !!d?.puede_aplicar

  async function anularAnticipo(o: OrigenSaldoFavor) {
    const motivo = await openTextPrompt({
      title: 'Anular anticipo',
      description: 'El anticipo no se borra: queda rechazado con este motivo y su asiento se reversa. Si su saldo ya se aplicó, primero revierte esas aplicaciones.',
      label: 'Motivo',
      required: true,
      validate: (v) => (v.trim().length < 3 ? 'Indica el motivo.' : null),
    })
    if (!motivo) return
    try {
      const r = await anular.mutateAsync({ pagoId: o.pago_id, motivo: motivo.trim() })
      notify({
        variant: 'success',
        title: r.resultado === 'ya_anulado' ? 'El anticipo ya estaba anulado' : 'Anticipo anulado',
        text: r.reverso_numero ? `Reverso en la póliza #${r.reverso_numero}.` : 'No tenía asiento que reversar.',
      })
    } catch (e) {
      notify({ variant: 'error', title: 'No se anuló el anticipo', text: explicarErrorSaldoFavor(e instanceof Error ? e.message : String(e)) })
    }
  }

  async function revertirAplicacion(aplicacionId: string) {
    const motivo = await openTextPrompt({
      title: 'Revertir aplicación',
      description: 'Se genera el asiento de reverso: el documento vuelve a deber y el saldo vuelve a estar disponible. La aplicación original queda como evidencia.',
      label: 'Motivo',
      required: true,
      validate: (v) => (v.trim().length < 3 ? 'Indica el motivo.' : null),
    })
    if (!motivo) return
    try {
      const r = await revertir.mutateAsync({ aplicacionId, motivo: motivo.trim() })
      notify({
        variant: 'success',
        title: r.resultado === 'ya_revertida' ? 'La aplicación ya estaba revertida' : 'Aplicación revertida',
        text: (r.reverso_numero ? `Reverso en la póliza #${r.reverso_numero}. ` : '')
          + `Disponible del saldo: ${r.disponible_restante.toFixed(2)}.`,
      })
    } catch (e) {
      notify({ variant: 'error', title: 'No se revirtió', text: explicarErrorSaldoFavor(e instanceof Error ? e.message : String(e)) })
    }
  }

  return (
    <section aria-labelledby="ec-saldo-favor" style={{ border: '1px solid var(--at-line)', borderRadius: 12, padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <h3 id="ec-saldo-favor" style={{ margin: 0, fontSize: 15 }}>Saldos a favor</h3>
        {puedeAnticipo && !anticipoAbierto && (
          <button type="button" style={btnSecundario} onClick={() => setAnticipoAbierto(true)}>Registrar anticipo</button>
        )}
      </div>
      <p style={{ margin: '4px 0 8px', fontSize: 12, color: 'var(--at-ink-soft)' }}>
        Excedentes de cobros y anticipos del {sujeto.tipo === 'cliente' ? 'auxiliar' : 'la unidad'}. Cada saldo es de su
        cliente y su unidad, en su moneda: sólo se aplica a documentos de ese mismo titular, y siempre por decisión
        explícita. No forma parte del saldo de cuentas por cobrar de arriba.
      </p>

      {saldos.isError ? (
        <p role="alert" style={{ margin: 0, color: 'var(--at-danger)', fontSize: 13 }}>
          No se pudieron cargar los saldos a favor: {saldos.error instanceof Error ? saldos.error.message : 'error desconocido'}.
        </p>
      ) : !d ? (
        <p role="status" style={{ margin: 0, fontSize: 13 }}>Cargando saldos a favor…</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {d.cuenta_anticipos?.codigo && (
            <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--at-warning)' }}>
              <strong>Cuenta de anticipos sin configurar.</strong> {d.cuenta_anticipos.motivo} Mientras tanto, los cobros
              con excedente y los anticipos quedan registrados y pendientes de contabilizar.
            </p>
          )}

          <div aria-label="Disponible" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {d.disponible_por_moneda.length === 0 ? (
              <span style={{ fontSize: 13, color: 'var(--at-ink-soft)' }}>Sin saldos a favor.</span>
            ) : d.disponible_por_moneda.map((m) => (
              <div key={m.moneda} style={{ border: '1px solid var(--at-line)', borderRadius: 10, padding: '6px 10px' }}>
                <div style={{ fontSize: 11, color: 'var(--at-ink-soft)', fontWeight: 600 }}>Disponible</div>
                <div style={{ fontSize: 16, fontWeight: 800 }}>{formatCurrency(m.disponible, m.moneda)}</div>
              </div>
            ))}
          </div>

          {d.anticipos_pendientes.length > 0 && (
            <div role="note" aria-label="Anticipos sin contabilizar" style={{ border: '1px solid var(--at-warning)', borderRadius: 10, padding: 10, fontSize: 12 }}>
              <strong>Anticipos registrados que todavía no son saldo</strong> (no se pueden aplicar hasta contabilizarse;
              se reprocesan desde Contabilidad › Pendientes):
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {d.anticipos_pendientes.map((a) => (
                  <li key={a.pago_id}>
                    {formatDateShort(a.fecha)} · {a.cliente_nombre ?? '—'} · {a.unidad_nombre ?? '—'} · {a.monto.toFixed(2)}
                    {a.motivo ? ` — ${a.motivo}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {d.origenes.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table aria-label="Orígenes de saldo a favor" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--at-ink-soft)', fontSize: 11, borderBottom: '1px solid var(--at-line)' }}>
                    <th style={{ padding: 6 }}>Fecha</th>
                    <th style={{ padding: 6 }}>Origen</th>
                    <th style={{ padding: 6 }}>Titular</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>Importe</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>Aplicado</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>Disponible</th>
                    <th style={{ padding: 6 }} />
                  </tr>
                </thead>
                <tbody>
                  {d.origenes.map((o) => (
                    <tr key={o.origen_id} style={{ borderBottom: '1px solid var(--at-line)', verticalAlign: 'top' }}>
                      <td style={{ padding: 6, whiteSpace: 'nowrap' }}>{formatDateShort(o.fecha)}</td>
                      <td style={{ padding: 6 }}>
                        <div style={{ fontWeight: 600 }}>{TIPO_ORIGEN_LABELS[o.tipo]}</div>
                        <div style={{ fontSize: 12, color: 'var(--at-ink-soft)' }}>
                          {o.documento ? `${o.documento} · ` : ''}Cobro {o.metodo ?? ''}{o.referencia ? ` ref. ${o.referencia}` : ''}
                          {o.cobro_monto != null ? ` de ${formatCurrency(o.cobro_monto, o.moneda)}` : ''}
                        </div>
                        <button type="button" style={btnLink} onClick={() => onAbrirAsiento(o.asiento_id)}>
                          Póliza #{o.asiento_numero ?? '—'}
                        </button>{' '}
                        <StatusBadge tone={TONO_ESTADO[o.estado] ?? 'neutral'}>{o.estado}</StatusBadge>
                      </td>
                      <td style={{ padding: 6, fontSize: 12 }}>{o.cliente_nombre ?? '—'} · {o.unidad_nombre ?? '—'}</td>
                      <td style={{ padding: 6, textAlign: 'right', whiteSpace: 'nowrap' }}>{formatCurrency(o.monto, o.moneda)}</td>
                      <td style={{ padding: 6, textAlign: 'right', whiteSpace: 'nowrap' }}>{formatCurrency(o.aplicado, o.moneda)}</td>
                      <td style={{ padding: 6, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700 }}>{formatCurrency(o.disponible, o.moneda)}</td>
                      <td style={{ padding: 6, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {puedeAplicar && o.estado === 'vigente' && o.disponible > 0 && (
                          <button type="button" style={btnSecundario} onClick={() => setOrigenAplicar(o)}>Aplicar</button>
                        )}
                        {puedeAnticipo && o.tipo === 'anticipo' && o.estado === 'vigente' && o.aplicado === 0 && (
                          <button type="button" style={{ ...btnLink, marginLeft: 8 }} disabled={anular.isPending}
                            onClick={() => void anularAnticipo(o)}>
                            Anular
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {origenAplicar && (
            <AplicarForm
              key={origenAplicar.origen_id}
              companyId={companyId}
              origen={origenAplicar}
              onCerrar={() => setOrigenAplicar(null)}
            />
          )}

          {anticipoAbierto && (
            <AnticipoForm
              companyId={companyId}
              projectId={projectId}
              sujeto={sujeto}
              unidades={unidades}
              clientes={clientes}
              onCerrar={() => setAnticipoAbierto(false)}
            />
          )}

          {d.aplicaciones.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table aria-label="Aplicaciones de saldo a favor" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <caption style={{ textAlign: 'left', fontSize: 12, color: 'var(--at-ink-soft)', paddingBottom: 4 }}>Aplicaciones</caption>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--at-ink-soft)', fontSize: 11, borderBottom: '1px solid var(--at-line)' }}>
                    <th style={{ padding: 6 }}>Fecha</th>
                    <th style={{ padding: 6 }}>Documento</th>
                    <th style={{ padding: 6, textAlign: 'right' }}>Importe</th>
                    <th style={{ padding: 6 }}>Estado</th>
                    <th style={{ padding: 6 }} />
                  </tr>
                </thead>
                <tbody>
                  {d.aplicaciones.map((a) => (
                    <tr key={a.aplicacion_id} style={{ borderBottom: '1px solid var(--at-line)', verticalAlign: 'top', opacity: a.vigente ? 1 : 0.75 }}>
                      <td style={{ padding: 6, whiteSpace: 'nowrap' }}>{formatDateShort(a.fecha)}</td>
                      <td style={{ padding: 6 }}>
                        <div style={{ fontWeight: 600 }}>{a.documento ?? '—'}</div>
                        {a.monto_mora > 0 && (
                          <div style={{ fontSize: 12, color: 'var(--at-ink-soft)' }}>
                            Mora {formatCurrency(a.monto_mora, a.moneda)} · principal {formatCurrency(a.monto_principal, a.moneda)}
                          </div>
                        )}
                        {a.notas && <div style={{ fontSize: 12, color: 'var(--at-ink-soft)' }}>{a.notas}</div>}
                        <button type="button" style={btnLink} onClick={() => onAbrirAsiento(a.asiento_id)}>
                          Póliza #{a.asiento_numero ?? '—'}
                        </button>
                      </td>
                      <td style={{ padding: 6, textAlign: 'right', whiteSpace: 'nowrap' }}>{formatCurrency(a.monto, a.moneda)}</td>
                      <td style={{ padding: 6, fontSize: 12 }}>
                        {a.vigente ? (
                          <StatusBadge tone="success">Vigente</StatusBadge>
                        ) : (
                          <>
                            <StatusBadge tone="neutral">Revertida</StatusBadge>
                            <div>
                              {a.revertida_at ? `${formatDateShort(a.revertida_at)} · ` : ''}{a.motivo_reverso ?? ''}
                              {a.reverso_id && (
                                <>
                                  {' · '}
                                  <button type="button" style={btnLink} onClick={() => onAbrirAsiento(a.reverso_id!)}>
                                    Reverso #{a.reverso_numero ?? '—'}
                                  </button>
                                </>
                              )}
                            </div>
                          </>
                        )}
                      </td>
                      <td style={{ padding: 6, textAlign: 'right' }}>
                        {puedeAplicar && a.vigente && (
                          <button type="button" style={btnLink} disabled={revertir.isPending}
                            onClick={() => void revertirAplicacion(a.aplicacion_id)}>
                            Revertir
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// ── Aplicar un saldo a un documento ─────────────────────────────────────────
function AplicarForm({ companyId, origen, onCerrar }: { companyId: string; origen: OrigenSaldoFavor; onCerrar: () => void }) {
  const docs = useDocumentosSaldoFavorQuery(companyId, origen.origen_id)
  const aplicar = useAplicarSaldoFavorMutation(companyId)
  const [docId, setDocId] = useState('')
  const [monto, setMonto] = useState('')
  const [notas, setNotas] = useState('')
  // La clave se fija al abrir y sólo se renueva tras un resultado confirmado.
  const [clave, setClave] = useState(() => crypto.randomUUID())
  const [incierto, setIncierto] = useState(false)

  const doc = useMemo(() => (docs.data ?? []).find((x) => x.documento_id === docId) ?? null, [docs.data, docId])

  function elegirDoc(id: string) {
    setDocId(id)
    const x = (docs.data ?? []).find((d) => d.documento_id === id)
    // Propuesta, no decisión: el menor entre lo disponible y lo que se debe.
    if (x) setMonto(String(Math.min(origen.disponible, x.saldo)))
    setClave(crypto.randomUUID())
    setIncierto(false)
  }

  async function enviar() {
    const m = Number(monto)
    if (!doc || !Number.isFinite(m) || m <= 0) {
      notify({ variant: 'warning', title: 'Datos incompletos', text: 'Elige un documento e indica un importe mayor que cero.' })
      return
    }
    try {
      const r = await aplicar.mutateAsync({
        origenId: origen.origen_id, documentoTabla: doc.documento_tabla, documentoId: doc.documento_id,
        monto: m, notas: notas.trim() || null, clave,
      })
      notify({
        variant: 'success',
        title: r.repetido ? 'La aplicación ya estaba registrada' : 'Saldo aplicado',
        text: `Póliza #${r.asiento_numero ?? '—'}. `
          + (r.monto_mora > 0 ? `Mora ${r.monto_mora.toFixed(2)}, principal ${r.monto_principal.toFixed(2)}. ` : '')
          + `Queda disponible ${r.disponible_restante.toFixed(2)}.`,
      })
      onCerrar()
    } catch (e) {
      const f = clasificarFalloSaldoFavor(e)
      if (f.tipo === 'incierto') {
        setIncierto(true)
        notify({
          variant: 'warning',
          title: 'No se pudo confirmar la aplicación',
          text: 'La respuesta no llegó: pudo aplicarse o no. Reintenta con los mismos datos (no se duplica) o revisa las aplicaciones.',
        })
      } else {
        notify({ variant: 'error', title: 'No se aplicó el saldo', text: explicarErrorSaldoFavor(f.mensaje) })
      }
    }
  }

  return (
    <div role="group" aria-label="Aplicar saldo a favor" style={{ border: '1px solid var(--at-accent)', borderRadius: 10, padding: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
        Aplicar {TIPO_ORIGEN_LABELS[origen.tipo].toLowerCase()} del {formatDateShort(origen.fecha)} · disponible{' '}
        {formatCurrency(origen.disponible, origen.moneda)}
      </div>
      {docs.isError ? (
        <p role="alert" style={{ margin: 0, color: 'var(--at-danger)', fontSize: 12 }}>
          No se pudieron cargar los documentos: {docs.error instanceof Error ? docs.error.message : 'error'}.
        </p>
      ) : !docs.data ? (
        <p role="status" style={{ margin: 0, fontSize: 12 }}>Buscando documentos del mismo titular…</p>
      ) : docs.data.length === 0 ? (
        <p role="status" style={{ margin: 0, fontSize: 12 }}>
          No hay documentos de {origen.cliente_nombre ?? 'este cliente'} en {origen.unidad_nombre ?? 'esta unidad'} con saldo
          pendiente en {origen.moneda}.
        </p>
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Campo label="Documento">
            <select aria-label="Documento" value={docId} onChange={(e) => elegirDoc(e.target.value)} style={{ ...input, minWidth: 240 }}>
              <option value="">Elige un documento…</option>
              {docs.data.map((x) => (
                <option key={x.documento_id} value={x.documento_id}>
                  {x.documento_tabla === 'cuotas_condominio' ? 'Cuota' : 'Cargo'} {x.concepto} · debe {x.saldo.toFixed(2)}
                  {x.saldo_mora > 0 ? ` (mora ${x.saldo_mora.toFixed(2)})` : ''}
                </option>
              ))}
            </select>
          </Campo>
          <Campo label={`Importe (${origen.moneda})`}>
            <input aria-label="Importe a aplicar" type="number" step="0.01" min="0" value={monto}
              onChange={(e) => { setMonto(e.target.value); if (!incierto) setClave(crypto.randomUUID()) }}
              style={{ ...input, width: 120 }} />
          </Campo>
          <Campo label="Notas">
            <input aria-label="Notas de la aplicación" value={notas}
              onChange={(e) => { setNotas(e.target.value); if (!incierto) setClave(crypto.randomUUID()) }}
              style={{ ...input, minWidth: 180 }} />
          </Campo>
          <button type="button" style={btnPrimario} disabled={aplicar.isPending || !doc} onClick={() => void enviar()}>
            {aplicar.isPending ? 'Aplicando…' : incierto ? 'Reintentar' : 'Aplicar'}
          </button>
          <button type="button" style={btnSecundario} onClick={onCerrar}>Cancelar</button>
        </div>
      )}
      {doc?.saldo_mora ? (
        <p role="note" style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--at-ink-soft)' }}>
          En una cuota, lo aplicado cubre primero la mora y después el principal (la misma regla que sus cobros).
        </p>
      ) : null}
    </div>
  )
}

// ── Registrar un anticipo sin deuda ─────────────────────────────────────────
function AnticipoForm({ companyId, projectId, sujeto, unidades, clientes, onCerrar }: {
  companyId: string
  projectId: string
  sujeto: SujetoEstadoCuenta
  unidades: Array<{ id: string; nombre: string }>
  clientes: Array<{ cliente_id: string; cliente_nombre: string }>
  onCerrar: () => void
}) {
  const registrar = useRegistrarAnticipoMutation(companyId)
  const [unidadId, setUnidadId] = useState(sujeto.tipo === 'unidad' ? sujeto.id : '')
  const [clienteId, setClienteId] = useState(sujeto.tipo === 'cliente' ? sujeto.id : '')
  const [form, setForm] = useState({ monto: '', metodo: 'efectivo' as MetodoAnticipo, fecha: hoyLocalISO(), referencia: '', notas: '' })
  const [clave, setClave] = useState(() => crypto.randomUUID())
  const [incierto, setIncierto] = useState(false)
  const cambiar = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }))
    if (!incierto) setClave(crypto.randomUUID())
  }

  async function enviar() {
    const monto = Number(form.monto)
    if (!unidadId || !clienteId || !Number.isFinite(monto) || monto <= 0) {
      notify({ variant: 'warning', title: 'Datos incompletos', text: 'Indica unidad, cliente e importe mayor que cero.' })
      return
    }
    try {
      const r = await registrar.mutateAsync({
        projectId, unidadId, clienteId, monto, metodo: form.metodo, fecha: form.fecha,
        referencia: form.referencia.trim() || null, notas: form.notas.trim() || null, clave,
      })
      if (r.resultado === 'contabilizada') {
        notify({
          variant: 'success',
          title: r.repetido ? 'El anticipo ya estaba registrado' : 'Anticipo registrado',
          text: `Póliza #${r.asiento_numero ?? '—'}. Saldo a favor disponible: ${r.saldo_a_favor.toFixed(2)}.`,
        })
      } else {
        notify({
          variant: 'warning',
          title: 'Anticipo registrado, pendiente de contabilizar',
          text: r.motivo ?? 'Quedó en la bandeja de pendientes de Contabilidad.',
        })
      }
      onCerrar()
    } catch (e) {
      const f = clasificarFalloSaldoFavor(e)
      if (f.tipo === 'incierto') {
        setIncierto(true)
        notify({
          variant: 'warning',
          title: 'No se pudo confirmar el anticipo',
          text: 'La respuesta no llegó: pudo registrarse o no. Reintenta con los mismos datos (no se duplica).',
        })
      } else {
        notify({ variant: 'error', title: 'No se registró el anticipo', text: explicarErrorSaldoFavor(f.mensaje) })
      }
    }
  }

  return (
    <div role="group" aria-label="Registrar anticipo" style={{ border: '1px solid var(--at-line)', borderRadius: 10, padding: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Registrar anticipo</div>
      <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--at-ink-soft)' }}>
        Un cobro YA RECIBIDO sin documento que pagar. Queda como saldo a favor del cliente en esa unidad; el cliente tiene
        que estar vinculado a la unidad.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Campo label="Unidad">
          <select aria-label="Unidad del anticipo" value={unidadId} disabled={sujeto.tipo === 'unidad'}
            onChange={(e) => { setUnidadId(e.target.value); if (!incierto) setClave(crypto.randomUUID()) }} style={input}>
            <option value="">Elige…</option>
            {unidades.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
        </Campo>
        <Campo label="Cliente">
          <select aria-label="Cliente del anticipo" value={clienteId} disabled={sujeto.tipo === 'cliente'}
            onChange={(e) => { setClienteId(e.target.value); if (!incierto) setClave(crypto.randomUUID()) }} style={input}>
            <option value="">Elige…</option>
            {clientes.map((c) => <option key={c.cliente_id} value={c.cliente_id}>{c.cliente_nombre}</option>)}
          </select>
        </Campo>
        <Campo label="Importe">
          <input aria-label="Importe del anticipo" type="number" step="0.01" min="0" value={form.monto}
            onChange={(e) => cambiar({ monto: e.target.value })} style={{ ...input, width: 110 }} />
        </Campo>
        <Campo label="Método">
          <select aria-label="Método del anticipo" value={form.metodo}
            onChange={(e) => cambiar({ metodo: e.target.value as MetodoAnticipo })} style={input}>
            {METODOS_ANTICIPO.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </Campo>
        <Campo label="Fecha">
          <input aria-label="Fecha del anticipo" type="date" value={form.fecha} max={hoyLocalISO()}
            onChange={(e) => cambiar({ fecha: e.target.value })} style={input} />
        </Campo>
        <Campo label="Referencia">
          <input aria-label="Referencia del anticipo" value={form.referencia}
            onChange={(e) => cambiar({ referencia: e.target.value })} style={{ ...input, width: 120 }} />
        </Campo>
        <button type="button" style={btnPrimario} disabled={registrar.isPending} onClick={() => void enviar()}>
          {registrar.isPending ? 'Registrando…' : incierto ? 'Reintentar' : 'Registrar'}
        </button>
        <button type="button" style={btnSecundario} onClick={onCerrar}>Cancelar</button>
      </div>
    </div>
  )
}
