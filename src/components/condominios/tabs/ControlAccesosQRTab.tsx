import { useState, useMemo } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../../lib/supabase'
import { Visitante, Unidad } from '../../../types'

interface Props {
  visitantes: Visitante[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  onRefresh: () => void
}

interface QRGenerado {
  token: string
  nombre: string
  motivo: string
  unidadId: string
  unidadNombre: string
  validoHasta: string
  qrUrl: string
}

function generarToken(): string {
  return Math.random().toString(36).substring(2, 10).toUpperCase()
}

function qrUrl(token: string, nombre: string, unidad: string, hasta: string): string {
  const data = encodeURIComponent(`VISITA:${token}|${nombre}|${unidad}|${hasta}`)
  return `https://api.qrserver.com/v1/create-qr-code/?data=${data}&size=180x180&margin=8`
}

export default function ControlAccesosQRTab({ visitantes, unidades, proyectoId, companyId, canCreate: _canCreate, onRefresh }: Props) {
  const hoy = new Date().toISOString().slice(0, 10)
  const [tab, setTab] = useState<'generar' | 'validar' | 'pendientes'>('generar')
  const [form, setForm] = useState({ nombre: '', motivo: '', unidadId: '', validoHasta: hoy, identificacion: '' })
  const [qrGenerado, setQrGenerado] = useState<QRGenerado | null>(null)
  const [tokenValidar, setTokenValidar] = useState('')
  const [resultadoValidacion, setResultadoValidacion] = useState<{ ok: boolean; visitante?: Visitante; msg: string } | null>(null)
  const [registrando, setRegistrando] = useState(false)

  const preAutorizados = useMemo(() =>
    visitantes.filter(v => v.qr_token && !v.hora_salida && v.valido_hasta && v.valido_hasta >= hoy),
    [visitantes, hoy]
  )

  const vencidos = useMemo(() =>
    visitantes.filter(v => v.qr_token && !v.hora_entrada && v.valido_hasta && v.valido_hasta < hoy),
    [visitantes, hoy]
  )

  function generarQR() {
    if (!form.nombre.trim() || !form.unidadId || !form.validoHasta) {
      Swal.fire('Campos requeridos', 'Nombre, unidad y fecha de validez son obligatorios.', 'warning'); return
    }
    const token = generarToken()
    const u = unidades.find(x => x.id === form.unidadId)
    const qr: QRGenerado = {
      token,
      nombre: form.nombre.trim(),
      motivo: form.motivo.trim(),
      unidadId: form.unidadId,
      unidadNombre: u?.nombre ?? '',
      validoHasta: form.validoHasta,
      qrUrl: qrUrl(token, form.nombre.trim(), u?.nombre ?? '', form.validoHasta),
    }
    setQrGenerado(qr)
  }

  async function guardarPreAutorizacion() {
    if (!qrGenerado) return
    setRegistrando(true)
    const { error } = await supabase.from('visitantes').insert({
      company_id: companyId,
      project_id: proyectoId,
      unidad_id: qrGenerado.unidadId,
      nombre: qrGenerado.nombre,
      motivo: qrGenerado.motivo || null,
      identificacion: form.identificacion || null,
      qr_token: qrGenerado.token,
      valido_hasta: qrGenerado.validoHasta,
    })
    setRegistrando(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    onRefresh()
    Swal.fire('Pre-autorización guardada', 'El visitante tiene acceso hasta el ' + qrGenerado.validoHasta, 'success')
    setQrGenerado(null)
    setForm({ nombre: '', motivo: '', unidadId: '', validoHasta: hoy, identificacion: '' })
  }

  function validarToken() {
    const token = tokenValidar.trim().toUpperCase()
    if (!token) return
    const v = visitantes.find(x => x.qr_token === token)
    if (!v) {
      setResultadoValidacion({ ok: false, msg: 'Token no encontrado en el sistema.' }); return
    }
    if (v.valido_hasta && v.valido_hasta < hoy) {
      setResultadoValidacion({ ok: false, visitante: v, msg: `Token vencido el ${v.valido_hasta}.` }); return
    }
    if (v.hora_entrada && !v.hora_salida) {
      setResultadoValidacion({ ok: true, visitante: v, msg: `Ya está dentro desde ${v.hora_entrada?.slice(11, 16)}.` }); return
    }
    setResultadoValidacion({ ok: true, visitante: v, msg: 'Token válido. ¿Registrar entrada?' })
  }

  async function registrarEntradaDesdeQR() {
    if (!resultadoValidacion?.visitante) return
    setRegistrando(true)
    const { error } = await supabase.from('visitantes')
      .update({ hora_entrada: new Date().toISOString() })
      .eq('id', resultadoValidacion.visitante.id)
    setRegistrando(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    onRefresh()
    setTokenValidar(''); setResultadoValidacion(null)
    Swal.fire('Entrada registrada', `${resultadoValidacion.visitante.nombre} ingresó a ${resultadoValidacion.visitante.unidad_nombre}`, 'success')
  }

  async function registrarSalida(v: Visitante) {
    await supabase.from('visitantes').update({ hora_salida: new Date().toISOString() }).eq('id', v.id)
    onRefresh()
  }

  return (
    <div style={{ padding: 16 }}>
      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--at-line)', paddingBottom: 1 }}>
        {[
          { id: 'generar', label: '📱 Generar QR', badge: 0 },
          { id: 'validar', label: '📷 Validar token', badge: 0 },
          { id: 'pendientes', label: `✅ Pre-autorizados (${preAutorizados.length})`, badge: preAutorizados.length },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id as typeof tab)}
            style={{ padding: '7px 16px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: tab === t.id ? 700 : 500,
              background: tab === t.id ? '#FAF7EF' : 'transparent', color: tab === t.id ? '#1B3B36' : '#7E9389',
              borderBottom: tab === t.id ? '2px solid var(--at-primary)' : '2px solid transparent', borderRadius: '6px 6px 0 0' }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'generar' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
          {/* Formulario */}
          <div style={{ background: '#fff', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 14 }}>Pre-autorizar visitante</div>

            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Nombre del visitante *</label>
              <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                placeholder="Nombre completo"
                style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Identificación</label>
              <input value={form.identificacion} onChange={e => setForm(f => ({ ...f, identificacion: e.target.value }))}
                placeholder="DPI / Pasaporte"
                style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Unidad a visitar *</label>
              <select value={form.unidadId} onChange={e => setForm(f => ({ ...f, unidadId: e.target.value }))}
                style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 7, fontSize: 13 }}>
                <option value="">Selecciona unidad…</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Motivo</label>
                <input value={form.motivo} onChange={e => setForm(f => ({ ...f, motivo: e.target.value }))}
                  placeholder="Visita, entrega…"
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Válido hasta *</label>
                <input type="date" value={form.validoHasta} min={hoy} onChange={e => setForm(f => ({ ...f, validoHasta: e.target.value }))}
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 7, fontSize: 13, boxSizing: 'border-box' }} />
              </div>
            </div>
            <button onClick={generarQR}
              style={{ width: '100%', padding: '9px 0', background: '#1B3B36', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
              📱 Generar código QR
            </button>
          </div>

          {/* QR generado */}
          <div style={{ background: '#fff', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16, textAlign: 'center' }}>
            {!qrGenerado ? (
              <div style={{ color: '#7E9389', padding: '50px 0' }}>
                <div style={{ fontSize: 48, marginBottom: 8 }}>📱</div>
                <div style={{ fontSize: 13 }}>Completa el formulario y<br />genera el QR de acceso</div>
              </div>
            ) : (
              <>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>QR de pre-autorización</div>
                <div style={{ fontSize: 11, color: '#7E9389', marginBottom: 12 }}>
                  {qrGenerado.nombre} → {qrGenerado.unidadNombre} · válido hasta {qrGenerado.validoHasta}
                </div>
                <img src={qrGenerado.qrUrl} alt="QR" width={180} height={180}
                  style={{ border: '2px solid var(--at-line)', borderRadius: 8, marginBottom: 12 }} />
                <div style={{ padding: '6px 12px', background: '#EAE6D8', borderRadius: 6, fontSize: 12, fontWeight: 700, letterSpacing: 2, marginBottom: 12, color: '#15291F' }}>
                  Token: {qrGenerado.token}
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                  <button onClick={guardarPreAutorizacion} disabled={registrando}
                    style={{ padding: '8px 16px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                    {registrando ? 'Guardando…' : '✓ Guardar pre-autorización'}
                  </button>
                  <button onClick={() => setQrGenerado(null)}
                    style={{ padding: '8px 12px', border: '1px solid var(--at-line)', borderRadius: 7, cursor: 'pointer', fontSize: 12, background: '#FAF7EF' }}>
                    Descartar
                  </button>
                </div>
                <div style={{ marginTop: 10, fontSize: 10, color: '#7E9389' }}>
                  Comparte el QR o el token con el visitante.<br />El guardia lo escaneará al llegar.
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'validar' && (
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          <div style={{ background: '#fff', border: '1px solid var(--at-line)', borderRadius: 12, padding: 24 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16, textAlign: 'center' }}>📷 Validar token de acceso</div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <input value={tokenValidar} onChange={e => setTokenValidar(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && validarToken()}
                placeholder="Escribe o escanea el token (ej: AB3X7Y9Z)"
                style={{ flex: 1, padding: '10px 12px', border: '1.5px solid var(--at-line-strong)', borderRadius: 8, fontSize: 14, letterSpacing: 2, fontFamily: 'monospace', boxSizing: 'border-box' }} />
              <button onClick={validarToken}
                style={{ padding: '10px 16px', background: '#15291F', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                Validar
              </button>
            </div>

            {resultadoValidacion && (
              <div style={{ background: resultadoValidacion.ok ? '#f0fdf4' : '#fef2f2', border: `1px solid ${resultadoValidacion.ok ? '#86efac' : '#fca5a5'}`, borderRadius: 10, padding: 16 }}>
                <div style={{ fontSize: 24, marginBottom: 6 }}>{resultadoValidacion.ok ? '✅' : '❌'}</div>
                <div style={{ fontWeight: 700, fontSize: 13, color: resultadoValidacion.ok ? '#16a34a' : '#ef4444', marginBottom: 4 }}>
                  {resultadoValidacion.msg}
                </div>
                {resultadoValidacion.visitante && (
                  <div style={{ fontSize: 12, color: '#3E5A4C', marginBottom: 10 }}>
                    <div><strong>{resultadoValidacion.visitante.nombre}</strong></div>
                    <div>Unidad: {resultadoValidacion.visitante.unidad_nombre}</div>
                    {resultadoValidacion.visitante.motivo && <div>Motivo: {resultadoValidacion.visitante.motivo}</div>}
                    <div>Válido hasta: {resultadoValidacion.visitante.valido_hasta}</div>
                  </div>
                )}
                {resultadoValidacion.ok && !resultadoValidacion.visitante?.hora_entrada && (
                  <button onClick={registrarEntradaDesdeQR} disabled={registrando}
                    style={{ width: '100%', padding: '8px 0', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                    {registrando ? 'Registrando…' : '🚪 Registrar entrada'}
                  </button>
                )}
                <button onClick={() => { setResultadoValidacion(null); setTokenValidar('') }}
                  style={{ width: '100%', padding: '6px 0', marginTop: 6, border: '1px solid var(--at-line)', borderRadius: 7, cursor: 'pointer', fontSize: 12, background: '#FAF7EF' }}>
                  Limpiar
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'pendientes' && (
        <div>
          {preAutorizados.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#7E9389', padding: '40px 0' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
              No hay visitantes pre-autorizados activos
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {preAutorizados.map(v => (
                <div key={v.id} style={{ background: '#fff', border: '1px solid var(--at-line)', borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: v.hora_entrada ? '#dcfce7' : '#EEF2EC', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
                    {v.hora_entrada ? '🟢' : '📱'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{v.nombre}</div>
                    <div style={{ fontSize: 11, color: '#7E9389' }}>
                      {v.unidad_nombre} · Token: <code style={{ background: '#EAE6D8', padding: '1px 5px', borderRadius: 4 }}>{v.qr_token}</code>
                    </div>
                    <div style={{ fontSize: 10, color: '#7E9389' }}>
                      Válido hasta {v.valido_hasta}
                      {v.hora_entrada && ` · Entró ${v.hora_entrada.slice(11, 16)}`}
                    </div>
                  </div>
                  {v.hora_entrada && !v.hora_salida && (
                    <button onClick={() => registrarSalida(v)}
                      style={{ padding: '5px 12px', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 6, cursor: 'pointer', fontSize: 11, color: '#d97706', fontWeight: 600 }}>
                      Registrar salida
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {vencidos.length > 0 && (
            <div style={{ marginTop: 16, padding: '10px 14px', background: '#fef2f2', borderRadius: 8, fontSize: 11, color: '#7E9389' }}>
              {vencidos.length} pre-autorización(es) vencida(s) sin usar — ya no son válidas.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
