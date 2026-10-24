// Verificación de la pre-autorización dentro del registro de ingreso.
//
// Cuando el guardia elige a una visita frecuente, aquí ve lo que la
// administración autorizó (días, horario, vigencia) y si la persona cumple en
// este momento. Si cumple, el ingreso se registra como pre-autorizado sin más.
// Si no cumple (día u hora distintos, autorización vencida, suspendida o aún
// sin aprobar), el guardia tiene que llamar al residente y dejar escrito qué
// respondió: autoriza (entra, y queda con «autorizó residente») o no autoriza
// (no entra: queda como novedad de seguridad, sin fila de visitante).
import type { VisitantesCtx } from './ctx'
import { SecureImage } from '../../../shared/SecureImage'
import {
  ESTADO_VISITA_LABEL, MEDIOS_AUTORIZACION, estadoVisita, relacionLabel,
  type MedioAutorizacionResidente,
} from '../../../../lib/visitasFrecuentes'

const inputStyle = { width: '100%', boxSizing: 'border-box', minWidth: 0, padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', background: 'var(--at-surface)' } as const
const labelStyle = { fontSize: '11.5px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '3px' } as const

export function PreautorizacionPanel({ ctx }: { ctx: VisitantesCtx }) {
  const { unidades, visitaFrecuenteSel: vf, evaluacionFrecuente: ev, requiereAutorizacionResidente, autorizacionResidente, setAutorizacionResidente, quitarFrecuente, saving } = ctx
  if (!vf || !ev) return null
  const unidad = unidades.find(u => u.id === vf.unidad_id)
  const estado = estadoVisita(vf)
  const decision = autorizacionResidente.decision

  const estadoChip = estado === 'aprobada' && vf.activo
    ? { bg: 'var(--at-success-tint)', color: 'var(--at-success)', text: 'Aprobada' }
    : estado === 'pendiente'
      ? { bg: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', text: ESTADO_VISITA_LABEL.pendiente }
      : estado === 'rechazada'
        ? { bg: 'var(--at-danger-tint)', color: 'var(--at-danger)', text: ESTADO_VISITA_LABEL.rechazada }
        : { bg: 'var(--at-chip)', color: 'var(--at-ink-3)', text: 'Suspendida' }

  return (
    <section aria-label="Verificación de pre-autorización"
      style={{ gridColumn: '1 / -1', border: `1.5px solid ${ev.cumple ? 'var(--at-success-border)' : 'var(--at-warning-border)'}`, borderRadius: '12px', background: 'var(--at-surface-2)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
        {vf.foto_url
          ? <SecureImage src={vf.foto_url} alt={vf.nombre} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '2px solid var(--at-line)' }} />
          : <div aria-hidden style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0, background: 'var(--at-primary-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>👨‍👩‍👧</div>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>Visita frecuente: {vf.nombre}</span>
            <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '10.5px', fontWeight: 700, background: estadoChip.bg, color: estadoChip.color }}>{estadoChip.text}</span>
          </div>
          <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <span>{relacionLabel(vf.relacion)}</span>
            {unidad && <span>· 📍 {unidad.nombre}</span>}
            {vf.identificacion && <span>· ID: {vf.identificacion}</span>}
            {vf.placa_vehiculo && <span>· 🚗 {vf.placa_vehiculo}</span>}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--at-ink-2)', marginTop: '4px' }}>
            <strong>Autorizado:</strong> {ev.autorizado}
            {vf.autorizado_en && estado === 'aprobada' && (
              <span style={{ color: 'var(--at-ink-3)' }}> · aprobó administración el {new Date(vf.autorizado_en).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
            )}
          </div>
          {vf.notas && <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', fontStyle: 'italic', marginTop: '2px' }}>{vf.notas}</div>}
        </div>
        <button type="button" onClick={quitarFrecuente} disabled={saving} aria-label="Quitar visita frecuente"
          style={{ padding: '4px 10px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600, flexShrink: 0 }}>
          Quitar
        </button>
      </div>

      {ev.cumple ? (
        <div role="status" style={{ background: 'var(--at-success-tint)', border: '1px solid var(--at-success-border)', borderRadius: '10px', padding: '10px 12px', fontSize: '13px', color: 'var(--at-success)', fontWeight: 600 }}>
          ✅ Se presenta dentro de lo autorizado. El ingreso quedará registrado como <strong>pre-autorizado</strong>, sin consultar al residente.
        </div>
      ) : (
        <>
          <div role="alert" style={{ background: 'var(--at-warning-tint)', border: '1px solid var(--at-warning-border)', borderRadius: '10px', padding: '10px 12px', fontSize: '13px', color: 'var(--at-warning-strong)' }}>
            <div style={{ fontWeight: 700, marginBottom: '4px' }}>⚠️ No cumple la pre-autorización</div>
            <ul style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {ev.motivos.map(m => <li key={m}>{m}</li>)}
            </ul>
          </div>

          <div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--at-ink-2)', marginBottom: '6px' }}>📞 Confirmar con el residente</div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button type="button" aria-pressed={decision === 'autoriza'} disabled={saving}
                onClick={() => setAutorizacionResidente(a => ({ ...a, decision: 'autoriza' }))}
                style={{ flex: '1 1 160px', padding: '9px 12px', borderRadius: '10px', cursor: 'pointer', fontSize: '13px', fontWeight: 700, border: `1.5px solid ${decision === 'autoriza' ? 'var(--at-success)' : 'var(--at-line)'}`, background: decision === 'autoriza' ? 'var(--at-success)' : 'var(--at-surface)', color: decision === 'autoriza' ? 'var(--at-on-status)' : 'var(--at-ink-2)' }}>
                ✅ El residente autoriza el ingreso
              </button>
              <button type="button" aria-pressed={decision === 'deniega'} disabled={saving}
                onClick={() => setAutorizacionResidente(a => ({ ...a, decision: 'deniega' }))}
                style={{ flex: '1 1 160px', padding: '9px 12px', borderRadius: '10px', cursor: 'pointer', fontSize: '13px', fontWeight: 700, border: `1.5px solid ${decision === 'deniega' ? 'var(--at-danger)' : 'var(--at-line)'}`, background: decision === 'deniega' ? 'var(--at-danger)' : 'var(--at-surface)', color: decision === 'deniega' ? 'white' : 'var(--at-ink-2)' }}>
                ⛔ El residente NO autoriza
              </button>
            </div>
            {requiereAutorizacionResidente && decision === '' && (
              <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', marginTop: '6px' }}>Sin la respuesta del residente no se puede registrar el ingreso.</div>
            )}
            {decision !== '' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))', gap: '10px', marginTop: '10px' }}>
                <div>
                  <label htmlFor="aut-medio" style={labelStyle}>Medio</label>
                  <select id="aut-medio" value={autorizacionResidente.medio} style={inputStyle}
                    onChange={e => setAutorizacionResidente(a => ({ ...a, medio: e.target.value as MedioAutorizacionResidente }))}>
                    {MEDIOS_AUTORIZACION.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="aut-quien" style={labelStyle}>Quién respondió por la unidad</label>
                  <input id="aut-quien" value={autorizacionResidente.quien} placeholder="Nombre del residente" style={inputStyle}
                    onChange={e => setAutorizacionResidente(a => ({ ...a, quien: e.target.value }))} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label htmlFor="aut-comentario" style={labelStyle}>Comentario</label>
                  <input id="aut-comentario" value={autorizacionResidente.comentario} placeholder="Opcional" style={inputStyle}
                    onChange={e => setAutorizacionResidente(a => ({ ...a, comentario: e.target.value }))} />
                </div>
                {decision === 'deniega' && (
                  <div style={{ gridColumn: '1 / -1', fontSize: '12px', color: 'var(--at-danger)' }}>
                    La persona no ingresa: se registrará como <strong>ingreso denegado</strong> en las novedades de seguridad, no como visitante.
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
