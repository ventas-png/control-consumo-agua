import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { ModalPortal } from '../../shared/ModalPortal'
import { notify } from '../../shared/Dialog'
import { openTextPrompt } from '../../shared/PromptDialog'
import { hoyLocalISO } from '../../../lib/format'
import type { CargoAdicionalUnidad } from '../../../types'
import {
  METODOS_COBRO_CARGO,
  clasificarFalloRegistro,
  etiquetaPendienteCobro,
  guardarEnvioIncierto,
  leerEnvioIncierto,
  olvidarEnvioIncierto,
  useAnularCobroCargoMutation,
  useCobrosDeCargoQuery,
  useRegistrarCobroCargoMutation,
  type CobroCargoResumen,
  type EnvioIncierto,
  type MetodoCobroCargo,
} from '../../../domain/contabilidad/cobrosCargo'

interface Props {
  cargo: CargoAdicionalUnidad
  resumen: CobroCargoResumen | undefined
  companyId: string
  moneda: string
  canEdit: boolean
  onClose: () => void
  /** Tras registrar o anular: el estado del cargo lo cambió el servidor. */
  onCambio: () => void
}

const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

type DatosCobro = EnvioIncierto['datos']

/**
 * Cobros de UN cargo adicional por tipo: registrar uno (parcial o total) y
 * anular los existentes. Todo lo decide el servidor —saldo, excedente,
 * devengo pendiente, responsable histórico, coherencia con el devengo—; aquí
 * sólo se muestra su respuesta.
 *
 * La clave de idempotencia se fija al abrir el formulario y se renueva sólo
 * tras un alta CONFIRMADA o por decisión explícita («Registrar como cobro
 * nuevo»). La clave y una copia de los datos se guardan ANTES de la petición:
 * si el formulario se cierra, se navega o se recarga mientras tanto, al
 * reabrirlo se recupera ese envío con su clave y no se genera otra hasta
 * confirmar su resultado. Si la respuesta no llega, el resultado es INCIERTO:
 * no se afirma que el cobro no se registró, y si aparece en la lista se
 * reconoce como registrado. Una respuesta tardía sólo limpia SU envío.
 */
export default function CobroCargoModal({ cargo, resumen, companyId, moneda, canEdit, onClose, onCambio }: Props) {
  const cobros = useCobrosDeCargoQuery(companyId, cargo.id)
  const registrar = useRegistrarCobroCargoMutation(companyId)
  const anular = useAnularCobroCargoMutation(companyId)

  const saldo = resumen?.saldo ?? cargo.monto
  // Un envío anterior sin confirmar (de esta pestaña) manda: misma clave,
  // mismos datos.
  const [incierto, setIncierto] = useState<EnvioIncierto | null>(() => leerEnvioIncierto(cargo.id))
  const [clave, setClave] = useState(() => incierto?.clave ?? crypto.randomUUID())
  // La clave vigente, para las respuestas que llegan después de un cambio.
  const claveVigente = useRef(clave)
  const [form, setForm] = useState<DatosCobro>(() => incierto?.datos ?? {
    monto: saldo > 0 ? String(saldo) : '',
    metodo: 'efectivo',
    fecha: hoyLocalISO(),
    referencia: '',
    notas: '',
  })
  /** La clave ya corresponde a un cobro con otros datos: hace falta una decisión. */
  const [claveReusada, setClaveReusada] = useState(false)

  const desalineado = !!resumen?.coherencia_codigo
  const puedeCobrar = canEdit && cargo.estado !== 'anulado' && !!resumen?.por_tipo && !resumen.pagado_sin_cobro && !desalineado

  /** Resultado de `k` confirmado: se olvida su envío y, si sigue vigente, se renueva la clave. */
  function confirmada(k: string) {
    olvidarEnvioIncierto(cargo.id, k)
    setIncierto((i) => (i?.clave === k ? null : i))
    if (claveVigente.current !== k) return
    setClaveReusada(false)
    const nueva = crypto.randomUUID()
    claveVigente.current = nueva
    setClave(nueva)
  }
  const nuevaClave = () => confirmada(claveVigente.current)

  // Recuperar el resultado: si el cobro del envío incierto aparece entre los
  // del cargo, SÍ se registró.
  const registradoConClave = incierto ? (cobros.data ?? []).find((c) => c.pago_id === incierto.clave) : undefined
  useEffect(() => {
    if (!registradoConClave) return
    notify({
      variant: 'info',
      title: 'El cobro anterior sí se registró',
      text: `Aparece entre los cobros del cargo (${registradoConClave.fecha}, ${fmt(registradoConClave.monto)}). No hace falta reenviarlo.`,
    })
    setForm((f) => ({ ...f, referencia: '', notas: '' }))
    confirmada(registradoConClave.pago_id)
    onCambio()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al aparecer el cobro
  }, [registradoConClave?.pago_id])

  async function enviar(datos: DatosCobro = form) {
    const monto = Number(datos.monto)
    if (!Number.isFinite(monto) || monto <= 0) {
      notify({ variant: 'warning', title: 'Importe inválido', text: 'Indica un importe mayor que cero.' })
      return
    }
    const k = clave
    // Antes de la petición: si se cierra, navega o recarga, el envío se recupera.
    const reintento = incierto?.clave === k
    const guardado = guardarEnvioIncierto(cargo.id, { clave: k, datos })
    try {
      const r = await registrar.mutateAsync({
        cargoId: cargo.id, monto, metodo: datos.metodo, fecha: datos.fecha,
        referencia: datos.referencia.trim() || null, notas: datos.notas.trim() || null, clave: k,
      })
      if (r.resultado === 'contabilizada') {
        notify({
          variant: 'success',
          title: r.repetido ? 'Cobro ya registrado' : 'Cobro registrado',
          text: `Contabilizado${r.asiento_numero ? ` en la póliza #${r.asiento_numero}` : ''}. El cargo queda ${r.estado_cargo}.`,
        })
      } else {
        notify({
          variant: 'warning',
          title: `${r.repetido ? 'Cobro ya registrado' : 'Cobro registrado'}, pendiente de contabilizar (${etiquetaPendienteCobro(r.codigo)})`,
          text: r.motivo ?? 'Quedó en la bandeja de pendientes de Contabilidad.',
        })
      }
      if (claveVigente.current === k) setForm((f) => ({ ...f, referencia: '', notas: '' }))
      confirmada(k)
      onCambio()
    } catch (e) {
      const fallo = clasificarFalloRegistro(e)
      if (fallo.tipo === 'incierto') {
        setIncierto(guardado)
        notify({
          variant: 'warning',
          title: 'No se pudo confirmar el cobro',
          text: 'La respuesta del servidor no llegó: el cobro pudo haberse registrado o no. '
            + 'Reintenta con los mismos datos (se usa la misma clave y no se duplica) o revisa los cobros del cargo.',
        })
        void cobros.refetch()
      } else if (fallo.tipo === 'clave_reusada') {
        setClaveReusada(true)
        notify({
          variant: 'error',
          title: 'No se registró este cobro',
          text: `${fallo.mensaje.replace(/^COBRO_CARGO_CLAVE_REUSADA:\s*/, '')}`,
        })
        void cobros.refetch()
      } else {
        // El servidor respondió con un error: con esta clave no se registró
        // nada en ESTE intento. Si era el reintento de un envío sin confirmar,
        // ese envío sigue sin confirmar (el error pudo ser previo a mirarlo).
        if (!reintento) olvidarEnvioIncierto(cargo.id, k)
        notify({ variant: 'error', title: 'No se registró el cobro', text: fallo.mensaje })
      }
    }
  }

  async function anularCobro(pagoId: string) {
    const motivo = await openTextPrompt({
      title: 'Anular cobro',
      description: 'El cobro no se borra: queda rechazado con este motivo y su asiento se reversa.',
      label: 'Motivo',
      required: true,
      validate: (v) => (v.trim().length < 3 ? 'Indica el motivo.' : null),
    })
    if (!motivo) return
    try {
      const r = await anular.mutateAsync({ pagoId, motivo: motivo.trim() })
      notify({
        variant: 'success',
        title: r.resultado === 'ya_anulado' ? 'El cobro ya estaba anulado' : 'Cobro anulado',
        text: (r.reverso_numero ? `Reverso en la póliza #${r.reverso_numero}. ` : '')
          + `El cargo queda ${r.estado_cargo}.`
          + (r.cobros_pendientes > 0
            ? ` Hay ${r.cobros_pendientes} cobro(s) pendiente(s) de este cargo: reprocésalo desde Contabilidad › Pendientes.`
            : ''),
      })
      onCambio()
    } catch (e) {
      notify({ variant: 'error', title: 'No se anuló el cobro', text: e instanceof Error ? e.message : String(e) })
    }
  }

  const inp: CSSProperties = { width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

  return (
    <ModalPortal>
      <div role="dialog" aria-modal="true" aria-label={`Cobros del cargo ${cargo.concepto}`}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
        <div style={{ background: 'var(--at-surface)', borderRadius: 12, width: 'min(720px, 100%)', maxHeight: '90vh', overflow: 'auto', padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Cobros · {cargo.concepto}</div>
            <button onClick={onClose} aria-label="Cerrar" style={{ border: 'none', background: 'none', fontSize: 18, cursor: 'pointer' }}>✕</button>
          </div>

          <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, margin: '0 0 14px' }}>
            {[
              ['Devengado', resumen?.devengado ?? cargo.monto],
              ['Aplicado', resumen?.aplicado ?? 0],
              ['Pendiente de contabilizar', resumen?.en_proceso ?? 0],
              ['Saldo', saldo],
            ].map(([k, v]) => (
              <div key={k as string} style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '8px 10px' }}>
                <dt style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>{k}</dt>
                <dd style={{ margin: 0, fontWeight: 700 }}>{moneda} {fmt(v as number)}</dd>
              </div>
            ))}
          </dl>

          {desalineado && (
            <p role="alert" style={{ fontSize: 12, color: 'var(--at-danger)', margin: '0 0 12px' }}>
              <strong>{etiquetaPendienteCobro(resumen?.coherencia_codigo ?? null)}.</strong> {resumen?.coherencia_motivo}
            </p>
          )}
          {resumen?.pagado_sin_cobro && (
            <p role="note" style={{ fontSize: 12, color: 'var(--at-warning)', margin: '0 0 12px' }}>
              Este cargo figura como pagado desde antes de los cobros por cargo, sin cobro vinculado. No se registran cobros sobre él.
            </p>
          )}
          {resumen && !resumen.por_tipo && (
            <p role="note" style={{ fontSize: 12, color: 'var(--at-ink-3)', margin: '0 0 12px' }}>
              Cargo anterior a la contabilización por tipo de cargo: su cobro no se registra aquí.
            </p>
          )}
          {resumen?.devengo_estado == null && resumen?.por_tipo && (
            <p role="note" style={{ fontSize: 12, color: 'var(--at-warning)', margin: '0 0 12px' }}>
              El cargo todavía no está contabilizado: un cobro quedará pendiente hasta que se resuelva y se reprocese el cargo.
            </p>
          )}

          {incierto && (
            <div role="status" style={{ border: '1px solid var(--at-warning)', borderRadius: 10, padding: 10, marginBottom: 12, fontSize: 12 }}>
              <strong>Cobro sin confirmar.</strong> Se envió {moneda} {fmt(Number(incierto.datos.monto))} del {incierto.datos.fecha}
              {incierto.datos.referencia.trim() ? ` (ref. ${incierto.datos.referencia.trim()})` : ''} y su respuesta no se ha confirmado:
              pudo haberse registrado o no. Reintentarlo con los mismos datos no lo duplica.
              {canEdit && (
                <div style={{ marginTop: 6 }}>
                  <button onClick={() => { setForm(incierto.datos); void enviar(incierto.datos) }} disabled={registrar.isPending}
                    style={{ padding: '4px 10px', background: 'var(--at-chip)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                    Reintentar el envío anterior
                  </button>
                </div>
              )}
            </div>
          )}
          {claveReusada && (
            <div role="alert" style={{ border: '1px solid var(--at-danger)', borderRadius: 10, padding: 10, marginBottom: 12, fontSize: 12 }}>
              El envío anterior ya quedó registrado con otros datos; este intento no se registró y el anterior no cambió.
              Revisa la lista de cobros: si falta otro cobro, regístralo como un cobro nuevo.
              {canEdit && (
                <div style={{ marginTop: 6 }}>
                  <button onClick={nuevaClave}
                    style={{ padding: '4px 10px', background: 'var(--at-chip)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                    Registrar como cobro nuevo
                  </button>
                </div>
              )}
            </div>
          )}

          {puedeCobrar && (
            <div style={{ border: '1px solid var(--at-line)', borderRadius: 10, padding: 12, marginBottom: 14 }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Registrar cobro</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
                <div>
                  <label style={lbl} htmlFor="cc-monto">Importe ({moneda})</label>
                  <input id="cc-monto" type="number" step="0.01" min="0" style={inp} value={form.monto}
                    onChange={(e) => setForm((f) => ({ ...f, monto: e.target.value }))} />
                </div>
                <div>
                  <label style={lbl} htmlFor="cc-metodo">Método</label>
                  <select id="cc-metodo" style={inp} value={form.metodo}
                    onChange={(e) => setForm((f) => ({ ...f, metodo: e.target.value as MetodoCobroCargo }))}>
                    {METODOS_COBRO_CARGO.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl} htmlFor="cc-fecha">Fecha</label>
                  <input id="cc-fecha" type="date" style={inp} value={form.fecha} max={hoyLocalISO()}
                    onChange={(e) => setForm((f) => ({ ...f, fecha: e.target.value }))} />
                </div>
                <div>
                  <label style={lbl} htmlFor="cc-ref">Referencia</label>
                  <input id="cc-ref" style={inp} value={form.referencia}
                    onChange={(e) => setForm((f) => ({ ...f, referencia: e.target.value }))} />
                </div>
              </div>
              <div style={{ marginTop: 8 }}>
                <label style={lbl} htmlFor="cc-notas">Notas</label>
                <input id="cc-notas" style={inp} value={form.notas}
                  onChange={(e) => setForm((f) => ({ ...f, notas: e.target.value }))} />
              </div>
              {Number(form.monto) > saldo && (
                <p role="note" style={{ fontSize: 12, color: 'var(--at-warning)', margin: '8px 0 0' }}>
                  El importe supera el saldo: el cobro quedará pendiente con su motivo. El excedente no se reparte a otros cargos ni se vuelve anticipo.
                </p>
              )}
              <button onClick={() => void enviar()} disabled={registrar.isPending || claveReusada}
                style={{ marginTop: 10, padding: '7px 16px', background: 'var(--at-success)', color: 'var(--at-on-status)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                {registrar.isPending ? 'Registrando…' : 'Registrar cobro'}
              </button>
            </div>
          )}

          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Cobros registrados</div>
          {cobros.isLoading ? (
            <div style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>Cargando cobros…</div>
          ) : cobros.isError ? (
            <div role="alert" style={{ fontSize: 12, color: 'var(--at-danger)' }}>No se pudieron cargar los cobros: {(cobros.error as Error).message}</div>
          ) : (cobros.data ?? []).length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>Sin cobros.</div>
          ) : (
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--at-ink-3)' }}>
                  <th>Fecha</th><th>Método</th><th style={{ textAlign: 'right' }}>Importe</th>
                  <th style={{ textAlign: 'right' }}>Aplicado</th><th>Contabilidad</th><th />
                </tr>
              </thead>
              <tbody>
                {(cobros.data ?? []).map((c) => {
                  const vivo = c.estado !== 'rechazado'
                  return (
                    <tr key={c.pago_id} style={{ borderTop: '1px solid var(--at-line)', opacity: vivo ? 1 : 0.7 }}>
                      <td>{c.fecha}</td>
                      <td>{METODOS_COBRO_CARGO.find((m) => m.value === c.metodo)?.label ?? c.metodo}{c.referencia ? ` · ${c.referencia}` : ''}</td>
                      <td style={{ textAlign: 'right' }}>{fmt(c.monto)}</td>
                      <td style={{ textAlign: 'right' }}>{vivo ? fmt(c.aplicado) : '—'}</td>
                      <td>
                        {!vivo ? (
                          <span>Anulado{c.anulacion_motivo ? `: ${c.anulacion_motivo}` : ''}{c.reverso_numero ? ` · reverso #${c.reverso_numero}` : ''}</span>
                        ) : c.asiento_numero ? (
                          <span>Póliza #{c.asiento_numero}</span>
                        ) : (
                          <span title={c.motivo ?? undefined} style={{ color: 'var(--at-warning)' }}>
                            {etiquetaPendienteCobro(c.codigo)}{c.motivo ? ` — ${c.motivo}` : ''}
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {canEdit && vivo && (
                          <button onClick={() => anularCobro(c.pago_id)} disabled={anular.isPending}
                            style={{ padding: '3px 8px', background: 'var(--at-chip)', color: 'var(--at-ink-3)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>
                            Anular
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </ModalPortal>
  )
}
