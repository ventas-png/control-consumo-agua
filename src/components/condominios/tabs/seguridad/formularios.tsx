// Formularios inline de novedad y de inicio de ronda (P1 #3, extraídos de
// SeguridadTab con el JSX intacto).
import { MultiImageUploader } from '../../../shared/ImageUploader'
import type { TipoNovedad, PrioridadNovedad } from '../../../../types'
import type { SeguridadCtx } from './ctx'
import { TIPO_NOVEDAD_CONFIG } from './ui'

export function NovedadForm({ ctx }: { ctx: SeguridadCtx }) {
  const {
    rondaEnCurso, saving, novedadForm, setNovedadForm,
    fotosNovedadForm, setFotosNovedadForm, setShowNovedadForm, registrarNovedad,
  } = ctx

  return (
    <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
      <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>Registrar novedad</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
        <div>
          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Tipo</label>
          <select value={novedadForm.tipo} onChange={e => setNovedadForm(f => ({ ...f, tipo: e.target.value as TipoNovedad }))}
            style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }}>
            {(Object.entries(TIPO_NOVEDAD_CONFIG) as [TipoNovedad, typeof TIPO_NOVEDAD_CONFIG[TipoNovedad]][]).map(([v, c]) => (
              <option key={v} value={v}>{c.icon} {c.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Prioridad</label>
          <select value={novedadForm.prioridad} onChange={e => setNovedadForm(f => ({ ...f, prioridad: e.target.value as PrioridadNovedad }))}
            style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }}>
            <option value="normal">Normal</option>
            <option value="alta">Alta</option>
            <option value="critica">Crítica</option>
          </select>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Descripción *</label>
          <textarea value={novedadForm.descripcion} onChange={e => setNovedadForm(f => ({ ...f, descripcion: e.target.value }))}
            placeholder="Detalle la novedad..." rows={3}
            style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)', resize: 'vertical' }} />
        </div>
        <div>
          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Ubicación</label>
          <input value={novedadForm.ubicacion} onChange={e => setNovedadForm(f => ({ ...f, ubicacion: e.target.value }))} placeholder="Ej. Entrada principal, Nivel 3..."
            style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
        </div>
        {rondaEnCurso && (
          <div>
            <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Vincular a ronda actual</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13.5px', color: 'var(--at-ink-2)', cursor: 'pointer', marginTop: '8px' }}>
              <input type="checkbox" checked={novedadForm.ronda_id === rondaEnCurso.id}
                onChange={e => setNovedadForm(f => ({ ...f, ronda_id: e.target.checked ? rondaEnCurso.id : '' }))} />
              Sí, vincular a esta ronda
            </label>
          </div>
        )}
        <div style={{ gridColumn: '1 / -1' }}>
          <MultiImageUploader
            values={fotosNovedadForm}
            onChange={setFotosNovedadForm}
            folder="novedades"
            label="Fotografías de evidencia (opcional)"
            capture
            maxFiles={10}
          />
        </div>
      </div>
      <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
        <button onClick={registrarNovedad} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
          {saving ? 'Guardando...' : 'Registrar'}
        </button>
        <button onClick={() => { setShowNovedadForm(false); setFotosNovedadForm([]) }} style={{ padding: '10px 20px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
      </div>
    </div>
  )
}

export function RondaForm({ ctx }: { ctx: SeguridadCtx }) {
  const { saving, rondaForm, setRondaForm, setShowRondaForm, iniciarRonda, rutasActivas, puntosControl } = ctx

  return (
    <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
      <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>Iniciar ronda de seguridad</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Ruta de ronda</label>
          <select value={rondaForm.ruta_id} onChange={e => setRondaForm(f => ({ ...f, ruta_id: e.target.value }))}
            style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }}>
            <option value="">Sin ruta específica</option>
            {rutasActivas.map(r => {
              const cantPuntos = puntosControl.filter(p => p.ruta_id === r.id).length
              return <option key={r.id} value={r.id}>{r.nombre} ({cantPuntos} punto{cantPuntos !== 1 ? 's' : ''}{r.tiempo_estimado_min ? ` · ~${r.tiempo_estimado_min} min` : ''})</option>
            })}
          </select>
          {rondaForm.ruta_id && (
            <p style={{ margin: '6px 0 0', fontSize: '12px', color: 'var(--at-accent)' }}>
              🗺 Se generará automáticamente el checklist de puntos de control.
            </p>
          )}
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Notas (opcional)</label>
          <input value={rondaForm.notas} onChange={e => setRondaForm(f => ({ ...f, notas: e.target.value }))} placeholder="Observaciones iniciales..."
            style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
        <button onClick={iniciarRonda} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
          🛡 Iniciar ahora
        </button>
        <button onClick={() => setShowRondaForm(false)} style={{ padding: '10px 20px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
      </div>
    </div>
  )
}
