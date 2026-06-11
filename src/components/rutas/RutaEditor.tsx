// Editor de creación/edición de rutas (P1 #3, extraído de RutasSection con el
// JSX intacto). El estado y los handlers viven en la sección; aquí solo se
// destructura del ctx.
import type { RutasCtx } from './ctx'
import { DIAS_NOMBRE } from '../../lib/rutasReglas'
import { ANTICIPACION_OPCIONES, DIAS_SEMANA, FRECUENCIAS, inputStyle, labelStyle } from './ui'
import type { FrecuenciaRuta } from '../../types'

export function RutaEditor({ ctx }: { ctx: RutasCtx }) {
  const {
    proyectos, editando, form, setForm, tipoRuta, setTipoRuta,
    clientesEnRuta, contadoresEnRuta, setContadoresEnRuta,
    unidadesEnRuta, setUnidadesEnRuta, busqueda, setBusqueda, saving,
    nuevaFecha, setNuevaFecha, usuarios, draggingIdx, setDraggingIdx, dragOver,
    clientesDisponibles, contadoresDisponibles, unidadesDisponibles,
    cancelar, handleProjectChange, handleUsuarioChange, toggleDiaSemana,
    agregarFecha, quitarFecha, toggleCanal,
    agregarCliente, quitarCliente, agregarContador, quitarContador,
    agregarUnidad, quitarUnidad,
    handleDragStart, handleDragOver, handleDrop, handleGuardar,
  } = ctx

  return (
    <div style={{ background: 'var(--at-surface)', borderRadius: '24px', padding: '32px', boxShadow: '0 10px 40px rgba(0,0,0,0.08)' }}>
      <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '24px', borderBottom: '2px solid var(--at-line)', paddingBottom: '12px' }}>
        {editando ? 'Editar Ruta' : 'Nueva Ruta de Lecturas'}
      </div>

      {/* Datos generales */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        <div>
          <label style={labelStyle}>Nombre de la Ruta *</label>
          <input
            style={inputStyle}
            value={form.nombre}
            onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))}
            placeholder="Ej. Zona Norte – Lunes"
          />
        </div>
        <div>
          <label style={labelStyle}>Proyecto *</label>
          <select
            style={inputStyle}
            value={form.project_id}
            onChange={e => handleProjectChange(e.target.value)}
          >
            <option value="">-- Selecciona un proyecto --</option>
            {proyectos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Fecha Programada</label>
          <input
            type="date"
            style={inputStyle}
            value={form.fecha_programada}
            onChange={e => setForm(p => ({ ...p, fecha_programada: e.target.value }))}
          />
        </div>
        <div style={{ gridColumn: '1/-1' }}>
          <label style={labelStyle}>Descripción</label>
          <input
            style={inputStyle}
            value={form.descripcion}
            onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))}
            placeholder="Opcional"
          />
        </div>
      </div>

      {/* Periodicidad y recordatorios */}
      <div style={{ background: 'var(--at-surface-2)', borderRadius: '12px', padding: '20px', marginBottom: '24px', border: '1px solid var(--at-line)' }}>
        <div style={{ fontWeight: 700, marginBottom: '16px', color: 'var(--at-ink-2)' }}>Periodicidad y Recordatorios</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', alignItems: 'start' }}>
          <div>
            <label style={labelStyle}>Frecuencia</label>
            <select
              style={inputStyle}
              value={form.frecuencia}
              onChange={e => setForm(p => ({ ...p, frecuencia: e.target.value as FrecuenciaRuta }))}
            >
              {FRECUENCIAS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Hora (opcional)</label>
            <input
              type="time"
              style={inputStyle}
              value={form.hora_programada}
              onChange={e => setForm(p => ({ ...p, hora_programada: e.target.value }))}
            />
          </div>
        </div>

        {/* Inputs condicionales por frecuencia */}
        {form.frecuencia === 'semanal' && (
          <div style={{ marginTop: '14px' }}>
            <label style={labelStyle}>Días de la semana</label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {DIAS_SEMANA.map(d => {
                const active = form.dias_semana.includes(d.iso)
                return (
                  <button
                    key={d.iso}
                    type="button"
                    onClick={() => toggleDiaSemana(d.iso)}
                    title={DIAS_NOMBRE[d.iso]}
                    style={{
                      width: '38px', height: '38px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '13px',
                      border: active ? 'none' : '2px solid var(--at-line)',
                      background: active ? 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-accent-2) 100%)' : 'var(--at-surface)',
                      color: active ? 'white' : 'var(--at-ink-2)',
                    }}
                  >
                    {d.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {form.frecuencia === 'quincenal' && (
          <div style={{ marginTop: '14px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
            <div>
              <label style={labelStyle}>Cada cuántos días</label>
              <input
                type="number" min={1} style={inputStyle}
                value={form.intervalo_dias}
                onChange={e => setForm(p => ({ ...p, intervalo_dias: e.target.value }))}
              />
            </div>
          </div>
        )}

        {form.frecuencia === 'mensual' && (
          <div style={{ marginTop: '14px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
            <div>
              <label style={labelStyle}>Día del mes (1–31)</label>
              <input
                type="number" min={1} max={31} style={inputStyle}
                value={form.dia_mes}
                onChange={e => setForm(p => ({ ...p, dia_mes: e.target.value }))}
              />
              <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '4px' }}>Si el mes no tiene ese día, se usa el último.</div>
            </div>
          </div>
        )}

        {form.frecuencia === 'fechas' && (
          <div style={{ marginTop: '14px' }}>
            <label style={labelStyle}>Fechas específicas</label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <input type="date" style={{ ...inputStyle, width: 'auto' }} value={nuevaFecha} onChange={e => setNuevaFecha(e.target.value)} />
              <button type="button" onClick={agregarFecha} style={{ padding: '10px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>Agregar</button>
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px' }}>
              {form.fechas_especificas.map(f => (
                <span key={f} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', background: 'var(--at-chip)', borderRadius: '20px', fontSize: '12px', fontWeight: 600 }}>
                  {new Date(f + 'T12:00:00').toLocaleDateString('es-GT')}
                  <button type="button" onClick={() => quitarFecha(f)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--at-danger)', fontWeight: 700 }}>×</button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Ventana de vigencia (solo recurrentes) */}
        {form.frecuencia !== 'unica' && (
          <div style={{ marginTop: '14px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
            <div>
              <label style={labelStyle}>Inicia el{form.frecuencia === 'quincenal' ? ' *' : ''}</label>
              <input type="date" style={inputStyle} value={form.fecha_inicio} onChange={e => setForm(p => ({ ...p, fecha_inicio: e.target.value }))} />
            </div>
            <div>
              <label style={labelStyle}>Termina el (opcional)</label>
              <input type="date" style={inputStyle} value={form.fecha_fin} onChange={e => setForm(p => ({ ...p, fecha_fin: e.target.value }))} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '24px' }}>
              <input id="recurrencia_activa" type="checkbox" checked={form.recurrencia_activa} onChange={e => setForm(p => ({ ...p, recurrencia_activa: e.target.checked }))} style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
              <label htmlFor="recurrencia_activa" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)', cursor: 'pointer' }}>Recurrencia activa</label>
            </div>
          </div>
        )}

        {/* Recordatorios */}
        <div style={{ marginTop: '18px', borderTop: '1px dashed var(--at-line)', paddingTop: '16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', alignItems: 'start' }}>
          <div>
            <label style={labelStyle}>Avisar</label>
            <select
              style={inputStyle}
              value={form.recordatorio_anticipacion_min}
              onChange={e => setForm(p => ({ ...p, recordatorio_anticipacion_min: Number(e.target.value) }))}
            >
              {ANTICIPACION_OPCIONES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Canales del recordatorio</label>
            <div style={{ display: 'flex', gap: '16px', paddingTop: '8px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.recordatorio_canales.includes('email')} onChange={() => toggleCanal('email')} style={{ width: '17px', height: '17px', cursor: 'pointer' }} />
                Email
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.recordatorio_canales.includes('app')} onChange={() => toggleCanal('app')} style={{ width: '17px', height: '17px', cursor: 'pointer' }} />
                Notificación en app
              </label>
            </div>
          </div>
        </div>
        <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '10px' }}>
          Los recordatorios llegan al operador asignado y a los administradores. El envío automático corre cada hora en el servidor.
        </div>
      </div>

      {/* Asignación de operador */}
      <div style={{ background: 'var(--at-surface-2)', borderRadius: '12px', padding: '20px', marginBottom: '24px', border: '1px solid var(--at-line)' }}>
        <div style={{ fontWeight: 700, marginBottom: '16px', color: 'var(--at-ink-2)' }}>Asignar Operador</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
          <div>
            <label style={labelStyle}>Operador</label>
            <select
              style={inputStyle}
              value={form.asignado_a}
              onChange={e => handleUsuarioChange(e.target.value)}
            >
              <option value="">-- Sin asignar --</option>
              {usuarios.map(u => (
                <option key={u.id} value={u.id}>
                  {u.full_name} ({u.role})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Email (para notificación)</label>
            <input
              type="email"
              style={inputStyle}
              value={form.asignado_email}
              onChange={e => setForm(p => ({ ...p, asignado_email: e.target.value }))}
              placeholder="operador@empresa.com"
            />
          </div>
          <div>
            <label style={labelStyle}>Teléfono (para WhatsApp)</label>
            <input
              type="tel"
              style={inputStyle}
              value={form.asignado_telefono}
              onChange={e => setForm(p => ({ ...p, asignado_telefono: e.target.value }))}
              placeholder="55551234"
            />
          </div>
        </div>
      </div>

      {/* Selector de tipo de ruta */}
      <div style={{ marginBottom: '20px' }}>
        <div style={{ fontWeight: 700, marginBottom: '10px', color: 'var(--at-ink-2)', fontSize: '14px' }}>Tipo de Ruta</div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {(['clientes', 'contadores', 'unidades'] as const).map(tipo => {
            const labels = { clientes: 'Por cliente', contadores: 'Por contador', unidades: 'Por unidad' }
            const active = tipoRuta === tipo
            return (
              <button
                key={tipo}
                onClick={() => { setTipoRuta(tipo); setBusqueda('') }}
                style={{
                  padding: '8px 18px',
                  border: active ? 'none' : '2px solid var(--at-line)',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '13px',
                  cursor: 'pointer',
                  background: active ? 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-accent-2) 100%)' : 'var(--at-surface-2)',
                  color: active ? 'white' : 'var(--at-ink-2)',
                  transition: 'all 0.15s',
                }}
              >
                {labels[tipo]}
              </button>
            )
          })}
        </div>
      </div>

      {/* Panel de selección de elementos */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>

        {/* ── MODO CLIENTES ── */}
        {tipoRuta === 'clientes' && (
          <>
            <div>
              <div style={{ fontWeight: 700, marginBottom: '10px', color: 'var(--at-ink-2)' }}>
                Clientes disponibles ({clientesDisponibles.length})
              </div>
              <input
                style={{ ...inputStyle, marginBottom: '10px' }}
                placeholder="Buscar cliente..."
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
              />
              <div style={{ maxHeight: '320px', overflowY: 'auto', border: '2px solid var(--at-line)', borderRadius: '10px' }}>
                {clientesDisponibles.length === 0 && (
                  <div style={{ padding: '16px', color: 'var(--at-ink-3)', textAlign: 'center', fontSize: '13px' }}>
                    {busqueda ? 'Sin resultados' : 'Todos los clientes ya están en la ruta'}
                  </div>
                )}
                {clientesDisponibles.map(c => (
                  <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--at-chip)' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '13px' }}>{c.nombre}</div>
                      <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{c.codigo}</div>
                    </div>
                    <button onClick={() => agregarCliente(c)} style={{ padding: '4px 10px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, fontSize: '16px' }}>+</button>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 700, marginBottom: '10px', color: 'var(--at-ink-2)' }}>
                En esta ruta ({clientesEnRuta.length}) — arrastra para reordenar
              </div>
              <div style={{ maxHeight: '370px', overflowY: 'auto', border: '2px solid var(--at-line)', borderRadius: '10px', minHeight: '60px' }}>
                {clientesEnRuta.length === 0 && (
                  <div style={{ padding: '20px', color: 'var(--at-ink-3)', textAlign: 'center', fontSize: '13px' }}>Agrega clientes desde el panel izquierdo</div>
                )}
                {clientesEnRuta.map((c, idx) => (
                  <div
                    key={c.id}
                    draggable
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={e => handleDragOver(e, idx)}
                    onDrop={handleDrop}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--at-chip)', background: draggingIdx === idx ? 'var(--at-primary-tint)' : 'var(--at-surface)', cursor: 'grab', userSelect: 'none' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ color: 'var(--at-ink-3)', fontSize: '16px' }}>⠿</span>
                      <div>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-primary)', marginRight: '6px' }}>#{idx + 1}</span>
                        <span style={{ fontWeight: 600, fontSize: '13px' }}>{c.nombre}</span>
                        <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{c.codigo}</div>
                      </div>
                    </div>
                    <button onClick={() => quitarCliente(idx)} style={{ padding: '2px 8px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: '1px solid var(--at-danger-border)', borderRadius: '6px', cursor: 'pointer', fontWeight: 700 }}>×</button>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── MODO CONTADORES ── */}
        {tipoRuta === 'contadores' && (
          <>
            <div>
              <div style={{ fontWeight: 700, marginBottom: '10px', color: 'var(--at-ink-2)' }}>
                Contadores disponibles ({contadoresDisponibles.length})
              </div>
              <input
                style={{ ...inputStyle, marginBottom: '10px' }}
                placeholder="Buscar contador..."
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
              />
              <div style={{ maxHeight: '280px', overflowY: 'auto', border: '2px solid var(--at-line)', borderRadius: '10px' }}>
                {contadoresDisponibles.length === 0 && (
                  <div style={{ padding: '16px', color: 'var(--at-ink-3)', textAlign: 'center', fontSize: '13px' }}>
                    {!form.project_id ? 'Selecciona un proyecto primero' : busqueda ? 'Sin resultados' : 'Todos los contadores ya están en la ruta'}
                  </div>
                )}
                {contadoresDisponibles.map(c => {
                  const proyecto = proyectos.find(p => p.id === c.project_id)
                  return (
                    <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--at-chip)' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '13px' }}>{c.numero_serie}</div>
                        <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{proyecto?.nombre ?? ''}{c.descripcion ? ` · ${c.descripcion}` : ''} · {c.tipo_agua}</div>
                      </div>
                      <button onClick={() => agregarContador(c)} style={{ padding: '4px 10px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, fontSize: '16px' }}>+</button>
                    </div>
                  )
                })}
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 700, marginBottom: '10px', color: 'var(--at-ink-2)' }}>
                En esta ruta ({contadoresEnRuta.length}) — arrastra para reordenar
              </div>
              <div style={{ maxHeight: '370px', overflowY: 'auto', border: '2px solid var(--at-line)', borderRadius: '10px', minHeight: '60px' }}>
                {contadoresEnRuta.length === 0 && (
                  <div style={{ padding: '20px', color: 'var(--at-ink-3)', textAlign: 'center', fontSize: '13px' }}>Agrega contadores desde el panel izquierdo</div>
                )}
                {contadoresEnRuta.map((c, idx) => (
                  <div
                    key={c.id}
                    draggable
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={e => handleDragOver(e, idx)}
                    onDrop={() => {
                      if (draggingIdx === null || dragOver.current === null || draggingIdx === dragOver.current) { setDraggingIdx(null); return }
                      setContadoresEnRuta(prev => {
                        const arr = [...prev]
                        const [moved] = arr.splice(draggingIdx, 1)
                        arr.splice(dragOver.current!, 0, moved)
                        return arr
                      })
                      setDraggingIdx(null)
                      dragOver.current = null
                    }}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--at-chip)', background: draggingIdx === idx ? 'var(--at-primary-tint)' : 'var(--at-surface)', cursor: 'grab', userSelect: 'none' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ color: 'var(--at-ink-3)', fontSize: '16px' }}>⠿</span>
                      <div>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-primary)', marginRight: '6px' }}>#{idx + 1}</span>
                        <span style={{ fontWeight: 600, fontSize: '13px' }}>{c.numero_serie}</span>
                        <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{c.tipo_agua}{c.descripcion ? ` · ${c.descripcion}` : ''}</div>
                      </div>
                    </div>
                    <button onClick={() => quitarContador(idx)} style={{ padding: '2px 8px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: '1px solid var(--at-danger-border)', borderRadius: '6px', cursor: 'pointer', fontWeight: 700 }}>×</button>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── MODO UNIDADES ── */}
        {tipoRuta === 'unidades' && (
          <>
            <div>
              <div style={{ fontWeight: 700, marginBottom: '10px', color: 'var(--at-ink-2)' }}>
                Unidades disponibles ({unidadesDisponibles.length})
              </div>
              <input
                style={{ ...inputStyle, marginBottom: '10px' }}
                placeholder="Buscar unidad..."
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
              />
              <div style={{ maxHeight: '280px', overflowY: 'auto', border: '2px solid var(--at-line)', borderRadius: '10px' }}>
                {unidadesDisponibles.length === 0 && (
                  <div style={{ padding: '16px', color: 'var(--at-ink-3)', textAlign: 'center', fontSize: '13px' }}>
                    {!form.project_id ? 'Selecciona un proyecto primero' : busqueda ? 'Sin resultados' : 'Todas las unidades ya están en la ruta'}
                  </div>
                )}
                {unidadesDisponibles.map(u => {
                  const proyecto = proyectos.find(p => p.id === u.project_id)
                  return (
                    <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--at-chip)' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '13px' }}>{u.nombre}</div>
                        <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{proyecto?.nombre ?? ''} · {u.tipo}{u.piso != null ? ` · Piso ${u.piso}` : ''}</div>
                      </div>
                      <button onClick={() => agregarUnidad(u)} style={{ padding: '4px 10px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, fontSize: '16px' }}>+</button>
                    </div>
                  )
                })}
              </div>
            </div>
            <div>
              <div style={{ fontWeight: 700, marginBottom: '10px', color: 'var(--at-ink-2)' }}>
                En esta ruta ({unidadesEnRuta.length}) — arrastra para reordenar
              </div>
              <div style={{ maxHeight: '370px', overflowY: 'auto', border: '2px solid var(--at-line)', borderRadius: '10px', minHeight: '60px' }}>
                {unidadesEnRuta.length === 0 && (
                  <div style={{ padding: '20px', color: 'var(--at-ink-3)', textAlign: 'center', fontSize: '13px' }}>Agrega unidades desde el panel izquierdo</div>
                )}
                {unidadesEnRuta.map((u, idx) => (
                  <div
                    key={u.id}
                    draggable
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={e => handleDragOver(e, idx)}
                    onDrop={() => {
                      if (draggingIdx === null || dragOver.current === null || draggingIdx === dragOver.current) { setDraggingIdx(null); return }
                      setUnidadesEnRuta(prev => {
                        const arr = [...prev]
                        const [moved] = arr.splice(draggingIdx, 1)
                        arr.splice(dragOver.current!, 0, moved)
                        return arr
                      })
                      setDraggingIdx(null)
                      dragOver.current = null
                    }}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--at-chip)', background: draggingIdx === idx ? 'var(--at-primary-tint)' : 'var(--at-surface)', cursor: 'grab', userSelect: 'none' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ color: 'var(--at-ink-3)', fontSize: '16px' }}>⠿</span>
                      <div>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-primary)', marginRight: '6px' }}>#{idx + 1}</span>
                        <span style={{ fontWeight: 600, fontSize: '13px' }}>{u.nombre}</span>
                        <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{u.tipo}{u.piso != null ? ` · Piso ${u.piso}` : ''}</div>
                      </div>
                    </div>
                    <button onClick={() => quitarUnidad(idx)} style={{ padding: '2px 8px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: '1px solid var(--at-danger-border)', borderRadius: '6px', cursor: 'pointer', fontWeight: 700 }}>×</button>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

      </div>

      {/* Botones */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <button
          onClick={() => handleGuardar(false)}
          disabled={saving}
          style={{ padding: '12px 24px', background: 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-accent-2) 100%)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
        >
          {saving ? 'Guardando...' : '💾 Guardar Ruta'}
        </button>
        {(form.asignado_email || form.asignado_telefono) && (
          <button
            onClick={() => handleGuardar(true)}
            disabled={saving}
            style={{ padding: '12px 24px', background: 'linear-gradient(135deg, var(--at-success) 0%, var(--at-success-strong) 100%)', color: 'var(--at-on-status)', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
          >
            {saving ? 'Guardando...' : '💾 Guardar y Notificar'}
          </button>
        )}
        <button
          onClick={cancelar}
          style={{ padding: '12px 24px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}
