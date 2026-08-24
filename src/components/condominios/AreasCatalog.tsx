// Catálogo compartido de áreas del condominio (`areas_condominio`).
//
// Extraído de RutasRondaTab (donde vivía embebido) para que Limpieza y
// cualquier otro consumidor administren EL MISMO catálogo sin duplicar
// formularios, validaciones ni mutaciones. Los permisos los decide el tab
// anfitrión (rutas_ronda en Rondas, prog_limpieza en Limpieza) y se reciben
// por props; la BD los respalda con las policies de 20260904000000.
//
// Diferencias deliberadas con el CRUD original:
//   · el insert manda `activo` (antes dependía del DEFAULT y el form lo perdía),
//   · cada tarjeta puede activarse/desactivarse (la baja recomendada),
//   · borrar maneja el error de FK (23503): las áreas en uso no se borran,
//   · crear/renombrar avisa si el nombre normalizado ya existe (la BD no tiene
//     UNIQUE por los duplicados históricos; esto evita fabricar nuevos).
import { useState, type CSSProperties } from 'react'
import { notify, confirm } from '../shared/Dialog'
import { EmptyState } from '../shared/EmptyState'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../domain/condominios/tabMutations'
import { areaDuplicada } from '../../domain/condominios/areas'
import type { AreaCondominio } from '../../types'

interface Props {
  areas: AreaCondominio[]
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  /**
   * Permiso de BORRADO, independiente de canEdit: la policy de
   * areas_condominio reserva el DELETE a company_owner/admin, así que mostrar
   * el botón a quien solo puede editar produciría un fallo silencioso. Quien
   * no puede borrar conserva Desactivar como alternativa.
   */
  canDelete: boolean
  onRefresh: () => void
}

const ICONOS_PREDEFINIDOS = ['📍', '🚪', '🏊', '🏋️', '🚗', '🌳', '💡', '🔥', '📦', '🛗', '⚡', '💧', '🎭', '📮', '🏥', '🔐', '🧹']

function blankArea(): Omit<AreaCondominio, 'id' | 'company_id' | 'project_id' | 'created_at'> {
  return { nombre: '', descripcion: '', icono: '📍', orden: 0, activo: true }
}

const inputStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '9px 12px',
  border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px',
  background: 'var(--at-surface-2)',
}
const labelStyle: CSSProperties = {
  fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px',
}

export function AreasCatalog({ areas, proyectoId, companyId, canCreate, canEdit, canDelete, onRefresh }: Props) {
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(blankArea())

  function startEdit(a: AreaCondominio) {
    setEditId(a.id)
    setForm({ nombre: a.nombre, descripcion: a.descripcion ?? '', icono: a.icono, orden: a.orden, activo: a.activo })
    setShowForm(true)
  }

  function resetForm() {
    setForm(blankArea()); setEditId(null); setShowForm(false)
  }

  async function save() {
    if (!form.nombre.trim()) {
      notify({ variant: 'error', title: 'Error', text: 'Ingrese el nombre del área.' })
      return
    }
    const duplicada = areaDuplicada(form.nombre, areas, editId ?? undefined)
    if (duplicada) {
      notify({
        variant: 'error', title: 'Área duplicada',
        text: `Ya existe "${duplicada.nombre.trim()}"${duplicada.activo ? '' : ' (inactiva)'} en este condominio. Edítala o reactívala en lugar de crearla de nuevo.`,
      })
      return
    }
    setSaving(true)
    const payload = {
      nombre: form.nombre.trim(),
      descripcion: (form.descripcion ?? '').trim() || null,
      icono: form.icono,
      orden: form.orden,
      activo: form.activo,
    }
    const { error } = editId
      ? await updateCondominioRow('areas_condominio', editId, payload)
      : await createCondominioRow('areas_condominio', { ...payload, company_id: companyId, project_id: proyectoId })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    resetForm(); onRefresh()
  }

  async function toggleActivo(a: AreaCondominio) {
    const { error } = await updateCondominioRow('areas_condominio', a.id, { activo: !a.activo })
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
  }

  async function handleDelete(a: AreaCondominio) {
    const r = await confirm({
      title: '¿Eliminar área?',
      text: `${a.nombre} — solo se puede eliminar si ninguna ruta, plantilla, tarea o programación la usa. Si está en uso, desactívala.`,
      icon: 'warning', variant: 'danger', confirmText: 'Eliminar',
    })
    if (!r.isConfirmed) return
    const { error } = await deleteCondominioRow('areas_condominio', a.id)
    if (error) {
      notify({
        variant: 'error', title: 'El área está en uso',
        text: error.code === '23503'
          ? 'Tiene rutas, plantillas, tareas o programaciones vinculadas. Desactívala en su lugar: los registros históricos la siguen mostrando.'
          : error.message,
      })
      return
    }
    onRefresh()
  }

  const ordenadas = [...areas].sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))

  return (
    <div>
      {canCreate && !showForm && (
        <div style={{ marginBottom: '16px' }}>
          <button onClick={() => { resetForm(); setShowForm(true) }}
            style={{ padding: '9px 16px', background: 'linear-gradient(135deg,var(--at-accent),var(--at-accent-hover))', color: 'white', border: 'none', borderRadius: '9px', fontWeight: 600, cursor: 'pointer', fontSize: '13.5px' }}>
            + Nueva área
          </button>
        </div>
      )}

      {showForm && (
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>{editId ? 'Editar área' : 'Nueva área'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Nombre del área *</label>
              <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Ej. Lobby principal, Estacionamiento B2..." style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Ícono</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '8px', background: 'var(--at-surface-2)', borderRadius: '8px', border: '1.5px solid var(--at-line)' }}>
                {ICONOS_PREDEFINIDOS.map(ic => (
                  <button key={ic} onClick={() => setForm(f => ({ ...f, icono: ic }))}
                    style={{ width: '36px', height: '36px', fontSize: '20px', borderRadius: '8px', border: '2px solid', borderColor: form.icono === ic ? 'var(--at-accent)' : 'transparent', background: form.icono === ic ? 'var(--at-accent-tint)' : 'transparent', cursor: 'pointer' }}>
                    {ic}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={labelStyle}>Orden</label>
                <input type="number" value={form.orden} onChange={e => setForm(f => ({ ...f, orden: parseInt(e.target.value) || 0 }))} min={0} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Estado</label>
                <select value={String(form.activo)} onChange={e => setForm(f => ({ ...f, activo: e.target.value === 'true' }))} style={inputStyle}>
                  <option value="true">Activa</option>
                  <option value="false">Inactiva</option>
                </select>
              </div>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Descripción</label>
              <input value={form.descripcion ?? ''} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Descripción opcional..." style={inputStyle} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button onClick={save} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,var(--at-accent),var(--at-accent-hover))', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando...' : editId ? 'Actualizar' : 'Guardar'}
            </button>
            <button onClick={resetForm} style={{ padding: '10px 20px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}

      {ordenadas.length === 0 ? (
        <EmptyState
          icon="📍"
          title="Sin áreas definidas"
          description="Crea las áreas físicas del condominio: son el catálogo que comparten rondas, plantillas de tarea y limpieza."
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px' }}>
          {ordenadas.map(a => (
            <div key={a.id} style={{ background: 'var(--at-surface)', border: `1.5px solid ${a.activo ? 'var(--at-line)' : 'var(--at-chip)'}`, borderRadius: '14px', padding: '16px', opacity: a.activo ? 1 : 0.55 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                <span style={{ fontSize: '28px', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--at-accent-tint-2)', borderRadius: '10px' }}>{a.icono}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.nombre}</div>
                  <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)' }}>Orden: {a.orden} · {a.activo ? 'Activa' : 'Inactiva'}</div>
                </div>
              </div>
              {a.descripcion && <p style={{ margin: '0 0 10px', fontSize: '12.5px', color: 'var(--at-ink-3)' }}>{a.descripcion}</p>}
              {canEdit && (
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button onClick={() => startEdit(a)} style={{ flex: 1, padding: '6px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', color: 'var(--at-ink-2)', fontWeight: 600 }}>✏️ Editar</button>
                  <button onClick={() => toggleActivo(a)} style={{ padding: '6px 10px', background: a.activo ? 'var(--at-warning-tint)' : 'var(--at-success-tint)', border: `1px solid ${a.activo ? 'var(--at-warning-border)' : 'var(--at-success-border)'}`, borderRadius: '7px', cursor: 'pointer', fontSize: '12px', color: a.activo ? 'var(--at-warning-strong)' : 'var(--at-success)', fontWeight: 600 }}>
                    {a.activo ? 'Desactivar' : 'Activar'}
                  </button>
                  {canDelete && <button onClick={() => handleDelete(a)} aria-label={`Eliminar ${a.nombre}`} style={{ padding: '6px 10px', background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', borderRadius: '7px', cursor: 'pointer', fontSize: '13px', color: 'var(--at-danger)' }}>🗑</button>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
