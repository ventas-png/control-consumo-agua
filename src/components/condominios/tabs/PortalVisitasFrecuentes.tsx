// Portal del residente: sus visitas frecuentes (pre-autorizaciones de ingreso).
//
// El residente registra por anticipado a las personas de confianza (empleada,
// familiar, proveedor) con los días y el horario en que pueden entrar. La
// solicitud nace 'pendiente' y la administración la aprueba o la rechaza; solo
// una aprobada ampara el ingreso pre-autorizado en portería. El residente
// puede suspender o reactivar las suyas y, cuando una está por vencer (dentro
// de los días de aviso del condominio) o ya venció, pedir su renovación: la
// solicitud queda aparte y la autorización vigente sigue valiendo hasta su
// fecha; la administración la aprueba. Nada más: el trigger
// `vf_residente_solo_activo` acota su UPDATE a eso.
import { useState } from 'react'
import { validatedInsert } from '../../../lib/validatedInsert'
import { visitaFrecuenteInputSchema } from '../../../domain/condominios/schemas'
import { updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { toast } from '../../../lib/toast'
import { ImageUploader } from '../../shared/ImageUploader'
import { ModalPortal } from '../../shared/ModalPortal'
import { hoyLocalISO } from '../../../lib/format'
import type { RelacionVisitaFrecuente, VisitaFrecuente } from '../../../types'
import {
  DIAS_SEMANA, DIA_LABEL_CORTO, ETIQUETA_VISITA_LABEL, RELACIONES_VISITA, VIGENCIA_MAXIMA_MESES,
  describirDias, describirHorario, describirVigencia, diasParaVencer, estaVencida, estadoVisita, etiquetaVisita,
  necesitaRenovacion, relacionLabel, tieneRenovacionSolicitada, vigenciaMaxima, vigenciaValida,
  type DiaSemana,
} from '../../../lib/visitasFrecuentes'
import { useDiasAvisoRenovacion } from '../../../hooks/useDiasAvisoRenovacion'

interface Props {
  visitas: VisitaFrecuente[]
  /** Días de aviso del condominio; si no viene, se lee de `projects`. */
  diasAviso?: number
  unidadId: string
  proyectoId: string
  companyId: string
  onRefresh: () => void
}

// La autorización vale como máximo 6 meses; el formulario arranca con el máximo.
const formVacio = () => ({
  nombre: '', identificacion: '', relacion: 'familiar' as RelacionVisitaFrecuente,
  telefono: '', placa_vehiculo: '', dias_permitidos: [] as DiaSemana[],
  hora_desde: '', hora_hasta: '', vigente_hasta: vigenciaMaxima(hoyLocalISO()), notas: '',
})

const inputBase: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '9px 12px',
  border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)',
}
const labelBase: React.CSSProperties = {
  fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px',
}

export function PortalVisitasFrecuentes({ visitas, diasAviso: diasAvisoProp, unidadId, proyectoId, companyId, onRefresh }: Props) {
  const diasAviso = useDiasAvisoRenovacion(proyectoId, diasAvisoProp)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(formVacio)
  const [fotoUrl, setFotoUrl] = useState<string | null>(null)
  const [procesando, setProcesando] = useState<string | null>(null)
  // Solicitud de renovación: la fecha nueva se elige en la propia tarjeta.
  const [renovando, setRenovando] = useState<{ id: string; hasta: string } | null>(null)
  const hoy = hoyLocalISO()

  // Lo que hay que atender primero: vencidas y por vencer sin solicitud.
  const porRenovar = visitas.filter(v => necesitaRenovacion(v, diasAviso) && !tieneRenovacionSolicitada(v))
  const peso = (v: VisitaFrecuente) => {
    if (necesitaRenovacion(v, diasAviso)) return tieneRenovacionSolicitada(v) ? 1 : 0
    const e = etiquetaVisita(v)
    return e === 'pendiente' ? 2 : e === 'aprobada' ? 3 : e === 'suspendida' ? 4 : 5
  }
  const lista = visitas.slice().sort((a, b) => peso(a) - peso(b) || a.nombre.localeCompare(b.nombre))

  function reset() {
    setForm(formVacio())
    setFotoUrl(null)
    setShowForm(false)
  }

  function toggleDia(d: DiaSemana) {
    setForm(f => ({ ...f, dias_permitidos: f.dias_permitidos.includes(d) ? f.dias_permitidos.filter(x => x !== d) : [...f.dias_permitidos, d] }))
  }

  async function solicitar() {
    if (!form.nombre.trim()) { toast.error('Ingrese el nombre de la persona.'); return }
    if (!form.vigente_hasta) { toast.error('Indique hasta cuándo vale la autorización.'); return }
    if (form.vigente_hasta < hoy) { toast.error('La vigencia no puede terminar antes de hoy.'); return }
    if (!vigenciaValida(hoy, form.vigente_hasta)) { toast.error(`La autorización dura como máximo ${VIGENCIA_MAXIMA_MESES} meses (hasta ${vigenciaMaxima(hoy)}).`); return }
    setSaving(true)
    // Nace 'pendiente' y sin sello: la aprobación es de la administración (RLS
    // 20261107000000 rechaza cualquier otra cosa desde el portal).
    const { error } = await validatedInsert('visitas_frecuentes', visitaFrecuenteInputSchema, {
      company_id: companyId,
      project_id: proyectoId,
      unidad_id: unidadId,
      nombre: form.nombre.trim(),
      identificacion: form.identificacion.trim() || null,
      relacion: form.relacion,
      telefono: form.telefono.trim() || null,
      placa_vehiculo: form.placa_vehiculo.trim() || null,
      foto_url: fotoUrl,
      dias_permitidos: form.dias_permitidos.length > 0 ? form.dias_permitidos : null,
      hora_desde: form.hora_desde || null,
      hora_hasta: form.hora_hasta || null,
      vigente_desde: hoy,
      vigente_hasta: form.vigente_hasta,
      notas: form.notas.trim() || null,
      estado: 'pendiente',
      activo: true,
    })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success('Solicitud enviada', { description: 'La administración la revisará. Cuando la apruebe, la persona podrá ingresar como pre-autorizada en los días y horario indicados.' })
    reset()
    onRefresh()
  }

  /**
   * Pedir la renovación: queda registrada aparte (fecha pedida y cuándo) y la
   * autorización vigente sigue valiendo hasta su fecha; la administración la
   * aprueba. El trigger `vf_residente_solo_activo` sólo deja este cambio dentro
   * de la ventana de aviso del condominio o ya vencida.
   */
  async function solicitarRenovacion(v: VisitaFrecuente, hasta: string) {
    if (!hasta || !vigenciaValida(hoy, hasta)) { toast.error(`La renovación va de hoy a como máximo ${vigenciaMaxima(hoy)} (${VIGENCIA_MAXIMA_MESES} meses).`); return }
    setProcesando(v.id)
    const { error } = await updateCondominioRow('visitas_frecuentes', v.id, {
      renovacion_solicitada_hasta: hasta, renovacion_solicitada_en: new Date().toISOString(),
    })
    setProcesando(null)
    if (error) { toast.error(error.message); return }
    setRenovando(null)
    toast.success('Renovación solicitada', {
      description: estaVencida(v)
        ? 'La administración la revisará. Mientras tanto, el guardia le consultará a usted en cada ingreso.'
        : `La administración la revisará. La autorización actual sigue vigente hasta el ${v.vigente_hasta?.slice(0, 10)}.`,
    })
    onRefresh()
  }

  async function retirarSolicitud(v: VisitaFrecuente) {
    setProcesando(v.id)
    const { error } = await updateCondominioRow('visitas_frecuentes', v.id, { renovacion_solicitada_hasta: null, renovacion_solicitada_en: null })
    setProcesando(null)
    if (error) { toast.error(error.message); return }
    toast.success('Solicitud de renovación retirada')
    onRefresh()
  }

  async function toggleActivo(v: VisitaFrecuente) {
    setProcesando(v.id)
    const { error } = await updateCondominioRow('visitas_frecuentes', v.id, { activo: !v.activo })
    setProcesando(null)
    if (error) { toast.error(error.message); return }
    toast.success(v.activo ? 'Autorización suspendida' : 'Autorización reactivada')
    onRefresh()
  }

  return (
    <section aria-label="Visitas frecuentes" style={{ marginBottom: '26px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: 'var(--at-ink)' }}>Visitas frecuentes</h3>
          <p style={{ margin: '3px 0 0', fontSize: '12.5px', color: 'var(--at-ink-3)' }}>
            Personas de confianza con ingreso pre-autorizado en los días y horario que usted indique. La administración aprueba cada solicitud.
            Cada autorización vale como máximo {VIGENCIA_MAXIMA_MESES} meses; al vencer debe solicitar su renovación.
          </p>
        </div>
        <button onClick={() => setShowForm(true)}
          style={{ padding: '9px 16px', background: 'var(--at-surface)', color: 'var(--at-primary)', border: '1.5px solid var(--at-primary-soft-2)', borderRadius: '9px', fontWeight: 600, cursor: 'pointer', fontSize: '13.5px' }}>
          + Solicitar visita frecuente
        </button>
      </div>

      {/* Aviso: vencidas o por vencer dentro de los días de aviso del condominio */}
      {porRenovar.length > 0 && (
        <div role="alert" style={{ background: 'var(--at-warning-tint)', border: '1.5px solid var(--at-warning-border)', borderRadius: '12px', padding: '12px 16px', marginBottom: '10px' }}>
          <div style={{ fontWeight: 700, fontSize: '13.5px', color: 'var(--at-warning-strong)', marginBottom: '4px' }}>
            ⏰ {porRenovar.length === 1 ? 'Una autorización necesita renovación' : `${porRenovar.length} autorizaciones necesitan renovación`}
          </div>
          <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '12.5px', color: 'var(--at-warning-strong)', display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {porRenovar.map(v => {
              const dias = diasParaVencer(v)
              return (
                <li key={v.id}>
                  <strong>{v.nombre}</strong>{' '}
                  {estaVencida(v) ? `venció el ${v.vigente_hasta?.slice(0, 10)}` : dias === 0 ? 'vence hoy' : `vence el ${v.vigente_hasta?.slice(0, 10)} (en ${dias} día${dias === 1 ? '' : 's'})`}.
                  {' '}Pida la renovación con el botón de su tarjeta.
                </li>
              )
            })}
          </ul>
          <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', marginTop: '6px' }}>
            El condominio avisa {diasAviso} día{diasAviso === 1 ? '' : 's'} antes del vencimiento. Mientras no se apruebe la renovación, al vencer el guardia le consultará a usted en cada ingreso.
          </div>
        </div>
      )}

      {lista.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '18px', color: 'var(--at-ink-3)', fontSize: '13px', background: 'var(--at-surface-2)', borderRadius: '12px', border: '1px dashed var(--at-line)' }}>
          Aún no tiene visitas frecuentes. Registre a su empleada, un familiar o un proveedor para que entre sin que le llamen cada vez.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {lista.map(v => {
            const estado = estadoVisita(v)
            const etiqueta = etiquetaVisita(v)
            const solicitada = tieneRenovacionSolicitada(v)
            const porVencer = necesitaRenovacion(v, diasAviso)
            const vencePronto = porVencer && !estaVencida(v)
            const dias = diasParaVencer(v)
            const chip = etiqueta === 'pendiente'
              ? { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', text: ETIQUETA_VISITA_LABEL.pendiente }
              : etiqueta === 'rechazada' || etiqueta === 'vencida'
                ? { bg: 'var(--at-danger-tint)', color: 'var(--at-danger)', text: ETIQUETA_VISITA_LABEL[etiqueta] }
                : etiqueta === 'aprobada'
                  ? { bg: 'var(--at-success-tint)', color: 'var(--at-success)', text: 'Aprobada' }
                  : { bg: 'var(--at-chip)', color: 'var(--at-ink-3)', text: 'Suspendida' }
            const icon = RELACIONES_VISITA.find(r => r.value === v.relacion)?.icon ?? '👤'
            const enRenovacion = renovando?.id === v.id
            return (
              <div key={v.id} style={{ background: 'var(--at-surface)', border: `1.5px solid ${estado === 'pendiente' ? 'var(--at-warning-border)' : etiqueta === 'vencida' ? 'var(--at-danger-tint)' : 'var(--at-line)'}`, borderRadius: '12px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', opacity: etiqueta === 'suspendida' ? 0.65 : 1 }}>
                <span aria-hidden style={{ fontSize: '22px', flexShrink: 0 }}>{icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>{v.nombre}</span>
                    <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: chip.bg, color: chip.color }}>{chip.text}</span>
                    {vencePronto && <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' }}>{dias === 0 ? 'Vence hoy' : `Vence en ${dias} día${dias === 1 ? '' : 's'}`}</span>}
                    {solicitada && <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: 'var(--at-primary-tint)', color: 'var(--at-primary)' }}>Renovación solicitada hasta {v.renovacion_solicitada_hasta?.slice(0, 10)}</span>}
                  </div>
                  <div style={{ fontSize: '12.5px', color: 'var(--at-ink-3)', display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '2px' }}>
                    <span>{relacionLabel(v.relacion)}</span>
                    {v.identificacion && <span>🪪 {v.identificacion}</span>}
                    {v.placa_vehiculo && <span>🚗 {v.placa_vehiculo}</span>}
                  </div>
                  <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                    📅 {describirDias(v)} · ⏰ {describirHorario(v)}{describirVigencia(v) ? ` · ${describirVigencia(v)}` : ''}
                  </div>
                  {estado === 'rechazada' && v.motivo_rechazo && (
                    <div style={{ fontSize: '12px', color: 'var(--at-danger)', marginTop: '3px' }}>Motivo: {v.motivo_rechazo}</div>
                  )}
                  {estado === 'pendiente' && (
                    <div style={{ fontSize: '11.5px', color: 'var(--at-warning-strong)', marginTop: '3px' }}>Mientras la administración no la apruebe, el guardia le consultará a usted en cada ingreso.</div>
                  )}
                  {etiqueta === 'vencida' && !solicitada && (
                    <div style={{ fontSize: '11.5px', color: 'var(--at-danger)', marginTop: '3px' }}>La autorización venció: solicite la renovación para que vuelva a valer en portería.</div>
                  )}
                  {solicitada && (
                    <div style={{ fontSize: '11.5px', color: 'var(--at-primary)', marginTop: '3px' }}>
                      Renovación pedida el {v.renovacion_solicitada_en ? new Date(v.renovacion_solicitada_en).toLocaleDateString('es', { day: '2-digit', month: 'short' }) : ''}; la administración la revisará.
                      {!estaVencida(v) && ` La autorización actual sigue vigente hasta el ${v.vigente_hasta?.slice(0, 10)}.`}
                    </div>
                  )}
                </div>
                {porVencer && !solicitada && !enRenovacion && (
                  <button type="button" disabled={procesando === v.id} onClick={() => setRenovando({ id: v.id, hasta: vigenciaMaxima(hoy) })} aria-label={`Solicitar renovación de ${v.nombre}`}
                    style={{ padding: '6px 12px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600, flexShrink: 0 }}>
                    🔄 Solicitar renovación
                  </button>
                )}
                {solicitada && (
                  <button type="button" disabled={procesando === v.id} onClick={() => retirarSolicitud(v)} aria-label={`Retirar solicitud de renovación de ${v.nombre}`}
                    style={{ padding: '6px 12px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600, flexShrink: 0 }}>
                    Retirar solicitud
                  </button>
                )}
                {porVencer && !solicitada && enRenovacion && (
                  <div style={{ flexBasis: '100%', display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap', paddingTop: '6px', borderTop: '1px dashed var(--at-line)' }}>
                    <div style={{ flex: '1 1 180px' }}>
                      <label style={labelBase} htmlFor={`vfp-renovar-${v.id}`}>Nueva vigencia: de hoy hasta (máx. {vigenciaMaxima(hoy)})</label>
                      <input id={`vfp-renovar-${v.id}`} type="date" min={hoy} max={vigenciaMaxima(hoy)} value={renovando.hasta} style={inputBase}
                        onChange={e => setRenovando({ id: v.id, hasta: e.target.value })} />
                    </div>
                    <button type="button" disabled={procesando === v.id} onClick={() => solicitarRenovacion(v, renovando.hasta)}
                      style={{ padding: '9px 14px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '12.5px', fontWeight: 600 }}>
                      {procesando === v.id ? 'Enviando…' : 'Enviar solicitud'}
                    </button>
                    <button type="button" disabled={procesando === v.id} onClick={() => setRenovando(null)}
                      style={{ padding: '9px 12px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '12.5px', fontWeight: 600 }}>
                      Cancelar
                    </button>
                  </div>
                )}
                {etiqueta !== 'vencida' && estado === 'aprobada' && !solicitada && (
                  <button type="button" disabled={procesando === v.id} onClick={() => toggleActivo(v)} aria-label={`${v.activo ? 'Suspender' : 'Reactivar'} ${v.nombre}`}
                    style={{ padding: '6px 12px', background: v.activo ? 'var(--at-chip)' : 'var(--at-success-tint)', color: v.activo ? 'var(--at-ink-2)' : 'var(--at-success)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600, flexShrink: 0 }}>
                    {v.activo ? 'Suspender' : 'Reactivar'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showForm && (
        <ModalPortal>
          <div
            onClick={e => { if (e.target === e.currentTarget && !saving) reset() }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '16px', overflowY: 'auto' }}>
            <div onClick={e => e.stopPropagation()} role="dialog" aria-labelledby="vf-portal-titulo"
              style={{ background: 'var(--at-surface)', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '640px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                <h3 id="vf-portal-titulo" style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>Solicitar visita frecuente</h3>
                <button onClick={reset} aria-label="Cerrar"
                  style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--at-chip)', border: 'none', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--at-ink-3)', lineHeight: 1 }}>
                  ×
                </button>
              </div>
              <p style={{ margin: '0 0 18px', fontSize: '12.5px', color: 'var(--at-ink-3)' }}>
                La administración revisará la solicitud. Una vez aprobada, la persona podrá ingresar sin consultarle a usted, siempre que se presente en los días y horario indicados.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: '14px' }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelBase} htmlFor="vfp-nombre">Nombre completo *</label>
                  <input id="vfp-nombre" value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Nombre y apellido" style={inputBase} />
                </div>
                <div>
                  <label style={labelBase} htmlFor="vfp-relacion">Relación</label>
                  <select id="vfp-relacion" value={form.relacion} onChange={e => setForm(f => ({ ...f, relacion: e.target.value as RelacionVisitaFrecuente }))} style={inputBase}>
                    {RELACIONES_VISITA.map(r => <option key={r.value} value={r.value}>{r.icon} {r.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelBase} htmlFor="vfp-identificacion">DPI / Identificación</label>
                  <input id="vfp-identificacion" value={form.identificacion} onChange={e => setForm(f => ({ ...f, identificacion: e.target.value }))} placeholder="DPI, pasaporte..." style={inputBase} />
                </div>
                <div>
                  <label style={labelBase} htmlFor="vfp-telefono">Teléfono</label>
                  <input id="vfp-telefono" value={form.telefono} onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} style={inputBase} />
                </div>
                <div>
                  <label style={labelBase} htmlFor="vfp-placa">Placa del vehículo</label>
                  <input id="vfp-placa" value={form.placa_vehiculo} onChange={e => setForm(f => ({ ...f, placa_vehiculo: e.target.value }))} placeholder="Ej. ABC-123" style={inputBase} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelBase}>Días en que puede ingresar (ninguno = todos)</label>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {DIAS_SEMANA.map(d => {
                      const on = form.dias_permitidos.includes(d)
                      return (
                        <button key={d} type="button" onClick={() => toggleDia(d)} aria-pressed={on}
                          style={{ width: 40, padding: '7px 0', borderRadius: '8px', border: `1.5px solid ${on ? 'var(--at-primary)' : 'var(--at-line)'}`, fontSize: '13px', fontWeight: 700, cursor: 'pointer', background: on ? 'var(--at-primary)' : 'var(--at-surface-2)', color: on ? 'white' : 'var(--at-ink-2)' }}>
                          {DIA_LABEL_CORTO[d]}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div>
                  <label style={labelBase} htmlFor="vfp-hora-desde">Hora desde</label>
                  <input id="vfp-hora-desde" type="time" value={form.hora_desde} onChange={e => setForm(f => ({ ...f, hora_desde: e.target.value }))} style={inputBase} />
                </div>
                <div>
                  <label style={labelBase} htmlFor="vfp-hora-hasta">Hora hasta</label>
                  <input id="vfp-hora-hasta" type="time" value={form.hora_hasta} onChange={e => setForm(f => ({ ...f, hora_hasta: e.target.value }))} style={inputBase} />
                </div>
                <div>
                  <label style={labelBase} htmlFor="vfp-vigente-hasta">Autorización válida hasta *</label>
                  <input id="vfp-vigente-hasta" type="date" required min={hoy} max={vigenciaMaxima(hoy)} value={form.vigente_hasta} onChange={e => setForm(f => ({ ...f, vigente_hasta: e.target.value }))} style={inputBase} />
                  <p style={{ margin: '3px 0 0', fontSize: '11.5px', color: 'var(--at-ink-3)' }}>Máximo {VIGENCIA_MAXIMA_MESES} meses (hasta {vigenciaMaxima(hoy)}). Al vencer, deberá solicitar la renovación.</p>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelBase} htmlFor="vfp-notas">Notas para la administración y el guardia</label>
                  <input id="vfp-notas" value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} placeholder="Opcional" style={inputBase} />
                </div>
                <div style={{ gridColumn: '1 / -1', maxWidth: '220px' }}>
                  <ImageUploader value={fotoUrl} onChange={setFotoUrl} folder="visitantes" label="Foto de la persona (opcional)" capture />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                <button onClick={solicitar} disabled={saving}
                  style={{ padding: '10px 22px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-primary-hover))', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
                  {saving ? 'Enviando...' : '📨 Enviar solicitud'}
                </button>
                <button onClick={reset} disabled={saving}
                  style={{ padding: '10px 16px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </section>
  )
}
