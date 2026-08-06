import { Fragment, useState, useEffect, useMemo, useCallback } from 'react'
import {
  fetchPermissionsCatalog,
  fetchRoleById,
  fetchRolePermissionKeys,
  fetchAllRolePermissionKeys,
  updateRole,
  createRole,
  deleteRolePermissions,
  insertRolePermissions,
} from '../../domain/empresa/roles'
import type { PermissionDef, RoleDef } from '../../types'
import { MODULE_ACTIONS, MODULE_ACTION_LABELS, type ModuleAction } from '../../lib/moduleConfig'

// ── Matriz módulo × acción ───────────────────────────────────────────────────
// El catálogo trae claves por acción (agua.<mod>.<action>,
// platform.<mod>.<action>, condominios.tab.<tab>[.<action>] — la clave base de
// tab es la visibilidad/Ver). En vez de una lista plana de 1000+ checkboxes,
// se agrupa cada módulo/tab en una fila con una columna por acción.

// Encabezados compactos por acción; el orden y la membresía vienen de
// MODULE_ACTIONS (fuente única) para que una acción nueva gane columna sola.
const SHORT_ACTION_LABELS: Record<ModuleAction, string> = {
  view: 'Ver', create: 'Crear', edit: 'Editar',
  change_status: 'Estado', approve: 'Autorizar', delete: 'Eliminar',
}
const ACTION_COLUMNS: { action: ModuleAction; short: string }[] =
  MODULE_ACTIONS.map(action => ({ action, short: SHORT_ACTION_LABELS[action] }))

const ACTION_SET = new Set<string>(MODULE_ACTIONS)

interface MatrixRow {
  /** Clave base del módulo/tab (p.ej. condominios.tab.cuotas, agua.cobros). */
  id: string
  label: string
  cells: Partial<Record<ModuleAction, PermissionDef>>
  perms: PermissionDef[]
}

/** Separa una clave del catálogo en (fila, acción). Claves sin sufijo de
 * acción conocida (condominios.tab.<tab>) son la acción Ver de su fila. */
function splitPermissionKey(key: string): { rowId: string; action: ModuleAction } {
  const parts = key.split('.')
  const last = parts[parts.length - 1]
  if (parts.length > 2 && ACTION_SET.has(last)) {
    return { rowId: parts.slice(0, -1).join('.'), action: last as ModuleAction }
  }
  return { rowId: key, action: 'view' }
}

/** Etiqueta de fila: la del permiso Ver sin el prefijo "Acción — ". */
function rowLabel(row: MatrixRow): string {
  const base = row.cells.view?.label ?? row.perms[0]?.label ?? row.id
  return base.replace(/^[^—]+ — /, '')
}

/** Nombre legible de una categoría del catálogo (agua_cobros → Agua — Cobros). */
function categoryLabel(category: string): string {
  const FIXED: Record<string, string> = {
    panel: 'Panel / Dashboard', finanzas: 'Finanzas', residentes: 'Residentes',
    operaciones: 'Operaciones', instalaciones: 'Instalaciones', seguridad: 'Seguridad',
    comunidad: 'Comunidad', administracion: 'Administración', especiales: 'Especiales',
  }
  if (FIXED[category]) return FIXED[category]
  const pretty = (s: string) => s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
  if (category.startsWith('agua_')) return `Agua — ${pretty(category.slice(5))}`
  if (category.startsWith('platform_')) return `Plataforma — ${pretty(category.slice(9))}`
  return pretty(category)
}

interface Props {
  companyId: string
  /** null = create new; uuid = edit existing */
  roleId: string | null
  /** When provided, the new role is pre-populated (name, description, color and
   * permissions) from this role — "duplicar y personalizar" / plantillas. */
  cloneFromRoleId?: string
  /** Semilla directa de permisos (sin rol de origen) — p. ej. "guardar los
   * ajustes individuales como rol reutilizable". */
  initialKeys?: string[]
  /** Nombre sugerido cuando se crea desde initialKeys. */
  suggestedName?: string
  onClose: () => void
  /** Recibe el id del rol creado/editado para que el caller pueda seleccionarlo. */
  onSaved: (savedRoleId: string) => void
}

const PALETTE = ['var(--at-primary)', 'var(--at-accent)', 'var(--at-success)', 'var(--at-warning)', 'var(--at-danger)', 'var(--at-accent-2)', '#ec4899', 'var(--at-ink-3)', 'var(--at-accent)', '#84cc16']

export function CustomRoleEditor({
  companyId, roleId, cloneFromRoleId, initialKeys, suggestedName, onClose, onSaved,
}: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(PALETTE[0])
  const [cloneSourceName, setCloneSourceName] = useState<string | null>(null)
  const [permissions, setPermissions] = useState<PermissionDef[]>([])
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: permsData, error: permsErr } = await fetchPermissionsCatalog()
      if (permsErr) throw new Error(permsErr)
      setPermissions(permsData ?? [])

      if (roleId) {
        const { data: roleData, error: roleErr } = await fetchRoleById(roleId)
        if (roleErr) throw new Error(roleErr)
        const r = roleData as RoleDef
        setName(r.name)
        setDescription(r.description ?? '')
        setColor(r.color ?? PALETTE[0])
        const { data: rpData } = await fetchRolePermissionKeys(roleId)
        setSelectedKeys(new Set((rpData ?? []).map(r => r.permission_key)))
      } else if (cloneFromRoleId) {
        // Clonado: precarga nombre/descripción/color además de los permisos,
        // para partir de la plantilla o rol más cercano en vez de cero.
        const { data: sourceData } = await fetchRoleById(cloneFromRoleId)
        const source = sourceData as RoleDef | null
        if (source) {
          setCloneSourceName(source.name)
          setName(suggestedName ?? `Copia de ${source.name}`)
          setDescription(source.description ?? '')
          setColor(source.color ?? PALETTE[0])
        }
        const { data: rpData } = await fetchRolePermissionKeys(cloneFromRoleId)
        setSelectedKeys(new Set((rpData ?? []).map(r => r.permission_key)))
      } else if (initialKeys && initialKeys.length > 0) {
        // Semilla directa (p. ej. perfil efectivo de un usuario → rol reutilizable).
        setSelectedKeys(new Set(initialKeys))
        if (suggestedName) setName(suggestedName)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error cargando datos.')
    } finally {
      setLoading(false)
    }
    // initialKeys llega como prop estable del caller (estado del padre).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleId, cloneFromRoleId, suggestedName])

  useEffect(() => { void load() }, [load])

  // Matriz base por categoría (solo depende del catálogo, con filas ya
  // ordenadas); la búsqueda filtra filas completas en un memo aparte para no
  // reconstruir las ~1000 filas en cada tecla.
  const baseMatrix = useMemo(() => {
    const rowsById = new Map<string, MatrixRow>()
    const byCategory = new Map<string, MatrixRow[]>()
    for (const p of permissions) {
      const { rowId, action } = splitPermissionKey(p.key)
      let row = rowsById.get(rowId)
      if (!row) {
        row = { id: rowId, label: '', cells: {}, perms: [] }
        rowsById.set(rowId, row)
        const arr = byCategory.get(p.category) ?? []
        arr.push(row)
        byCategory.set(p.category, arr)
      }
      row.cells[action] = p
      row.perms.push(p)
    }
    for (const row of rowsById.values()) row.label = rowLabel(row)
    for (const rows of byCategory.values()) rows.sort((a, b) => a.label.localeCompare(b.label, 'es'))
    return [...byCategory.entries()]
  }, [permissions])

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q.length === 0) return baseMatrix
    const result: Array<[string, MatrixRow[]]> = []
    for (const [category, rows] of baseMatrix) {
      const visible = rows.filter(r =>
        r.label.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        r.perms.some(p => p.label.toLowerCase().includes(q) || p.key.toLowerCase().includes(q)))
      if (visible.length > 0) result.push([category, visible])
    }
    return result
  }, [baseMatrix, search])

  /** Alterna una acción respetando que Ver es prerequisito en runtime:
   * otorgar una acción marca también Ver; quitar Ver desactiva toda la fila. */
  function toggleAction(row: MatrixRow, perm: PermissionDef) {
    setSelectedKeys(prev => {
      const next = new Set(prev)
      const isView = row.cells.view?.key === perm.key
      if (next.has(perm.key)) {
        next.delete(perm.key)
        if (isView) row.perms.forEach(p => next.delete(p.key))
      } else {
        next.add(perm.key)
        if (!isView && row.cells.view) next.add(row.cells.view.key)
      }
      return next
    })
  }

  /** Alterna un conjunto de permisos: si están todos, los quita; si no, los pone. */
  function toggleMany(perms: PermissionDef[]) {
    setSelectedKeys(prev => {
      const next = new Set(prev)
      const allSelected = perms.every(p => next.has(p.key))
      if (allSelected) perms.forEach(p => next.delete(p.key))
      else perms.forEach(p => next.add(p.key))
      return next
    })
  }

  async function handleSave() {
    if (name.trim().length < 3) { setError('El nombre debe tener al menos 3 caracteres.'); return }
    setSaving(true)
    setError(null)
    try {
      let savedRoleId = roleId
      if (savedRoleId) {
        const { error: updErr } = await updateRole(savedRoleId, {
          name: name.trim(), description: description.trim() || null, color, updated_at: new Date().toISOString(),
        })
        if (updErr) throw new Error(updErr)
      } else {
        const { data: insData, error: insErr } = await createRole({
          company_id: companyId, name: name.trim(), description: description.trim() || null, is_system: false, color,
          // Linaje: los clones registran su rol/plantilla de origen (habilita la
          // expansión de assigned_role_ids en la sesión y el reuso de adopciones).
          cloned_from_role_id: cloneFromRoleId ?? null,
        })
        if (insErr) throw new Error(insErr)
        savedRoleId = insData!.id
      }

      const { data: existingPerms } = await fetchAllRolePermissionKeys(savedRoleId)
      const existing = new Set((existingPerms ?? []).map(r => r.permission_key))

      const toAdd = [...selectedKeys].filter(k => !existing.has(k))
      const toRemove = [...existing].filter(k => !selectedKeys.has(k))

      if (toRemove.length > 0) {
        const { error: delErr } = await deleteRolePermissions(savedRoleId, toRemove)
        if (delErr) throw new Error(delErr)
      }
      if (toAdd.length > 0) {
        const rows = toAdd.map(permission_key => ({ role_id: savedRoleId, permission_key, effect: 'allow' }))
        const { error: insErr } = await insertRolePermissions(rows)
        if (insErr) throw new Error(insErr)
      }

      onSaved(savedRoleId)
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el rol.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9100,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--at-surface)', borderRadius: '16px', width: '100%', maxWidth: '780px',
        boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
        display: 'flex', flexDirection: 'column', maxHeight: '92vh',
      }}>
        <div style={{
          padding: '20px 24px 14px', borderBottom: '1px solid var(--at-line)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontWeight: 700, fontSize: '16px', color: 'var(--at-ink)' }}>
            {roleId
              ? 'Editar rol personalizado'
              : cloneSourceName
                ? `Crear rol personalizado (a partir de «${cloneSourceName}»)`
                : 'Crear rol personalizado'}
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px',
            color: 'var(--at-ink-3)', padding: '4px 8px', borderRadius: '6px', lineHeight: 1,
          }}>×</button>
        </div>

        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--at-line)' }}>
          <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
            <div style={{ flex: 1 }}>
              <Label>Nombre</Label>
              <input
                value={name} onChange={e => setName(e.target.value)} placeholder="ej. Guardia nocturno"
                style={inputStyle}
              />
            </div>
            <div style={{ width: '120px' }}>
              <Label>Color</Label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {PALETTE.map(c => (
                  <button key={c} onClick={() => setColor(c)} style={{
                    width: '20px', height: '20px', borderRadius: '4px', background: c,
                    border: color === c ? '2px solid var(--at-ink)' : '1px solid var(--at-line)',
                    cursor: 'pointer', padding: 0,
                  }} />
                ))}
              </div>
            </div>
          </div>
          <div>
            <Label>Descripción</Label>
            <input
              value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Para qué se usa este rol" style={inputStyle}
            />
          </div>
        </div>

        <div style={{ padding: '12px 24px 8px', borderBottom: '1px solid var(--at-line)' }}>
          <input
            value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar permiso…"
            style={{ ...inputStyle, marginBottom: 0 }}
          />
          <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '6px' }}>
            {selectedKeys.size} permisos seleccionados · {permissions.length} disponibles
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 24px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', marginTop: '40px' }}>Cargando…</div>
          ) : (
            grouped.map(([category, rows]) => {
              const catPerms = rows.flatMap(r => r.perms)
              const allSelected = catPerms.every(p => selectedKeys.has(p.key))
              return (
                <div key={category} style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink-2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {categoryLabel(category)}
                    </div>
                    <button onClick={() => toggleMany(catPerms)} style={{
                      fontSize: '11px', color: 'var(--at-primary-2)', background: 'transparent',
                      border: '1px solid var(--at-accent-2)', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer',
                    }}>{allSelected ? 'Deseleccionar' : 'Seleccionar todo'}</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: `minmax(0, 1fr) repeat(${ACTION_COLUMNS.length}, 62px)`, alignItems: 'center' }}>
                    {/* Encabezado de acciones (por categoría, para que siga visible al hacer scroll) */}
                    <div />
                    {ACTION_COLUMNS.map(c => (
                      <div key={c.action} title={MODULE_ACTION_LABELS[c.action]} style={{
                        fontSize: '10px', fontWeight: 700, color: 'var(--at-ink-3)', textAlign: 'center',
                        textTransform: 'uppercase', letterSpacing: '0.04em', padding: '2px 0',
                      }}>{c.short}</div>
                    ))}
                    {rows.map(row => {
                      const rowAll = row.perms.every(p => selectedKeys.has(p.key))
                      return (
                        // Fila = módulo/tab. La etiqueta alterna toda la fila;
                        // cada celda alterna una acción. Celda vacía = la
                        // acción no existe en el catálogo para ese módulo.
                        <Fragment key={row.id}>
                          <button
                            onClick={() => toggleMany(row.perms)}
                            title={rowAll ? 'Quitar todas las acciones' : 'Otorgar todas las acciones'}
                            style={{
                              textAlign: 'left', fontSize: '12px', padding: '3px 4px', borderRadius: '4px',
                              color: rowAll ? 'var(--at-primary-2)' : 'var(--at-ink-2)',
                              fontWeight: rowAll ? 600 : 400,
                              background: 'transparent', border: 'none', cursor: 'pointer',
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}
                          >{row.label}</button>
                          {ACTION_COLUMNS.map(c => {
                            const perm = row.cells[c.action]
                            return (
                              <div key={c.action} style={{ textAlign: 'center', padding: '2px 0' }}>
                                {perm ? (
                                  <input
                                    type="checkbox"
                                    checked={selectedKeys.has(perm.key)}
                                    onChange={() => toggleAction(row, perm)}
                                    aria-label={perm.label}
                                    title={perm.label}
                                    style={{ cursor: 'pointer' }}
                                  />
                                ) : (
                                  <span style={{ color: 'var(--at-line)', fontSize: '11px' }}>—</span>
                                )}
                              </div>
                            )
                          })}
                        </Fragment>
                      )
                    })}
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div style={{
          padding: '14px 24px', borderTop: '1px solid var(--at-line)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: '12px', color: error ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>{error ?? ''}</div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={onClose} style={btnSecondary}>Cancelar</button>
            <button onClick={() => void handleSave()} disabled={saving || loading} style={{
              ...btnPrimary, background: saving ? 'var(--at-accent-2)' : 'var(--at-primary-2)',
              cursor: saving ? 'default' : 'pointer',
            }}>{saving ? 'Guardando…' : 'Guardar rol'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: '6px',
  border: '1px solid var(--at-line-strong)', fontSize: '13px', color: 'var(--at-ink)',
  outline: 'none', marginBottom: 0, boxSizing: 'border-box',
}

const btnSecondary: React.CSSProperties = {
  padding: '8px 18px', borderRadius: '8px', border: '1px solid var(--at-line)',
  background: 'var(--at-surface)', color: 'var(--at-ink-2)', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
}

const btnPrimary: React.CSSProperties = {
  padding: '8px 20px', borderRadius: '8px', border: 'none',
  color: 'white', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
}
