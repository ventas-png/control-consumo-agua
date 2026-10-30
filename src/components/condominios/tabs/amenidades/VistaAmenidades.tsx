// Vista extraída de AmenidadesTab (fase B). Las tarjetas son el JSX original;
// crear y editar viven en una ventana (FormularioAmenidad dentro de EditModal).
import type { AmenidadesCtx } from './ctx'
import { pillStyle, RESERVA_CAL_COLORS } from './ui'
import { EditModal } from '../../../shared/EditModal'
import { Button } from '../../../shared/Button'
import { EmptyState } from './comunes'
import { formatFechaCalendario } from '../../../../lib/format'
import { FormularioAmenidad } from './FormularioAmenidad'

export function VistaAmenidades({ ctx }: { ctx: AmenidadesCtx }) {
  const { amenidades, reservas, moneda, inventario, prestamos, amenidadInventario, canCreate, canEdit, canDelete, showAmenidadForm, setShowAmenidadForm, saving, amenidadFotoUrl, setAmenidadFotoUrl, amenidadForm, setAmenidadForm, editingAmenidad, setEditingAmenidad, editAmenidadFotoUrl, setEditAmenidadFotoUrl, editAmenidadForm, setEditAmenidadForm, savingEdit, hoy, amenidadFotoUrls, guardarAmenidad, guardarEdicion, toggleAmenidad, eliminarAmenidad, abrirEdicion } = ctx
  return (
        <>
          {/* Nueva amenidad en ventana (20261118000000): antes el formulario se
              desplegaba encima de las tarjetas y había que hacer scroll. */}
          {showAmenidadForm && (
            <EditModal
              title="Nueva amenidad"
              subtitle="Nombre, horario, capacidad, depósito, tarifa, reglas de reserva y el equipo que se presta con ella."
              maxWidth="900px"
              fullScreenOnMobile
              closeOnBackdropClick={!saving}
              closeOnEscape={!saving}
              onClose={() => { if (!saving) setShowAmenidadForm(false) }}
              footer={<>
                <Button variant="secondary" onClick={() => setShowAmenidadForm(false)} disabled={saving}>Cancelar</Button>
                <Button onClick={() => { void guardarAmenidad() }} loading={saving} loadingText="Guardando...">Guardar</Button>
              </>}
            >
              <FormularioAmenidad form={amenidadForm} setForm={setAmenidadForm} fotoUrl={amenidadFotoUrl} setFotoUrl={setAmenidadFotoUrl} moneda={moneda} inventario={inventario} prestamos={prestamos} nueva />
            </EditModal>
          )}
          {/* Edición en la misma ventana */}
          {editingAmenidad && (
            <EditModal
              title="Editar amenidad"
              subtitle={editingAmenidad.nombre}
              maxWidth="900px"
              fullScreenOnMobile
              closeOnBackdropClick={!savingEdit}
              closeOnEscape={!savingEdit}
              onClose={() => { if (!savingEdit) setEditingAmenidad(null) }}
              footer={<>
                <Button variant="secondary" onClick={() => setEditingAmenidad(null)} disabled={savingEdit}>Cancelar</Button>
                <Button onClick={() => { void guardarEdicion() }} loading={savingEdit} loadingText="Guardando...">Guardar cambios</Button>
              </>}
            >
              <FormularioAmenidad form={editAmenidadForm} setForm={setEditAmenidadForm} fotoUrl={editAmenidadFotoUrl} setFotoUrl={setEditAmenidadFotoUrl} moneda={moneda} inventario={inventario} prestamos={prestamos} />
            </EditModal>
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
                      {(() => {
                        const n = amenidadInventario.filter(l => l.amenidad_id === a.id).length
                        return n > 0 ? <span style={pillStyle('var(--at-success-tint)', 'var(--at-success-border)', 'var(--at-success-strong)')}>🪑 {n} equipo{n === 1 ? '' : 's'}</span> : null
                      })()}
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
                      {(canEdit || canDelete) && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          {canEdit && (
                            <button onClick={() => abrirEdicion(a)} title="Editar amenidad"
                              style={{ padding: '5px 11px', background: editingAmenidad?.id === a.id ? 'var(--at-primary-soft)' : 'var(--at-primary-tint)', color: 'var(--at-primary-hover)', border: `1px solid ${editingAmenidad?.id === a.id ? 'var(--at-primary-mint)' : 'var(--at-primary-soft-2)'}`, borderRadius: 8, cursor: 'pointer', fontSize: 11.5, fontWeight: 700, transition: 'background 0.15s ease' }}
                              onMouseEnter={e => { e.currentTarget.style.background = 'var(--at-primary-soft)' }}
                              onMouseLeave={e => { e.currentTarget.style.background = editingAmenidad?.id === a.id ? 'var(--at-primary-soft)' : 'var(--at-primary-tint)' }}>
                              ✎ Editar
                            </button>
                          )}
                          {canDelete && (
                            <button onClick={() => eliminarAmenidad(a.id)} title="Eliminar amenidad" aria-label={`Eliminar ${a.nombre}`}
                              style={{ padding: '5px 10px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: '1px solid var(--at-danger-border)', borderRadius: 8, cursor: 'pointer', fontSize: 11.5, fontWeight: 700, transition: 'background 0.15s ease' }}
                              onMouseEnter={e => { e.currentTarget.style.background = 'var(--at-danger-tint)' }}
                              onMouseLeave={e => { e.currentTarget.style.background = 'var(--at-danger-tint)' }}>
                              🗑
                            </button>
                          )}
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
