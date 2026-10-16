// Panel de UN catálogo de Recursos Humanos (cargos o tipos de turno) del
// condominio: `rrhh_cargos` / `rrhh_tipos_turno` (20261031000300). Lo monta el
// tab «Configuración» (RrhhConfiguracionTab) dos veces, parametrizado.
//
// Reglas que la pantalla hace visibles (la BD las respalda):
//   · el código se propone desde el nombre y SÓLO se edita al crear: es la clave
//     que guardan las fichas del personal, las actividades y las programaciones
//     (RRHH_CATALOGO_INMUTABLE en la BD);
//   · desactivar es la baja recomendada: deja de ofrecerse en los selects y las
//     filas que lo tienen siguen válidas;
//   · borrar sólo si nadie lo usa: la tarjeta muestra «en uso: N» (rrhh_*_en_uso)
//     y oculta el botón cuando N > 0; si aun así la BD lo rechaza (23503), se
//     muestra el motivo;
//   · duplicados por código o por nombre normalizado se avisan antes de guardar
//     (la BD también los rechaza: 23505).
import { useState, type CSSProperties } from 'react'
import { notify, confirm } from '../shared/Dialog'
import { EmptyState } from '../shared/EmptyState'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../domain/condominios/tabMutations'
import {
  TABLA_CARGOS, TABLA_TURNOS, ICONOS_CARGO, ICONOS_TURNO, NOMBRE_MAX,
  slugDesdeNombre, ordenarCatalogo, validarEntradaCatalogo, mensajeErrorCatalogo,
} from '../../domain/condominios/rrhhCatalogos'
import type { CatalogoRrhhItem, UsoCargo, UsoTurno } from '../../types'

export type TipoCatalogoRrhh = 'cargo' | 'turno'

interface Props {
  tipo: TipoCatalogoRrhh
  items: CatalogoRrhhItem[]
  /** «En uso» por código; undefined = aún no se sabe (se ofrece borrar y decide la BD). */
  uso: Map<string, UsoCargo | UsoTurno>
  proyectoId: string
  companyId: string
  canCreate: boolean
  canEdit: boolean
  /** Permiso de BORRADO (.delete del tab), independiente de canEdit. */
  canDelete: boolean
  onRefresh: () => void
}

const TEXTO: Record<TipoCatalogoRrhh, {
  tabla: string; singular: string; plural: string; articulo: string; iconos: string[]; iconoDefecto: string
  ejemplo: string; vacio: string; usoDe: (u: UsoCargo | UsoTurno) => string
}> = {
  cargo: {
    tabla: TABLA_CARGOS, singular: 'cargo', plural: 'cargos', articulo: 'el', iconos: ICONOS_CARGO, iconoDefecto: '👤',
    ejemplo: 'Ej. Supervisor de piscina, Recepcionista…',
    vacio: 'Crea los cargos del condominio: son los que se asignan a cada empleado y los que agrupan las actividades.',
    usoDe: (u) => {
      const c = u as UsoCargo
      return [`${c.personal} empleado(s)`, `${c.actividades} actividad(es)`, `${c.programaciones} programación(es)`].join(' · ')
    },
  },
  turno: {
    tabla: TABLA_TURNOS, singular: 'tipo de turno', plural: 'tipos de turno', articulo: 'el', iconos: ICONOS_TURNO, iconoDefecto: '☀️',
    ejemplo: 'Ej. Fin de semana, Madrugada…',
    vacio: 'Crea los tipos de turno del expediente del empleado (diurno, nocturno…). No son las jornadas de Asignación de turnos.',
    usoDe: (u) => {
      const t = u as UsoTurno
      return [`${t.personal} empleado(s)`, `${t.programaciones} programación(es)`, `${t.ejecuciones} ejecución(es)`].join(' · ')
    },
  },
}

export function totalUso(u: UsoCargo | UsoTurno | undefined): number | undefined {
  if (!u) return undefined
  return Object.values(u).reduce((s, n) => s + (Number(n) || 0), 0)
}

interface Form { codigo: string; codigoManual: boolean; nombre: string; descripcion: string; icono: string; orden: number; activo: boolean }

const inputStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '9px 12px',
  border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px',
  background: 'var(--at-surface-2)',
}
const labelStyle: CSSProperties = {
  fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px',
}

export function CatalogoRrhhPanel({ tipo, items, uso, proyectoId, companyId, canCreate, canEdit, canDelete, onRefresh }: Props) {
  const t = TEXTO[tipo]
  const blank = (): Form => ({ codigo: '', codigoManual: false, nombre: '', descripcion: '', icono: t.iconoDefecto, orden: (items.length + 1) * 10, activo: true })
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Form>(blank)

  function startEdit(i: CatalogoRrhhItem) {
    setEditId(i.id)
    setForm({ codigo: i.codigo, codigoManual: true, nombre: i.nombre, descripcion: i.descripcion ?? '', icono: i.icono, orden: i.orden, activo: i.activo })
    setShowForm(true)
  }
  function resetForm() { setForm(blank()); setEditId(null); setShowForm(false) }

  function setNombre(nombre: string) {
    setForm(f => ({ ...f, nombre, codigo: editId || f.codigoManual ? f.codigo : slugDesdeNombre(nombre) }))
  }

  async function save() {
    const codigo = form.codigo.trim().toLowerCase()
    const problema = validarEntradaCatalogo({ codigo, nombre: form.nombre, orden: form.orden }, items, editId ?? undefined)
    if (problema) { notify({ variant: 'error', title: `Revisa ${t.articulo} ${t.singular}`, text: problema }); return }
    setSaving(true)
    const base = {
      nombre: form.nombre.trim(),
      descripcion: form.descripcion.trim() || null,
      icono: form.icono || t.iconoDefecto,
      orden: form.orden,
      activo: form.activo,
    }
    const { error } = editId
      ? await updateCondominioRow(t.tabla, editId, base)
      : await createCondominioRow(t.tabla, { ...base, codigo, company_id: companyId, project_id: proyectoId })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'No se guardó', text: mensajeErrorCatalogo(error, tipo) }); return }
    resetForm(); onRefresh()
  }

  async function toggleActivo(i: CatalogoRrhhItem) {
    const { error } = await updateCondominioRow(t.tabla, i.id, { activo: !i.activo })
    if (error) { notify({ variant: 'error', title: 'No se cambió', text: mensajeErrorCatalogo(error, tipo) }); return }
    onRefresh()
  }

  async function handleDelete(i: CatalogoRrhhItem) {
    const r = await confirm({
      title: `¿Eliminar ${t.articulo} ${t.singular}?`,
      text: `${i.nombre} (${i.codigo}) — sólo se puede eliminar si ningún empleado, actividad ni programación lo usa. Si está en uso, desactívalo.`,
      icon: 'warning', variant: 'danger', confirmText: 'Eliminar',
    })
    if (!r.isConfirmed) return
    const { error } = await deleteCondominioRow(t.tabla, i.id)
    if (error) {
      notify({ variant: 'error', title: `${i.nombre} está en uso`, text: mensajeErrorCatalogo(error, tipo) })
      return
    }
    onRefresh()
  }

  const ordenados = ordenarCatalogo(items)

  return (
    <div>
      {canCreate && !showForm && (
        <div style={{ marginBottom: '14px' }}>
          <button onClick={() => { resetForm(); setShowForm(true) }}
            style={{ padding: '9px 16px', background: 'linear-gradient(135deg,var(--at-accent),var(--at-accent-hover))', color: 'white', border: 'none', borderRadius: '9px', fontWeight: 600, cursor: 'pointer', fontSize: '13.5px' }}>
            + Nuevo {t.singular}
          </button>
        </div>
      )}

      {showForm && (
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>{editId ? `Editar ${t.singular}` : `Nuevo ${t.singular}`}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <label style={labelStyle} htmlFor={`rrhh-${tipo}-nombre`}>Nombre *</label>
              <input id={`rrhh-${tipo}-nombre`} value={form.nombre} maxLength={NOMBRE_MAX} onChange={e => setNombre(e.target.value)} placeholder={t.ejemplo} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle} htmlFor={`rrhh-${tipo}-codigo`}>Código {editId ? '(no se cambia)' : '*'}</label>
              <input id={`rrhh-${tipo}-codigo`} value={form.codigo} readOnly={Boolean(editId)}
                onChange={e => setForm(f => ({ ...f, codigo: e.target.value.toLowerCase(), codigoManual: true }))}
                placeholder="se propone desde el nombre" style={{ ...inputStyle, fontFamily: 'monospace', opacity: editId ? 0.7 : 1 }} />
              <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '4px' }}>
                {editId
                  ? 'Es la clave que guardan las fichas, actividades y programaciones: para cambiarla crea otro y desactiva este.'
                  : 'Minúsculas, números y guion bajo. Una vez creado no se cambia.'}
              </div>
            </div>
            <div>
              <label style={labelStyle}>Ícono</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '8px', background: 'var(--at-surface-2)', borderRadius: '8px', border: '1.5px solid var(--at-line)' }}>
                {t.iconos.map(ic => (
                  <button key={ic} type="button" onClick={() => setForm(f => ({ ...f, icono: ic }))} aria-label={`Ícono ${ic}`}
                    style={{ width: '36px', height: '36px', fontSize: '20px', borderRadius: '8px', border: '2px solid', borderColor: form.icono === ic ? 'var(--at-accent)' : 'transparent', background: form.icono === ic ? 'var(--at-accent-tint)' : 'transparent', cursor: 'pointer' }}>
                    {ic}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <label style={labelStyle} htmlFor={`rrhh-${tipo}-orden`}>Orden</label>
                <input id={`rrhh-${tipo}-orden`} type="number" value={form.orden} onChange={e => setForm(f => ({ ...f, orden: parseInt(e.target.value) || 0 }))} min={0} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle} htmlFor={`rrhh-${tipo}-estado`}>Estado</label>
                <select id={`rrhh-${tipo}-estado`} value={String(form.activo)} onChange={e => setForm(f => ({ ...f, activo: e.target.value === 'true' }))} style={inputStyle}>
                  <option value="true">Activo</option>
                  <option value="false">Inactivo</option>
                </select>
              </div>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle} htmlFor={`rrhh-${tipo}-descripcion`}>Descripción</label>
              <input id={`rrhh-${tipo}-descripcion`} value={form.descripcion} maxLength={300} onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))} placeholder="Descripción opcional…" style={inputStyle} />
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

      {ordenados.length === 0 ? (
        <EmptyState icon={tipo === 'cargo' ? '🧑‍💼' : '🕐'} title={`Sin ${t.plural} definidos`} description={t.vacio} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: '12px' }}>
          {ordenados.map(i => {
            const u = uso.get(i.codigo)
            const n = totalUso(u)
            return (
              <div key={i.id} data-testid={`rrhh-${tipo}-${i.codigo}`} style={{ background: 'var(--at-surface)', border: `1.5px solid ${i.activo ? 'var(--at-line)' : 'var(--at-chip)'}`, borderRadius: '14px', padding: '16px', opacity: i.activo ? 1 : 0.55 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                  <span style={{ fontSize: '28px', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--at-accent-tint-2)', borderRadius: '10px' }}>{i.icono}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.nombre}</div>
                    <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', fontFamily: 'monospace' }}>{i.codigo}</div>
                    <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)' }}>
                      Orden: {i.orden} · {i.activo ? 'Activo' : 'Inactivo'}{n != null ? ` · en uso: ${n}` : ''}
                    </div>
                  </div>
                </div>
                {i.descripcion && <p style={{ margin: '0 0 8px', fontSize: '12.5px', color: 'var(--at-ink-3)' }}>{i.descripcion}</p>}
                {u && n != null && n > 0 && <p style={{ margin: '0 0 10px', fontSize: '11.5px', color: 'var(--at-ink-3)' }} title={t.usoDe(u)}>{t.usoDe(u)}</p>}
                {canEdit && (
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button onClick={() => startEdit(i)} aria-label={`Editar ${i.nombre}`} style={{ flex: 1, padding: '6px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', color: 'var(--at-ink-2)', fontWeight: 600 }}>✏️ Editar</button>
                    <button onClick={() => toggleActivo(i)} aria-label={`${i.activo ? 'Desactivar' : 'Activar'} ${i.nombre}`} style={{ padding: '6px 10px', background: i.activo ? 'var(--at-warning-tint)' : 'var(--at-success-tint)', border: `1px solid ${i.activo ? 'var(--at-warning-border)' : 'var(--at-success-border)'}`, borderRadius: '7px', cursor: 'pointer', fontSize: '12px', color: i.activo ? 'var(--at-warning-strong)' : 'var(--at-success)', fontWeight: 600 }}>
                      {i.activo ? 'Desactivar' : 'Activar'}
                    </button>
                    {canDelete && (n == null || n === 0) && (
                      <button onClick={() => handleDelete(i)} aria-label={`Eliminar ${i.nombre}`} style={{ padding: '6px 10px', background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', borderRadius: '7px', cursor: 'pointer', fontSize: '13px', color: 'var(--at-danger)' }}>🗑</button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
