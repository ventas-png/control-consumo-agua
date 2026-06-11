// Vista extraída de AmenidadesTab (fase B): JSX idéntico al original.
import type { MotivoBloqueoAmenidad } from '../../../../types'
import type { AmenidadesCtx } from './ctx'
import { MOTIVO_LABEL } from './ui'
import { EmptyState } from './comunes'

export function VistaBloqueos({ ctx }: { ctx: AmenidadesCtx }) {
  const { amenidades, bloqueos, canEdit, showBloqueoForm, setShowBloqueoForm, saving, bloqueoForm, setBloqueoForm, hoy, guardarBloqueo, eliminarBloqueo } = ctx
  return (
        <>
          {showBloqueoForm && (
            <div style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-warning-border)', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
              <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>Nuevo bloqueo</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Amenidad *</label>
                  <select value={bloqueoForm.amenidad_id} onChange={e => setBloqueoForm(f => ({ ...f, amenidad_id: e.target.value }))}
                    style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }}>
                    <option value="">Seleccionar...</option>
                    {amenidades.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Desde *</label>
                  <input type="date" value={bloqueoForm.fecha_inicio} onChange={e => setBloqueoForm(f => ({ ...f, fecha_inicio: e.target.value, fecha_fin: f.fecha_fin || e.target.value }))} min={hoy}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Hasta *</label>
                  <input type="date" value={bloqueoForm.fecha_fin} onChange={e => setBloqueoForm(f => ({ ...f, fecha_fin: e.target.value }))} min={bloqueoForm.fecha_inicio || hoy}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                </div>
                <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" id="dia_completo" checked={bloqueoForm.dia_completo} onChange={e => setBloqueoForm(f => ({ ...f, dia_completo: e.target.checked }))} />
                  <label htmlFor="dia_completo" style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--at-ink-2)', cursor: 'pointer' }}>Día completo (sin horario específico)</label>
                </div>
                {!bloqueoForm.dia_completo && (
                  <>
                    <div>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Hora inicio *</label>
                      <input type="time" value={bloqueoForm.hora_inicio} onChange={e => setBloqueoForm(f => ({ ...f, hora_inicio: e.target.value }))}
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Hora fin *</label>
                      <input type="time" value={bloqueoForm.hora_fin} onChange={e => setBloqueoForm(f => ({ ...f, hora_fin: e.target.value }))}
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                    </div>
                  </>
                )}
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Motivo *</label>
                  <select value={bloqueoForm.motivo} onChange={e => setBloqueoForm(f => ({ ...f, motivo: e.target.value as MotivoBloqueoAmenidad }))}
                    style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }}>
                    {(Object.keys(MOTIVO_LABEL) as MotivoBloqueoAmenidad[]).map(m => <option key={m} value={m}>{MOTIVO_LABEL[m]}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Notas</label>
                  <input value={bloqueoForm.notas} onChange={e => setBloqueoForm(f => ({ ...f, notas: e.target.value }))} placeholder="Detalle del bloqueo (opcional)"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                <button onClick={guardarBloqueo} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,var(--at-warning),var(--at-warning))', color: 'var(--at-on-status)', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
                  {saving ? 'Guardando...' : 'Registrar bloqueo'}
                </button>
                <button onClick={() => setShowBloqueoForm(false)} style={{ padding: '10px 20px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
              </div>
            </div>
          )}
          {bloqueos.length === 0 ? (
            <EmptyState
              icon="🚫"
              title="No hay bloqueos registrados"
              hint="Registra un bloqueo cuando una amenidad no esté disponible — mantenimiento, limpieza, evento privado, reparación. Puede ser día completo o sólo en un rango horario."
              action={canEdit ? (
                <button onClick={() => setShowBloqueoForm(true)} style={{ padding: '10px 20px', background: 'linear-gradient(135deg,var(--at-warning),var(--at-warning))', color: 'var(--at-on-status)', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer', fontSize: 13.5 }}>
                  + Registrar bloqueo
                </button>
              ) : null}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {bloqueos
                .slice()
                .sort((a, b) => a.fecha_inicio < b.fecha_inicio ? 1 : -1)
                .map(b => {
                  const vigente = b.fecha_fin >= hoy
                  return (
                    <div key={b.id} style={{ background: 'var(--at-surface)', border: `1.5px solid ${vigente ? 'var(--at-warning-border)' : 'var(--at-line)'}`, borderRadius: '12px', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', opacity: vigente ? 1 : 0.7 }}>
                      <div style={{ flex: 1, minWidth: 220 }}>
                        <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>
                          {b.amenidad_nombre || amenidades.find(a => a.id === b.amenidad_id)?.nombre || 'Amenidad'}
                          <span style={{ marginLeft: 8, padding: '2px 8px', borderRadius: 12, fontSize: 10.5, fontWeight: 700, background: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)' }}>{MOTIVO_LABEL[b.motivo]}</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 2 }}>
                          {b.fecha_inicio === b.fecha_fin ? b.fecha_inicio : `${b.fecha_inicio} → ${b.fecha_fin}`}
                          {b.hora_inicio && b.hora_fin ? ` · ${b.hora_inicio}–${b.hora_fin}` : ' · día completo'}
                        </div>
                        {b.notas && <div style={{ fontSize: 11.5, color: 'var(--at-ink-3)', marginTop: 2 }}>{b.notas}</div>}
                      </div>
                      <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11.5, fontWeight: 700, background: vigente ? 'var(--at-warning-tint)' : 'var(--at-chip)', color: vigente ? 'var(--at-warning-strong)' : 'var(--at-ink-3)' }}>
                        {vigente ? 'Vigente' : 'Pasado'}
                      </span>
                      {canEdit && (
                        <button onClick={() => eliminarBloqueo(b.id)} style={{ padding: '5px 12px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: '1px solid var(--at-danger-border)', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                          Eliminar
                        </button>
                      )}
                    </div>
                  )
                })}
            </div>
          )}
        </>
  )
}
