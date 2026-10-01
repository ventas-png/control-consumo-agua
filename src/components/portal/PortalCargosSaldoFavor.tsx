// Portal del residente — cargos adicionales, saldo a favor y solicitudes
// (20261011000000).
//
//   · Cargos adicionales propios con saldo: se pagan en línea (create-charge
//     con cargo_adicional_id). El retorno del checkout no acredita nada: lo
//     confirma el servidor (confirm-charge).
//   · Saldo a favor propio: el residente SOLICITA aplicarlo a una cuota o
//     cargo suyo; contabilidad aprueba y ejecuta (E4). Nunca se aplica desde
//     aquí.
//   · Sus solicitudes y su estado; puede cancelar las pendientes.
//
// Todo sale del servidor filtrado por la sesión: la pantalla no envía ningún
// id de cliente.
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { notify } from '../shared/Dialog'
import {
  fetchPortalCuentaContable,
  type PortalDocumentoConSaldo,
  type PortalSaldoFavor,
  type PortalSolicitud,
} from '../../domain/portal/queries'
import {
  cancelarSolicitudPortal,
  confirmarPago,
  iniciarPagoCargo,
  solicitarAplicacionSaldoFavor,
} from '../../domain/portal/mutations'
import { avisoConfirmacionPago } from '../../domain/portal/avisoConfirmacionPago'

interface Props {
  /** Unidad seleccionada en el portal: se muestra lo de esa unidad. */
  unidadId: string
  moneda: string
}

const ESTADO_SOLICITUD: Record<string, string> = {
  pendiente: 'En revisión por la administración',
  en_revision: 'En revisión por la administración',
  ejecutada: 'Aplicada',
  rechazada: 'Rechazada',
  cancelada: 'Cancelada',
}

export function PortalCargosSaldoFavor({ unidadId, moneda }: Props) {
  const [saldos, setSaldos] = useState<PortalSaldoFavor[]>([])
  const [documentos, setDocumentos] = useState<PortalDocumentoConSaldo[]>([])
  const [solicitudes, setSolicitudes] = useState<PortalSolicitud[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [procesando, setProcesando] = useState(false)
  // Formulario de solicitud: la clave se genera al abrirlo y se conserva en
  // cada reintento (idempotencia).
  const [form, setForm] = useState<{ clave: string; origenId: string; documentoId: string; importe: string } | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const r = await fetchPortalCuentaContable()
    setSaldos(r.saldos)
    setDocumentos(r.documentos)
    setSolicitudes(r.solicitudes)
    setError(r.error)
    setCargando(false)
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  const saldosU = useMemo(() => saldos.filter((s) => s.unidad_id === unidadId), [saldos, unidadId])
  const docsU = useMemo(() => documentos.filter((d) => d.unidad_id === unidadId), [documentos, unidadId])
  const cargosU = useMemo(() => docsU.filter((d) => d.documento_tabla === 'cargos_adicionales_unidad'), [docsU])

  async function pagarCargo(d: PortalDocumentoConSaldo) {
    setProcesando(true)
    try {
      const res = await iniciarPagoCargo(d.documento_id)
      if (res.error) { notify({ variant: 'error', title: 'No se pudo iniciar el pago', text: res.error }); return }
      if (res.redirectUrl && res.paymentRequestId) {
        try { sessionStorage.setItem('pago_pr_id', res.paymentRequestId) } catch { /* no-op */ }
        window.location.href = res.redirectUrl
        return
      }
      if (res.paymentRequestId) {
        // Aprobación inmediata (demo): igual se confirma DESDE EL SERVIDOR.
        const conf = await confirmarPago(res.paymentRequestId)
        if (conf.error) { notify({ variant: 'error', title: 'Pago no confirmado', text: conf.error }); return }
        notify(avisoConfirmacionPago(conf, { moneda, tituloPagado: 'Cargo pagado', textoAlDia: 'El cargo quedó al día.' }))
        void cargar()
      }
    } finally {
      setProcesando(false)
    }
  }

  function abrirSolicitud(s: PortalSaldoFavor) {
    const primero = docsU.find((d) => d.moneda === null || d.moneda === s.moneda)
    setForm({
      clave: crypto.randomUUID(),
      origenId: s.origen_id,
      documentoId: primero?.documento_id ?? '',
      importe: primero ? String(Math.min(Number(s.disponible), Number(primero.saldo)).toFixed(2)) : '',
    })
  }

  async function enviarSolicitud() {
    if (!form) return
    const doc = docsU.find((d) => d.documento_id === form.documentoId)
    const importe = Number(form.importe)
    if (!doc) { notify({ variant: 'warning', title: 'Elige el documento', text: '' }); return }
    if (!(importe > 0)) { notify({ variant: 'warning', title: 'Importe inválido', text: 'Ingresa un importe mayor a 0.' }); return }
    setProcesando(true)
    try {
      const r = await solicitarAplicacionSaldoFavor({
        clave: form.clave, origenId: form.origenId, documentoTabla: doc.documento_tabla,
        documentoId: doc.documento_id, importe,
      })
      if (r.error) { notify({ variant: 'error', title: 'No se envió la solicitud', text: r.error }); return }
      notify({ variant: 'success', title: 'Solicitud enviada', text: 'La administración la revisará. Tu saldo no se aplica hasta que la aprueben.' })
      setForm(null)
      void cargar()
    } finally {
      setProcesando(false)
    }
  }

  async function cancelar(id: string) {
    const r = await cancelarSolicitudPortal(id)
    if (r.error) { notify({ variant: 'error', title: 'No se canceló', text: r.error }); return }
    void cargar()
  }

  if (cargando) return <p style={{ color: 'var(--at-ink-3)' }}>Cargando saldo a favor y cargos…</p>
  if (error) return <p role="alert" style={{ color: 'var(--at-danger)' }}>No se pudo cargar tu saldo a favor: {error}</p>
  if (cargosU.length === 0 && saldosU.length === 0 && solicitudes.length === 0) return null

  return (
    <div data-testid="portal-cargos-saldo-favor" style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {cargosU.length > 0 && (
        <section aria-labelledby="portal-cargos">
          <h4 id="portal-cargos" style={h4}>Cargos adicionales por pagar</h4>
          {cargosU.map((d) => (
            <div key={d.documento_id} style={fila}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>{d.concepto}</div>
                {d.fecha && <div style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>{d.fecha}</div>}
              </div>
              <div style={{ fontWeight: 800 }}>{d.moneda ?? moneda} {Number(d.saldo).toFixed(2)}</div>
              <button type="button" style={boton} disabled={procesando} onClick={() => void pagarCargo(d)}>💳 Pagar</button>
            </div>
          ))}
        </section>
      )}

      {saldosU.length > 0 && (
        <section aria-labelledby="portal-saldo-favor">
          <h4 id="portal-saldo-favor" style={h4}>Saldo a favor</h4>
          <p style={{ margin: '0 0 8px', fontSize: 12.5, color: 'var(--at-ink-3)' }}>
            Puedes pedir que se aplique a una cuota o cargo tuyo. La administración lo revisa y lo aplica.
          </p>
          {saldosU.map((s) => (
            <div key={s.origen_id} style={fila}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>{s.tipo === 'anticipo' ? 'Anticipo' : 'Pago de más'}</div>
                <div style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>{new Date(s.creado_at).toLocaleDateString('es')}</div>
              </div>
              <div style={{ fontWeight: 800, color: 'var(--at-success)' }}>{s.moneda} {Number(s.disponible).toFixed(2)}</div>
              {docsU.length > 0 && (
                <button type="button" style={boton} disabled={procesando} onClick={() => abrirSolicitud(s)}>Solicitar aplicación</button>
              )}
            </div>
          ))}
          {form && (
            <div role="dialog" aria-label="Solicitar aplicación de saldo a favor" style={{ ...fila, flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <label style={lbl}>
                Aplicar a
                <select value={form.documentoId} onChange={(e) => setForm({ ...form, documentoId: e.target.value })} style={inp}>
                  <option value="">Elige…</option>
                  {docsU.map((d) => (
                    <option key={d.documento_id} value={d.documento_id}>
                      {d.concepto} — debe {d.moneda ?? moneda} {Number(d.saldo).toFixed(2)}
                    </option>
                  ))}
                </select>
              </label>
              <label style={lbl}>
                Importe
                <input type="number" step="0.01" min="0.01" inputMode="decimal" value={form.importe}
                  onChange={(e) => setForm({ ...form, importe: e.target.value })} style={inp} />
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" style={{ ...boton, background: 'var(--at-surface)', color: 'var(--at-ink-2)', border: '1px solid var(--at-line)' }}
                  disabled={procesando} onClick={() => setForm(null)}>Cancelar</button>
                <button type="button" style={boton} disabled={procesando} onClick={() => void enviarSolicitud()}>Enviar solicitud</button>
              </div>
            </div>
          )}
        </section>
      )}

      {solicitudes.length > 0 && (
        <section aria-labelledby="portal-solicitudes">
          <h4 id="portal-solicitudes" style={h4}>Mis solicitudes</h4>
          {solicitudes.map((q) => (
            <div key={q.solicitud_id} style={fila}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>Aplicar saldo a favor · {q.moneda ?? moneda} {Number(q.importe ?? 0).toFixed(2)}</div>
                <div style={{ fontSize: 12, color: 'var(--at-ink-3)' }}>
                  {ESTADO_SOLICITUD[q.estado] ?? q.estado}{q.motivo_revision ? ` — ${q.motivo_revision}` : ''}
                </div>
              </div>
              {q.estado === 'pendiente' && (
                <button type="button" style={{ ...boton, background: 'var(--at-surface)', color: 'var(--at-ink-2)', border: '1px solid var(--at-line)' }}
                  onClick={() => void cancelar(q.solicitud_id)}>Cancelar</button>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

const h4: CSSProperties = { margin: '0 0 10px', fontSize: 14, fontWeight: 700, color: 'var(--at-ink-2)' }
const fila: CSSProperties = {
  background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: 12, padding: '12px 14px',
  display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8,
}
const boton: CSSProperties = {
  padding: '8px 14px', borderRadius: 10, border: 'none',
  background: 'linear-gradient(135deg, var(--at-primary), var(--at-primary-hover))',
  color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', flexShrink: 0,
}
const lbl: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, fontWeight: 600 }
const inp: CSSProperties = { padding: 8, borderRadius: 8, border: '1px solid var(--at-line-strong)', fontSize: 14 }
