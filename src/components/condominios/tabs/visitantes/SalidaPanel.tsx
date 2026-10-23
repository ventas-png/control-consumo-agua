// Registrar la salida de un visitante, en ventana (pantalla completa en el
// teléfono). Mientras guarda no se cierra; si la novedad falla, la salida ya
// quedó y la ventana sigue abierta con lo escrito para reintentar sólo la
// novedad.
import type { CSSProperties } from 'react'
import type { PrioridadNovedad, TipoNovedad, VisitantesCtx } from './ctx'
import { MultiImageUploader } from '../../../shared/ImageUploader'
import { EditModal } from '../../../shared/EditModal'
import { Button } from '../../../shared/Button'

const lbl: CSSProperties = { fontSize: '11.5px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }
const inp: CSSProperties = { width: '100%', boxSizing: 'border-box', minWidth: 0, padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13px', background: 'var(--at-surface)', color: 'var(--at-ink)' }
const chip = (bg: string, color: string): CSSProperties => ({ padding: '1px 7px', background: bg, color, borderRadius: '20px', fontSize: '11px', fontWeight: 700 })

export function SalidaPanel({ ctx }: { ctx: VisitantesCtx }) {
  const { visitantes, salidaPendiente, modoSalida, setModoSalida, guardandoSalida, novedadForm, setNovedadForm, fotosNovedad, setFotosNovedad, salidaConAcomp, setSalidaConAcomp, cancelarSalida, confirmarSalida } = ctx
  if (!salidaPendiente) return null
  const acompsActivos = visitantes.filter(v => v.visitante_principal_id === salidaPendiente.id && !v.hora_salida)

  const opcion = (modo: 'sin_novedad' | 'con_novedad', titulo: string, detalle: string, color: string, fondo: string) => {
    const activa = modoSalida === modo
    return (
      <button type="button" onClick={() => setModoSalida(modo)} aria-pressed={activa}
        style={{ padding: '14px 12px', borderRadius: '10px', border: `2px solid ${activa ? color : 'var(--at-line)'}`, background: activa ? fondo : 'var(--at-surface-2)', color: activa ? color : 'var(--at-ink-2)', fontWeight: 700, fontSize: '13px', cursor: 'pointer', textAlign: 'center' }}>
        {titulo}
        <div style={{ fontSize: '11px', fontWeight: 400, marginTop: '4px', color: activa ? color : 'var(--at-ink-3)' }}>{detalle}</div>
      </button>
    )
  }

  return (
    <EditModal
      title="Registrar salida"
      subtitle={
        <span style={{ display: 'inline-flex', gap: '4px 6px', alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{salidaPendiente.nombre}{salidaPendiente.unidad_nombre ? ` · ${salidaPendiente.unidad_nombre}` : ''}</span>
          {salidaPendiente.es_menor && <span style={chip('var(--at-warning-tint)', 'var(--at-warning-strong)')}>Menor</span>}
          {salidaPendiente.visitante_principal_id && <span style={chip('var(--at-primary-tint)', 'var(--at-primary-hover)')}>Acompañante</span>}
          {salidaPendiente.reserva_str_id && <span style={chip('var(--at-accent-tint-2)', 'var(--at-accent-hover)')}>STR</span>}
          {salidaPendiente.solicitud_mudanza_id && <span style={chip('var(--at-warning-tint)', 'var(--at-warning)')}>Mudanza</span>}
        </span>
      }
      maxWidth="500px"
      fullScreenOnMobile
      onClose={cancelarSalida}
      closeOnBackdropClick={!guardandoSalida}
      closeOnEscape={!guardandoSalida}
      footer={
        <>
          <Button variant="secondary" onClick={cancelarSalida} disabled={guardandoSalida}>Cancelar</Button>
          <Button variant={modoSalida === 'con_novedad' ? 'danger' : 'success'} onClick={() => void confirmarSalida()} disabled={modoSalida === 'idle'}
            loading={guardandoSalida} loadingText="Registrando…">
            {modoSalida === 'con_novedad' ? '⚠️ Registrar salida y novedad' : '✓ Confirmar salida'}
          </Button>
        </>
      }
    >
      <p style={{ margin: '0 0 14px', fontSize: '13.5px', color: 'var(--at-ink-2)', fontWeight: 600 }}>¿Cómo fue la salida?</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))', gap: '10px', marginBottom: '16px' }}>
        {opcion('sin_novedad', '✅ Sin novedad', 'Todo en orden', 'var(--at-success)', 'var(--at-success-tint)')}
        {opcion('con_novedad', '⚠️ Con novedad', 'Registrar incidencia', 'var(--at-danger)', 'var(--at-danger-tint)')}
      </div>

      {acompsActivos.length > 0 && (
        <div style={{ marginBottom: '16px', padding: '12px 14px', background: 'var(--at-primary-tint)', border: '1.5px solid var(--at-primary-soft-2)', borderRadius: '10px' }}>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--at-primary-hover)', fontWeight: 600 }}>
            <input type="checkbox" checked={salidaConAcomp} onChange={e => setSalidaConAcomp(e.target.checked)} style={{ marginTop: '2px' }} />
            <span>
              También dar salida a {acompsActivos.length} acompañante{acompsActivos.length > 1 ? 's' : ''} en premisas
              <span style={{ display: 'block', fontWeight: 400, fontSize: '11.5px', color: 'var(--at-primary-2)', marginTop: '2px' }}>
                {acompsActivos.map(a => a.nombre + (a.es_menor ? ' (menor)' : '')).join(', ')}
              </span>
            </span>
          </label>
        </div>
      )}

      {modoSalida === 'con_novedad' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px', background: 'var(--at-warning-tint)', border: '1.5px solid var(--at-warning-border)', borderRadius: '10px' }}>
          <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--at-warning-strong)' }}>Detalle de la novedad</div>
          <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-warning-border)', borderRadius: '8px', padding: '10px 12px' }}>
            <div style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--at-warning-strong)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Datos del registro (incluidos automáticamente)</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
              <span style={{ fontSize: '12px', color: 'var(--at-ink-2)' }}>👤 <b>{salidaPendiente.nombre}</b></span>
              {salidaPendiente.identificacion && <span style={{ fontSize: '12px', color: 'var(--at-ink-2)' }}>🪪 {salidaPendiente.identificacion}</span>}
              {salidaPendiente.unidad_nombre && <span style={{ fontSize: '12px', color: 'var(--at-ink-2)' }}>📍 {salidaPendiente.unidad_nombre}</span>}
              {salidaPendiente.placa_vehiculo && <span style={{ fontSize: '12px', color: 'var(--at-ink-2)' }}>🚗 {salidaPendiente.placa_vehiculo}</span>}
              {salidaPendiente.motivo && <span style={{ fontSize: '12px', color: 'var(--at-ink-2)' }}>· {salidaPendiente.motivo}</span>}
              <span style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>
                Entrada: {new Date(salidaPendiente.hora_entrada).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))', gap: '10px' }}>
            <div>
              <label htmlFor="salida-tipo" style={lbl}>Tipo</label>
              <select id="salida-tipo" value={novedadForm.tipo} onChange={e => setNovedadForm(f => ({ ...f, tipo: e.target.value as TipoNovedad }))} style={inp}>
                <option value="incidente">Incidente</option>
                <option value="observacion">Observación</option>
                <option value="alarma">Alarma</option>
                <option value="acceso">Acceso</option>
                <option value="otro">Otro</option>
              </select>
            </div>
            <div>
              <label htmlFor="salida-prioridad" style={lbl}>Prioridad</label>
              <select id="salida-prioridad" value={novedadForm.prioridad} onChange={e => setNovedadForm(f => ({ ...f, prioridad: e.target.value as PrioridadNovedad }))} style={inp}>
                <option value="normal">Normal</option>
                <option value="alta">Alta</option>
                <option value="critica">Crítica</option>
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="salida-ubicacion" style={lbl}>Ubicación</label>
            <input id="salida-ubicacion" value={novedadForm.ubicacion} onChange={e => setNovedadForm(f => ({ ...f, ubicacion: e.target.value }))}
              placeholder={`Ej. ${salidaPendiente.unidad_nombre ?? 'Entrada principal'}`} style={inp} />
          </div>
          <div>
            <label htmlFor="salida-comentarios" style={lbl}>Comentarios / descripción *</label>
            <textarea id="salida-comentarios" value={novedadForm.comentarios} onChange={e => setNovedadForm(f => ({ ...f, comentarios: e.target.value }))}
              placeholder="Describe con detalle lo ocurrido durante la salida..."
              rows={3}
              style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} />
          </div>
          <div>
            <MultiImageUploader values={fotosNovedad} onChange={setFotosNovedad} folder="novedades" label="Fotografías de evidencia" capture maxFiles={10} />
          </div>
        </div>
      )}
    </EditModal>
  )
}
