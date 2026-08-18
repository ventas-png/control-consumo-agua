// Vista extraída de AmenidadesTab (fase B): JSX idéntico al original.
import type { AmenidadesCtx } from './ctx'
import { pillStyle, RESERVA_CAL_COLORS } from './ui'
import { ImageUploader } from '../../../shared/ImageUploader'
import { EmptyState } from './comunes'
import { formatFechaCalendario } from '../../../../lib/format'

export function VistaAmenidades({ ctx }: { ctx: AmenidadesCtx }) {
  const { amenidades, reservas, moneda, canCreate, canEdit, showAmenidadForm, setShowAmenidadForm, saving, amenidadFotoUrl, setAmenidadFotoUrl, amenidadForm, setAmenidadForm, editingAmenidad, setEditingAmenidad, editAmenidadFotoUrl, setEditAmenidadFotoUrl, editAmenidadForm, setEditAmenidadForm, savingEdit, hoy, amenidadFotoUrls, guardarAmenidad, guardarEdicion, toggleAmenidad, eliminarAmenidad, abrirEdicion } = ctx
  return (
        <>
          {showAmenidadForm && (
            <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
              <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>Nueva amenidad</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Nombre *</label>
                  <input value={amenidadForm.nombre} onChange={e => setAmenidadForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej. Piscina, Gimnasio, Salón Social"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Capacidad máxima</label>
                  <input type="number" value={amenidadForm.capacidad_max} onChange={e => setAmenidadForm(f => ({ ...f, capacidad_max: e.target.value }))} placeholder="Personas"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Descripción</label>
                  <input value={amenidadForm.descripcion} onChange={e => setAmenidadForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Opcional"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Horario inicio</label>
                  <input type="time" value={amenidadForm.horario_inicio} onChange={e => setAmenidadForm(f => ({ ...f, horario_inicio: e.target.value }))}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                </div>
                <div>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Horario fin</label>
                  <input type="time" value={amenidadForm.horario_fin} onChange={e => setAmenidadForm(f => ({ ...f, horario_fin: e.target.value }))}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input type="checkbox" id="deposito" checked={amenidadForm.requiere_deposito} onChange={e => setAmenidadForm(f => ({ ...f, requiere_deposito: e.target.checked }))} />
                  <label htmlFor="deposito" style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--at-ink-2)', cursor: 'pointer' }}>Requiere depósito</label>
                </div>
                {amenidadForm.requiere_deposito && (
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Monto depósito ({moneda})</label>
                    <input type="number" value={amenidadForm.monto_deposito} onChange={e => setAmenidadForm(f => ({ ...f, monto_deposito: e.target.value }))} min="0" step="0.01"
                      style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input type="checkbox" id="tarifa" checked={amenidadForm.requiere_tarifa} onChange={e => setAmenidadForm(f => ({ ...f, requiere_tarifa: e.target.checked }))} />
                  <label htmlFor="tarifa" style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--at-ink-2)', cursor: 'pointer' }}>Tarifa por uso</label>
                </div>
                {amenidadForm.requiere_tarifa && (
                  <>
                    <div>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Tarifa entre semana ({moneda})</label>
                      <input type="number" value={amenidadForm.tarifa_uso} onChange={e => setAmenidadForm(f => ({ ...f, tarifa_uso: e.target.value }))} min="0" step="0.01"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Tarifa fin de semana ({moneda})</label>
                      <input type="number" value={amenidadForm.tarifa_uso_finde} onChange={e => setAmenidadForm(f => ({ ...f, tarifa_uso_finde: e.target.value }))} min="0" step="0.01" placeholder="Igual que entre semana"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                    </div>
                  </>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <input type="checkbox" id="aprobacion" checked={amenidadForm.requiere_aprobacion} onChange={e => setAmenidadForm(f => ({ ...f, requiere_aprobacion: e.target.checked }))} />
                  <label htmlFor="aprobacion" style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--at-ink-2)', cursor: 'pointer' }}>Requiere aprobación del administrador</label>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Reglamento (opcional)</label>
                  <textarea value={amenidadForm.reglamento} onChange={e => setAmenidadForm(f => ({ ...f, reglamento: e.target.value }))}
                    placeholder="Texto del reglamento que el residente debe aceptar al reservar (horarios, limpieza, daños, invitados, etc.)"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13.5px', background: 'var(--at-surface-2)', minHeight: 70, resize: 'vertical' }} />
                </div>
                <div style={{ gridColumn: '1 / -1', borderTop: '1px dashed var(--at-line)', paddingTop: 12, marginTop: 4 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--at-ink-2)', marginBottom: 8 }}>Reglas de reserva (opcional)</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: 4 }}>Máx. reservas/mes por unidad</label>
                      <input type="number" min={1} value={amenidadForm.max_reservas_mes_unidad} onChange={e => setAmenidadForm(f => ({ ...f, max_reservas_mes_unidad: e.target.value }))} placeholder="sin límite"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 14, background: 'var(--at-surface-2)' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: 4 }}>Antelación mínima (horas)</label>
                      <input type="number" min={0} value={amenidadForm.horas_minimas_antelacion} onChange={e => setAmenidadForm(f => ({ ...f, horas_minimas_antelacion: e.target.value }))} placeholder="sin restricción"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 14, background: 'var(--at-surface-2)' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: 4 }}>Duración máx. (horas)</label>
                      <input type="number" min={0.5} step={0.5} value={amenidadForm.duracion_max_horas} onChange={e => setAmenidadForm(f => ({ ...f, duracion_max_horas: e.target.value }))} placeholder="sin tope"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 14, background: 'var(--at-surface-2)' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: 4 }}>Preparación previa (min)</label>
                      <input type="number" min={0} step={5} value={amenidadForm.minutos_preparacion_previa} onChange={e => setAmenidadForm(f => ({ ...f, minutos_preparacion_previa: e.target.value }))} placeholder="0"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 14, background: 'var(--at-surface-2)' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: 4 }}>Preparación posterior (min)</label>
                      <input type="number" min={0} step={5} value={amenidadForm.minutos_preparacion_posterior} onChange={e => setAmenidadForm(f => ({ ...f, minutos_preparacion_posterior: e.target.value }))} placeholder="0"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 14, background: 'var(--at-surface-2)' }} />
                    </div>
                  </div>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <ImageUploader value={amenidadFotoUrl} onChange={setAmenidadFotoUrl} folder="amenidades" label="Foto de la amenidad" />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                <button onClick={guardarAmenidad} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
                  {saving ? 'Guardando...' : 'Guardar'}
                </button>
                <button onClick={() => setShowAmenidadForm(false)} style={{ padding: '10px 20px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
              </div>
            </div>
          )}
          {/* Formulario edición de amenidad */}
          {editingAmenidad && (
            <div style={{ background: 'var(--at-surface)', border: '2px solid var(--at-primary)', borderRadius: 16, padding: 20, marginBottom: 20 }}>
              <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700 }}>Editar amenidad: <span style={{ color: 'var(--at-primary)' }}>{editingAmenidad.nombre}</span></h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: 4 }}>Nombre *</label>
                  <input value={editAmenidadForm.nombre} onChange={e => setEditAmenidadForm(f => ({ ...f, nombre: e.target.value }))}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 14, background: 'var(--at-surface-2)' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: 4 }}>Capacidad máxima</label>
                  <input type="number" value={editAmenidadForm.capacidad_max} onChange={e => setEditAmenidadForm(f => ({ ...f, capacidad_max: e.target.value }))} placeholder="Personas"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 14, background: 'var(--at-surface-2)' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: 4 }}>Descripción</label>
                  <input value={editAmenidadForm.descripcion} onChange={e => setEditAmenidadForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Opcional"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 14, background: 'var(--at-surface-2)' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: 4 }}>Horario inicio</label>
                  <input type="time" value={editAmenidadForm.horario_inicio} onChange={e => setEditAmenidadForm(f => ({ ...f, horario_inicio: e.target.value }))}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 14, background: 'var(--at-surface-2)' }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: 4 }}>Horario fin</label>
                  <input type="time" value={editAmenidadForm.horario_fin} onChange={e => setEditAmenidadForm(f => ({ ...f, horario_fin: e.target.value }))}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 14, background: 'var(--at-surface-2)' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" id="edit-deposito" checked={editAmenidadForm.requiere_deposito} onChange={e => setEditAmenidadForm(f => ({ ...f, requiere_deposito: e.target.checked }))} />
                  <label htmlFor="edit-deposito" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--at-ink-2)', cursor: 'pointer' }}>Requiere depósito</label>
                </div>
                {editAmenidadForm.requiere_deposito && (
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: 4 }}>Monto depósito ({moneda})</label>
                    <input type="number" value={editAmenidadForm.monto_deposito} onChange={e => setEditAmenidadForm(f => ({ ...f, monto_deposito: e.target.value }))} min="0" step="0.01"
                      style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 14, background: 'var(--at-surface-2)' }} />
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" id="edit-tarifa" checked={editAmenidadForm.requiere_tarifa} onChange={e => setEditAmenidadForm(f => ({ ...f, requiere_tarifa: e.target.checked }))} />
                  <label htmlFor="edit-tarifa" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--at-ink-2)', cursor: 'pointer' }}>Tarifa por uso</label>
                </div>
                {editAmenidadForm.requiere_tarifa && (
                  <>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: 4 }}>Tarifa entre semana ({moneda})</label>
                      <input type="number" value={editAmenidadForm.tarifa_uso} onChange={e => setEditAmenidadForm(f => ({ ...f, tarifa_uso: e.target.value }))} min="0" step="0.01"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 14, background: 'var(--at-surface-2)' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: 4 }}>Tarifa fin de semana ({moneda})</label>
                      <input type="number" value={editAmenidadForm.tarifa_uso_finde} onChange={e => setEditAmenidadForm(f => ({ ...f, tarifa_uso_finde: e.target.value }))} min="0" step="0.01" placeholder="Igual que entre semana"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 14, background: 'var(--at-surface-2)' }} />
                    </div>
                  </>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" id="edit-aprobacion" checked={editAmenidadForm.requiere_aprobacion} onChange={e => setEditAmenidadForm(f => ({ ...f, requiere_aprobacion: e.target.checked }))} />
                  <label htmlFor="edit-aprobacion" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--at-ink-2)', cursor: 'pointer' }}>Requiere aprobación del administrador</label>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: 4 }}>Reglamento (opcional)</label>
                  <textarea value={editAmenidadForm.reglamento} onChange={e => setEditAmenidadForm(f => ({ ...f, reglamento: e.target.value }))}
                    placeholder="Texto del reglamento"
                    style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 13.5, background: 'var(--at-surface-2)', minHeight: 60, resize: 'vertical' }} />
                </div>
                <div style={{ gridColumn: '1 / -1', borderTop: '1px dashed var(--at-line)', paddingTop: 12, marginTop: 4 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--at-ink-2)', marginBottom: 8 }}>Reglas de reserva (opcional)</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                    <div>
                      <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: 4 }}>Máx. reservas/mes por unidad</label>
                      <input type="number" min={1} value={editAmenidadForm.max_reservas_mes_unidad} onChange={e => setEditAmenidadForm(f => ({ ...f, max_reservas_mes_unidad: e.target.value }))} placeholder="sin límite"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 14, background: 'var(--at-surface-2)' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: 4 }}>Antelación mínima (horas)</label>
                      <input type="number" min={0} value={editAmenidadForm.horas_minimas_antelacion} onChange={e => setEditAmenidadForm(f => ({ ...f, horas_minimas_antelacion: e.target.value }))} placeholder="sin restricción"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 14, background: 'var(--at-surface-2)' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: 4 }}>Duración máx. (horas)</label>
                      <input type="number" min={0.5} step={0.5} value={editAmenidadForm.duracion_max_horas} onChange={e => setEditAmenidadForm(f => ({ ...f, duracion_max_horas: e.target.value }))} placeholder="sin tope"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 14, background: 'var(--at-surface-2)' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: 4 }}>Preparación previa (min)</label>
                      <input type="number" min={0} step={5} value={editAmenidadForm.minutos_preparacion_previa} onChange={e => setEditAmenidadForm(f => ({ ...f, minutos_preparacion_previa: e.target.value }))} placeholder="0"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 14, background: 'var(--at-surface-2)' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: 4 }}>Preparación posterior (min)</label>
                      <input type="number" min={0} step={5} value={editAmenidadForm.minutos_preparacion_posterior} onChange={e => setEditAmenidadForm(f => ({ ...f, minutos_preparacion_posterior: e.target.value }))} placeholder="0"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 14, background: 'var(--at-surface-2)' }} />
                    </div>
                  </div>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <ImageUploader value={editAmenidadFotoUrl} onChange={setEditAmenidadFotoUrl} folder="amenidades" label="Foto de la amenidad" />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button onClick={guardarEdicion} disabled={savingEdit} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}>
                  {savingEdit ? 'Guardando...' : 'Guardar cambios'}
                </button>
                <button onClick={() => setEditingAmenidad(null)} style={{ padding: '10px 20px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Cancelar</button>
              </div>
            </div>
          )}

          {amenidades.length === 0 ? (
            <EmptyState
              icon="🏊"
              title="Aún no hay amenidades registradas"
              hint="Crea piscinas, salones, gimnasios u otras áreas comunes. Cada amenidad puede tener foto, horario, capacidad, depósito, tarifa y reglas de reserva."
              action={canCreate ? (
                <button onClick={() => setShowAmenidadForm(true)} style={{ padding: '10px 20px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer', fontSize: 13.5 }}>
                  + Crear primera amenidad
                </button>
              ) : null}
            />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
              {amenidades.map((a, idx) => {
                const reservasA = reservas.filter(r => r.amenidad_id === a.id && r.estado === 'confirmada')
                const proxima = reservasA.filter(r => r.fecha >= hoy).sort((x, y) => (x.fecha + x.hora_inicio).localeCompare(y.fecha + y.hora_inicio))[0]
                const paleta = RESERVA_CAL_COLORS[idx % RESERVA_CAL_COLORS.length]
                return (
                <div key={a.id}
                  style={{
                    background: 'var(--at-surface)',
                    border: `1.5px solid ${a.activo ? 'var(--at-line)' : 'var(--at-chip)'}`,
                    borderRadius: 18,
                    overflow: 'hidden',
                    opacity: a.activo ? 1 : 0.55,
                    display: 'flex',
                    flexDirection: 'column',
                    transition: 'transform 0.18s ease, box-shadow 0.18s ease',
                    boxShadow: '0 2px 8px -4px rgba(15,23,42,0.08)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 14px 32px -14px rgba(15,23,42,0.25)' }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 2px 8px -4px rgba(15,23,42,0.08)' }}>
                  {/* Hero foto */}
                  <div style={{ position: 'relative', height: 140, background: amenidadFotoUrls[idx] ? `center/cover no-repeat url(${amenidadFotoUrls[idx]})` : `linear-gradient(135deg, ${paleta.bg}, ${paleta.border})` }}>
                    {!a.foto_url && (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 48, opacity: 0.7 }}>🏊</div>
                    )}
                    {/* Overlay gradiente abajo */}
                    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(15,23,42,0.75) 0%, rgba(15,23,42,0.0) 60%)' }} />
                    {/* Estado pill */}
                    {canEdit && (
                      <button onClick={() => toggleAmenidad(a)}
                        style={{ position: 'absolute', top: 10, right: 10, padding: '4px 10px', borderRadius: 999, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 800, background: a.activo ? 'rgba(240,253,244,0.95)' : 'rgba(241,245,249,0.95)', color: a.activo ? 'var(--at-success-strong)' : 'var(--at-ink-3)', backdropFilter: 'blur(4px)', boxShadow: '0 2px 6px rgba(0,0,0,0.15)' }}>
                        {a.activo ? '● Activa' : '○ Inactiva'}
                      </button>
                    )}
                    {/* Nombre */}
                    <h4 style={{ position: 'absolute', bottom: 12, left: 14, right: 14, margin: 0, fontSize: 18, fontWeight: 800, color: 'white', letterSpacing: '-0.01em', textShadow: '0 2px 6px rgba(0,0,0,0.4)' }}>
                      {a.nombre}
                    </h4>
                  </div>
                  <div style={{ padding: '16px 18px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                    {a.descripcion && <p style={{ margin: '0 0 10px', fontSize: 12.5, color: 'var(--at-ink-2)', lineHeight: 1.45 }}>{a.descripcion}</p>}
                    {/* Datos clave */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 11.5, color: 'var(--at-ink-2)', marginBottom: 10 }}>
                      {a.capacidad_max && <span>👥 Máx <strong>{a.capacidad_max}</strong></span>}
                      {a.horario_inicio && <span>⏰ {a.horario_inicio}–{a.horario_fin}</span>}
                    </div>
                    {/* Badges */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12 }}>
                      {a.requiere_deposito && <span style={pillStyle('var(--at-warning-tint)', 'var(--at-warning-border)', 'var(--at-warning-strong)')}>💰 Dep. {moneda} {a.monto_deposito}</span>}
                      {a.requiere_tarifa && a.tarifa_uso != null && (
                        a.tarifa_uso_finde != null
                          ? <span style={pillStyle('var(--at-primary-tint)', 'var(--at-primary-soft-2)', 'var(--at-primary-hover)')}>🎟 L–V {moneda} {Number(a.tarifa_uso).toFixed(0)} · S–D {moneda} {Number(a.tarifa_uso_finde).toFixed(0)}</span>
                          : <span style={pillStyle('var(--at-primary-tint)', 'var(--at-primary-soft-2)', 'var(--at-primary-hover)')}>🎟 {moneda} {Number(a.tarifa_uso).toFixed(2)}</span>
                      )}
                      {a.max_reservas_mes_unidad != null && <span style={pillStyle('var(--at-primary-tint)', 'var(--at-primary-soft-2)', 'var(--at-primary-hover)')}>📅 Máx {a.max_reservas_mes_unidad}/mes</span>}
                      {a.horas_minimas_antelacion != null && a.horas_minimas_antelacion > 0 && <span style={pillStyle('var(--at-primary-tint)', 'var(--at-primary-soft-2)', 'var(--at-primary-hover)')}>⏱ {a.horas_minimas_antelacion}h</span>}
                      {a.duracion_max_horas != null && <span style={pillStyle('var(--at-primary-tint)', 'var(--at-primary-soft-2)', 'var(--at-primary-hover)')}>⌛ {a.duracion_max_horas}h máx</span>}
                      {((a.minutos_preparacion_previa ?? 0) > 0 || (a.minutos_preparacion_posterior ?? 0) > 0) && (
                        <span style={pillStyle('var(--at-accent-tint-2)', 'var(--at-accent-soft-2)', 'var(--at-accent-dark)')}>🔧 {(a.minutos_preparacion_previa ?? 0) > 0 ? `${a.minutos_preparacion_previa}min prev.` : ''}{(a.minutos_preparacion_previa ?? 0) > 0 && (a.minutos_preparacion_posterior ?? 0) > 0 ? ' · ' : ''}{(a.minutos_preparacion_posterior ?? 0) > 0 ? `${a.minutos_preparacion_posterior}min post.` : ''}</span>
                      )}
                      {a.requiere_aprobacion && <span style={pillStyle('var(--at-warning-tint)', 'var(--at-warning-border)', 'var(--at-warning-strong)')}>👤 Aprobación</span>}
                      {a.reglamento && <span style={pillStyle('var(--at-accent-tint-2)', 'var(--at-accent-soft-2)', 'var(--at-accent-dark)')}>📜 Reglamento</span>}
                    </div>
                    {/* Stats footer */}
                    <div style={{ marginTop: 'auto', paddingTop: 10, borderTop: '1px dashed var(--at-line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <div style={{ fontSize: 11, color: 'var(--at-ink-3)', fontWeight: 600 }}>
                          <strong style={{ color: paleta.color, fontSize: 14 }}>{reservasA.length}</strong> reservas confirmadas
                        </div>
                        {proxima && (
                          <div style={{ fontSize: 10.5, color: 'var(--at-ink-3)' }}>Próxima: {proxima.fecha === hoy ? 'HOY' : formatFechaCalendario(proxima.fecha, { day: '2-digit', month: 'short' }, 'es', '—')} {proxima.hora_inicio}</div>
                        )}
                      </div>
                      {canEdit && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => abrirEdicion(a)} title="Editar amenidad"
                            style={{ padding: '5px 11px', background: editingAmenidad?.id === a.id ? 'var(--at-primary-soft)' : 'var(--at-primary-tint)', color: 'var(--at-primary-hover)', border: `1px solid ${editingAmenidad?.id === a.id ? 'var(--at-primary-mint)' : 'var(--at-primary-soft-2)'}`, borderRadius: 8, cursor: 'pointer', fontSize: 11.5, fontWeight: 700, transition: 'background 0.15s ease' }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--at-primary-soft)' }}
                            onMouseLeave={e => { e.currentTarget.style.background = editingAmenidad?.id === a.id ? 'var(--at-primary-soft)' : 'var(--at-primary-tint)' }}>
                            ✎ Editar
                          </button>
                          <button onClick={() => eliminarAmenidad(a.id)} title="Eliminar amenidad"
                            style={{ padding: '5px 10px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: '1px solid var(--at-danger-border)', borderRadius: 8, cursor: 'pointer', fontSize: 11.5, fontWeight: 700, transition: 'background 0.15s ease' }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--at-danger-tint)' }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'var(--at-danger-tint)' }}>
                            🗑
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )})}
            </div>
          )}
        </>
  )
}
