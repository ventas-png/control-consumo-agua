// Vista "Áreas": el catálogo general de áreas de limpieza y —lo que agrega
// esta fase— a quién le toca cada una.
//
// La asignación tiene dos niveles (ver domain/condominios/limpieza.ts):
// persona concreta, o perfil (turno + cargo) para las áreas que cubre "quien
// esté de turno". La selección múltiple existe porque el caso real es cargar
// 30-40 áreas de una vez y repartirlas por bloques, no una por una.
import { useState, useMemo } from 'react'
import { hoyLocalISO } from '../../../../lib/format'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../../domain/condominios/tabMutations'
import { notify, confirm } from '../../../shared/Dialog'
import type { ProgramacionLimpieza, PersonalCondominio } from '../../../../types'
import { empleadosDeArea, sumarDias } from '../../../../domain/condominios/limpieza'
import { btn, chip, inputStyle, labelStyle, FRECUENCIA_LABEL, TURNO_LABEL, CARGO_LABEL } from './ui'

interface Props {
  programaciones: ProgramacionLimpieza[]
  personal: PersonalCondominio[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const BLANK = {
  area: '', frecuencia: 'semanal', responsable: '', personal_id: '', turno: '', cargo: '',
  orden: '0', requiere_foto: 'true', ultima_ejecucion: '', proxima_ejecucion: '',
  activo: 'true', notas: '',
}

function alerta(p: ProgramacionLimpieza): 'vencida' | 'proxima' | 'ok' | 'sin_fecha' {
  if (!p.proxima_ejecucion) return 'sin_fecha'
  const hoy = hoyLocalISO()
  if (p.proxima_ejecucion < hoy) return 'vencida'
  if (p.proxima_ejecucion <= sumarDias(hoy, 3)) return 'proxima'
  return 'ok'
}

const ALERTA_STYLE = {
  vencida:   { bg: 'var(--at-danger-tint)', border: 'var(--at-danger-border)', badge: 'var(--at-danger)', badgeBg: 'var(--at-danger-tint)', label: 'Vencida' },
  proxima:   { bg: 'var(--at-warning-tint)', border: 'var(--at-warning-border)', badge: 'var(--at-warning-strong)', badgeBg: 'var(--at-warning-tint)', label: 'Próxima' },
  ok:        { bg: 'var(--at-success-tint)', border: 'var(--at-success-border)', badge: 'var(--at-success)', badgeBg: 'var(--at-success-tint)', label: 'Al día' },
  sin_fecha: { bg: 'var(--at-surface-2)', border: 'var(--at-line)', badge: 'var(--at-ink-3)', badgeBg: 'var(--at-chip)', label: 'Sin fecha' },
}

export function VistaAreas({ programaciones, personal, proyectoId, companyId, canCreate, canEdit, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, string>>({ ...BLANK })
  const [filterFrecuencia, setFilterFrecuencia] = useState('')
  const [filterActivo, setFilterActivo] = useState<'activas' | 'inactivas' | ''>('')
  const [filterAsignacion, setFilterAsignacion] = useState('')
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [bloque, setBloque] = useState({ personal_id: '', turno: '', cargo: '' })
  const [saving, setSaving] = useState(false)

  const setF = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  const disponibles = useMemo(
    () => personal.filter(p => p.estado === 'activo').sort((a, b) => a.nombre.localeCompare(b.nombre)),
    [personal],
  )
  const nombrePersonal = useMemo(
    () => new Map(personal.map(p => [p.id, p.nombre])),
    [personal],
  )

  const openNew = () => { setForm({ ...BLANK }); setEditId(null); setShowForm(true) }
  const openEdit = (p: ProgramacionLimpieza) => {
    setForm({
      area: p.area, frecuencia: p.frecuencia, responsable: p.responsable ?? '',
      personal_id: p.personal_id ?? '', turno: p.turno ?? '', cargo: p.cargo ?? '',
      orden: String(p.orden ?? 0), requiere_foto: String(p.requiere_foto ?? true),
      ultima_ejecucion: p.ultima_ejecucion ?? '', proxima_ejecucion: p.proxima_ejecucion ?? '',
      activo: String(p.activo), notas: p.notas ?? '',
    })
    setEditId(p.id); setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.area.trim()) return notify({ variant: 'warning', title: 'Campo requerido', text: 'El área es obligatoria.' })
    setSaving(true)
    const payload = {
      company_id: companyId, project_id: proyectoId,
      area: form.area.trim(), frecuencia: form.frecuencia,
      responsable: form.responsable.trim() || null,
      personal_id: form.personal_id || null,
      turno: form.turno || null,
      cargo: form.cargo || null,
      orden: Number(form.orden) || 0,
      requiere_foto: form.requiere_foto === 'true',
      ultima_ejecucion: form.ultima_ejecucion || null,
      proxima_ejecucion: form.proxima_ejecucion || null,
      activo: form.activo === 'true',
      notas: form.notas.trim() || null,
    }
    const { error } = editId
      ? await updateCondominioRow('programacion_limpieza', editId, payload)
      : await createCondominioRow('programacion_limpieza', payload)
    setSaving(false)
    if (error) return notify({ variant: 'error', title: 'Error', text: error.message })
    setShowForm(false); onRefresh()
  }

  const toggleActivo = async (p: ProgramacionLimpieza) => {
    await updateCondominioRow('programacion_limpieza', p.id, { activo: !p.activo })
    onRefresh()
  }

  const handleDelete = async (p: ProgramacionLimpieza) => {
    const r = await confirm({ title: '¿Eliminar área?', text: `${p.area} — se borra también su historial de ejecuciones.`, icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    await deleteCondominioRow('programacion_limpieza', p.id)
    setSeleccion(s => { const n = new Set(s); n.delete(p.id); return n })
    onRefresh()
  }

  // ── Asignación en bloque ──────────────────────────────────────────────────
  const toggleSel = (id: string) =>
    setSeleccion(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const aplicarBloque = async (limpiar: boolean) => {
    if (seleccion.size === 0) return
    if (!limpiar && !bloque.personal_id && !bloque.turno && !bloque.cargo) {
      return notify({ variant: 'warning', title: 'Falta la asignación', text: 'Elegí un empleado, o un turno/cargo que cubra las áreas.' })
    }
    const patch = limpiar
      ? { personal_id: null, turno: null, cargo: null }
      : {
          personal_id: bloque.personal_id || null,
          turno: bloque.turno || null,
          cargo: bloque.cargo || null,
        }
    setSaving(true)
    // Se actualiza fila por fila (no hay update-por-lista en el helper genérico)
    // y se corta al primer error: dejar la mitad aplicada sin avisar sería peor
    // que no aplicar nada visible.
    for (const id of seleccion) {
      const { error } = await updateCondominioRow('programacion_limpieza', id, patch)
      if (error) {
        setSaving(false)
        notify({ variant: 'error', title: 'Error', text: error.message })
        onRefresh()
        return
      }
    }
    setSaving(false)
    setSeleccion(new Set())
    setBloque({ personal_id: '', turno: '', cargo: '' })
    onRefresh()
  }

  // ── Filtrado ──────────────────────────────────────────────────────────────
  const filtered = programaciones.filter(p => {
    if (filterFrecuencia && p.frecuencia !== filterFrecuencia) return false
    if (filterActivo === 'activas' && !p.activo) return false
    if (filterActivo === 'inactivas' && p.activo) return false
    if (filterAsignacion === 'sin_asignar') return !p.personal_id && !p.turno && !p.cargo
    if (filterAsignacion === 'por_perfil') return !p.personal_id && Boolean(p.turno || p.cargo)
    if (filterAsignacion && filterAsignacion !== 'sin_asignar' && filterAsignacion !== 'por_perfil') {
      return p.personal_id === filterAsignacion
    }
    return true
  })

  const ordenadas = [...filtered].sort(
    (a, b) => (a.orden ?? 0) - (b.orden ?? 0) || a.area.localeCompare(b.area),
  )

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        {canCreate && <button onClick={openNew} style={btn('var(--at-primary)', 'white')}>+ Nueva área</button>}
        <select value={filterFrecuencia} onChange={e => setFilterFrecuencia(e.target.value)} style={{ ...inputStyle, width: '160px' }}>
          <option value="">Todas las frecuencias</option>
          {Object.entries(FRECUENCIA_LABEL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={filterActivo} onChange={e => setFilterActivo(e.target.value as '' | 'activas' | 'inactivas')} style={{ ...inputStyle, width: '130px' }}>
          <option value="">Todas</option>
          <option value="activas">Activas</option>
          <option value="inactivas">Inactivas</option>
        </select>
        <select value={filterAsignacion} onChange={e => setFilterAsignacion(e.target.value)} style={{ ...inputStyle, width: '200px' }}>
          <option value="">Toda asignación</option>
          <option value="sin_asignar">Sin asignar</option>
          <option value="por_perfil">Por turno / cargo</option>
          {disponibles.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
        </select>
        {canEdit && ordenadas.length > 0 && (
          <button
            onClick={() => setSeleccion(s => s.size === ordenadas.length ? new Set() : new Set(ordenadas.map(p => p.id)))}
            style={btn('var(--at-chip)', 'var(--at-ink-2)')}
          >
            {seleccion.size === ordenadas.length ? 'Quitar selección' : 'Seleccionar todas'}
          </button>
        )}
      </div>

      {/* Barra de asignación en bloque */}
      {canEdit && seleccion.size > 0 && (
        <div style={{ background: 'var(--at-primary-soft)', border: '1.5px solid var(--at-primary)', borderRadius: '12px', padding: '14px', marginBottom: '18px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--at-primary-hover)', marginBottom: '10px' }}>
            🧭 Asignar {seleccion.size} {seleccion.size === 1 ? 'área' : 'áreas'} como ruta
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: '10px', marginBottom: '10px' }}>
            <div>
              <label style={labelStyle}>Empleado</label>
              <select style={inputStyle} value={bloque.personal_id} onChange={e => setBloque(b => ({ ...b, personal_id: e.target.value }))}>
                <option value="">— Sin empleado fijo —</option>
                {disponibles.map(e => (
                  <option key={e.id} value={e.id}>{e.nombre} · {CARGO_LABEL[e.cargo] ?? e.cargo}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Turno</label>
              <select style={inputStyle} value={bloque.turno} onChange={e => setBloque(b => ({ ...b, turno: e.target.value }))}>
                <option value="">Cualquier turno</option>
                {Object.entries(TURNO_LABEL).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Cargo</label>
              <select style={inputStyle} value={bloque.cargo} onChange={e => setBloque(b => ({ ...b, cargo: e.target.value }))}>
                <option value="">Cualquier cargo</option>
                {Object.entries(CARGO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button disabled={saving} onClick={() => aplicarBloque(false)} style={btn('var(--at-primary)', 'white')}>
              {saving ? 'Aplicando…' : 'Aplicar asignación'}
            </button>
            <button disabled={saving} onClick={() => aplicarBloque(true)} style={btn('var(--at-danger-tint)', 'var(--at-danger)')}>
              Quitar asignación
            </button>
            <button onClick={() => setSeleccion(new Set())} style={btn('var(--at-chip)', 'var(--at-ink-2)')}>Cancelar</button>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '8px' }}>
            Con empleado, el área es de esa persona. Sin empleado, la cubre quien coincida con el turno y el cargo elegidos.
          </div>
        </div>
      )}

      {/* Formulario */}
      {showForm && (
        <div style={{ background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: '14px', fontWeight: 700 }}>{editId ? 'Editar área' : 'Nueva área de limpieza'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px', marginBottom: '12px' }}>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={labelStyle}>Área *</label>
              <input style={inputStyle} value={form.area} onChange={e => setF('area', e.target.value)} placeholder="Ej. Piscina, Lobby, Gimnasio" autoFocus />
            </div>
            <div>
              <label style={labelStyle}>Frecuencia</label>
              <select style={inputStyle} value={form.frecuencia} onChange={e => setF('frecuencia', e.target.value)}>
                {Object.entries(FRECUENCIA_LABEL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Empleado asignado</label>
              <select style={inputStyle} value={form.personal_id} onChange={e => setF('personal_id', e.target.value)}>
                <option value="">— Sin empleado fijo —</option>
                {disponibles.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Turno</label>
              <select style={inputStyle} value={form.turno} onChange={e => setF('turno', e.target.value)}>
                <option value="">Cualquier turno</option>
                {Object.entries(TURNO_LABEL).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Cargo</label>
              <select style={inputStyle} value={form.cargo} onChange={e => setF('cargo', e.target.value)}>
                <option value="">Cualquier cargo</option>
                {Object.entries(CARGO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Orden en la ruta</label>
              <input style={inputStyle} type="number" min={0} value={form.orden} onChange={e => setF('orden', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Evidencia fotográfica</label>
              <select style={inputStyle} value={form.requiere_foto} onChange={e => setF('requiere_foto', e.target.value)}>
                <option value="true">Obligatoria para cerrar</option>
                <option value="false">Opcional</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Responsable externo</label>
              <input style={inputStyle} value={form.responsable} onChange={e => setF('responsable', e.target.value)} placeholder="Empresa contratada (opcional)" />
            </div>
            <div>
              <label style={labelStyle}>Última ejecución</label>
              <input style={inputStyle} type="date" value={form.ultima_ejecucion} onChange={e => setF('ultima_ejecucion', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Próxima ejecución</label>
              <input style={inputStyle} type="date" value={form.proxima_ejecucion} onChange={e => setF('proxima_ejecucion', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Estado</label>
              <select style={inputStyle} value={form.activo} onChange={e => setF('activo', e.target.value)}>
                <option value="true">Activa</option>
                <option value="false">Inactiva</option>
              </select>
            </div>
            <div style={{ gridColumn: 'span 2' }}>
              <label style={labelStyle}>Notas</label>
              <input style={inputStyle} value={form.notas} onChange={e => setF('notas', e.target.value)} placeholder="Instrucciones especiales, productos, etc." />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={handleSave} disabled={saving} style={btn('var(--at-primary)', 'white')}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button onClick={() => setShowForm(false)} style={btn('var(--at-chip)', 'var(--at-ink-2)')}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Tarjetas */}
      {ordenadas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '36px', marginBottom: '8px' }}>🧹</div>
          <p style={{ fontWeight: 600, color: 'var(--at-ink-3)' }}>Sin áreas de limpieza programadas</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: '14px' }}>
          {ordenadas.map(p => {
            const al = ALERTA_STYLE[alerta(p)]
            const fr = FRECUENCIA_LABEL[p.frecuencia] ?? FRECUENCIA_LABEL.semanal
            const seleccionada = seleccion.has(p.id)
            const cubren = p.personal_id ? [] : empleadosDeArea(p, personal)
            return (
              <div key={p.id} style={{
                background: p.activo ? al.bg : 'var(--at-surface-2)',
                border: `${seleccionada ? '2.5px' : '1.5px'} solid ${seleccionada ? 'var(--at-primary)' : (p.activo ? al.border : 'var(--at-line)')}`,
                borderRadius: '12px', padding: '16px', opacity: p.activo ? 1 : 0.6,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px', gap: '8px' }}>
                  <label style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', flex: 1, cursor: canEdit ? 'pointer' : 'default' }}>
                    {canEdit && (
                      <input
                        type="checkbox"
                        checked={seleccionada}
                        onChange={() => toggleSel(p.id)}
                        aria-label={`Seleccionar ${p.area}`}
                        style={{ marginTop: '3px', cursor: 'pointer' }}
                      />
                    )}
                    <span>
                      <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>🧹 {p.area}</span>
                      <span style={{ display: 'block', fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                        {p.personal_id
                          ? `👤 ${nombrePersonal.get(p.personal_id) ?? 'Empleado dado de baja'}`
                          : p.responsable
                            ? `🏢 ${p.responsable}`
                            : cubren.length > 0
                              ? `👥 ${cubren.length === 1 ? cubren[0].nombre : `${cubren.length} empleados del perfil`}`
                              : '— Sin asignar —'}
                      </span>
                    </span>
                  </label>
                  <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                    {canEdit && <button onClick={() => openEdit(p)} aria-label={`Editar ${p.area}`} style={{ padding: '4px 8px', background: 'var(--at-chip)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>✏️</button>}
                    {canEdit && <button onClick={() => handleDelete(p)} aria-label={`Eliminar ${p.area}`} style={{ padding: '4px 8px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', color: 'var(--at-danger)' }}>🗑</button>}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
                  <span style={chip(fr.bg, fr.color)}>{fr.label}</span>
                  {p.turno && <span style={chip('var(--at-chip)', 'var(--at-ink-2)')}>{TURNO_LABEL[p.turno].icon} {TURNO_LABEL[p.turno].label}</span>}
                  {p.cargo && <span style={chip('var(--at-chip)', 'var(--at-ink-2)')}>{CARGO_LABEL[p.cargo]}</span>}
                  {p.requiere_foto !== false && <span style={chip('var(--at-accent-tint)', 'var(--at-accent-hover)')}>📸 Foto</span>}
                  {p.activo
                    ? <span style={chip(al.badgeBg, al.badge)}>{al.label}</span>
                    : <span style={chip('var(--at-chip)', 'var(--at-ink-3)')}>Inactiva</span>}
                </div>

                <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginBottom: '10px' }}>
                  <div>Última: {p.ultima_ejecucion ?? '—'}</div>
                  <div style={{ color: alerta(p) === 'vencida' ? 'var(--at-danger)' : 'var(--at-ink-3)', fontWeight: alerta(p) === 'vencida' ? 700 : 400 }}>
                    Próxima: {p.proxima_ejecucion ?? '—'}
                  </div>
                </div>

                {canEdit && (
                  <button
                    onClick={() => toggleActivo(p)}
                    style={p.activo
                      ? btn('var(--at-danger-tint)', 'var(--at-danger)', { width: '100%', padding: '6px', fontSize: '12px' })
                      : btn('var(--at-success-tint)', 'var(--at-success)', { width: '100%', padding: '6px', fontSize: '12px' })}
                  >
                    {p.activo ? '⏸ Desactivar' : '▶ Activar'}
                  </button>
                )}
                {p.notas && <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '8px' }}>{p.notas}</div>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
