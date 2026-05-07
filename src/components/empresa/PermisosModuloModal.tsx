import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { ModulePermission } from '../../types'
import { CONFIGURABLE_MODULES, ROLE_DEFAULT_TEMPLATES, WATER_MODULE_KEYS, CONDOMINIOS_MODULE_KEYS } from '../../lib/moduleConfig'
import type { ModuleAction } from '../../lib/moduleConfig'

interface Usuario {
  id: string
  full_name: string
  role: string
}

interface Props {
  usuario: Usuario
  servicioAgua: boolean
  servicioCondominios: boolean
  onClose: () => void
  onSaved: () => void
}

type PermFlag = 'can_view' | 'can_create' | 'can_edit' | 'can_change_status'

const ACTION_TO_FLAG: Record<ModuleAction, PermFlag> = {
  view: 'can_view',
  create: 'can_create',
  edit: 'can_edit',
  change_status: 'can_change_status',
}

const FLAG_LABELS: Record<PermFlag, string> = {
  can_view: 'Ver',
  can_create: 'Crear',
  can_edit: 'Editar',
  can_change_status: 'Cambiar Estado',
}

const ALL_FLAGS: PermFlag[] = ['can_view', 'can_create', 'can_edit', 'can_change_status']

const ROLE_LABELS: Record<string, string> = {
  admin: 'Administrador',
  operator: 'Operador',
  operador: 'Operador',
  viewer: 'Visualizador',
  visor: 'Visualizador',
  collector: 'Gestor de Cobros',
}

function emptyPermsMap(modules: typeof CONFIGURABLE_MODULES): Record<string, ModulePermission> {
  const map: Record<string, ModulePermission> = {}
  for (const mod of modules) {
    map[mod.key] = {
      module_key: mod.key,
      can_view: false,
      can_create: false,
      can_edit: false,
      can_change_status: false,
    }
  }
  return map
}

function defaultPermsForRole(role: string, modules: typeof CONFIGURABLE_MODULES): Record<string, ModulePermission> {
  const map = emptyPermsMap(modules)
  const normalizedRole = role === 'operador' ? 'operator' : role === 'visor' ? 'viewer' : role
  const template = ROLE_DEFAULT_TEMPLATES[normalizedRole]
  if (template) {
    for (const p of template) {
      if (p.module_key in map) map[p.module_key] = { ...p }
    }
  }
  return map
}

function moduleSupportsAction(moduleKey: string, flag: PermFlag): boolean {
  const mod = CONFIGURABLE_MODULES.find(m => m.key === moduleKey)
  if (!mod) return false
  const action = Object.entries(ACTION_TO_FLAG).find(([, f]) => f === flag)?.[0] as ModuleAction | undefined
  if (!action) return false
  return (mod.actions as readonly string[]).includes(action)
}

export function PermisosModuloModal({ usuario, servicioAgua, servicioCondominios, onClose, onSaved }: Props) {
  const activeModules = CONFIGURABLE_MODULES.filter(mod => {
    if (WATER_MODULE_KEYS.has(mod.key)) return servicioAgua
    if (CONDOMINIOS_MODULE_KEYS.has(mod.key)) return servicioCondominios
    return true
  })
  const [perms, setPerms] = useState<Record<string, ModulePermission>>(() => emptyPermsMap(activeModules))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [hoveredRestore, setHoveredRestore] = useState(false)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('user_module_permissions')
        .select('module_key, can_view, can_create, can_edit, can_change_status')
        .eq('user_id', usuario.id)

      if (data && data.length > 0) {
        const map = emptyPermsMap(activeModules)
        for (const row of data) {
          map[row.module_key] = {
            module_key: row.module_key,
            can_view: row.can_view,
            can_create: row.can_create,
            can_edit: row.can_edit,
            can_change_status: row.can_change_status,
          }
        }
        setPerms(map)
      } else {
        // Sin permisos guardados → usar defaults del rol
        setPerms(defaultPermsForRole(usuario.role, activeModules))
      }
      setLoading(false)
    }
    void load()
  }, [usuario.id, usuario.role])

  function toggleFlag(moduleKey: string, flag: PermFlag) {
    setPerms(prev => {
      const current = prev[moduleKey]
      if (!current) return prev
      const updated = { ...current, [flag]: !current[flag] }

      // Si se desactiva "ver", desactivar todo lo demás
      if (flag === 'can_view' && !updated.can_view) {
        updated.can_create = false
        updated.can_edit = false
        updated.can_change_status = false
      }

      return { ...prev, [moduleKey]: updated }
    })
  }

  function restoreDefaults() {
    setPerms(defaultPermsForRole(usuario.role, activeModules))
  }

  async function guardar() {
    setSaving(true)
    try {
      // Borrar permisos existentes
      const { error: delError } = await supabase
        .from('user_module_permissions')
        .delete()
        .eq('user_id', usuario.id)
      if (delError) throw delError

      // Insertar permisos de los módulos activos (los del servicio desactivado no se persisten)
      const activeKeys = new Set(activeModules.map(m => m.key))
      const rows = Object.values(perms).filter(p => activeKeys.has(p.module_key)).map(p => ({
        user_id: usuario.id,
        module_key: p.module_key,
        can_view: p.can_view,
        can_create: p.can_create,
        can_edit: p.can_edit,
        can_change_status: p.can_change_status,
      }))

      if (rows.length > 0) {
        const { error: insertError } = await supabase
          .from('user_module_permissions')
          .insert(rows)
        if (insertError) throw insertError
      }

      onSaved()
      onClose()
    } catch (err) {
      console.error('Error guardando permisos de módulos:', err)
      alert('Error al guardar los permisos. Por favor intente de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: '#1e293b', borderRadius: '16px', padding: '28px',
        width: '680px', maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto',
        boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{ marginBottom: '20px' }}>
          <h2 style={{ color: '#f1f5f9', fontSize: '18px', fontWeight: 700, margin: 0 }}>
            Permisos de Modulos
          </h2>
          <p style={{ color: '#94a3b8', fontSize: '14px', marginTop: '6px' }}>
            {usuario.full_name} &middot; {ROLE_LABELS[usuario.role] ?? usuario.role}
          </p>
        </div>

        {loading ? (
          <div style={{ color: '#64748b', textAlign: 'center', padding: '20px' }}>Cargando...</div>
        ) : (
          <>
            {/* Matriz de permisos */}
            <div style={{ overflowX: 'auto', marginBottom: '20px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr>
                    <th style={{
                      textAlign: 'left', padding: '10px 12px', color: '#94a3b8',
                      fontWeight: 600, fontSize: '11px', textTransform: 'uppercase',
                      letterSpacing: '0.05em', borderBottom: '1px solid rgba(255,255,255,0.08)',
                    }}>
                      Modulo
                    </th>
                    {ALL_FLAGS.map(flag => (
                      <th key={flag} style={{
                        textAlign: 'center', padding: '10px 8px', color: '#94a3b8',
                        fontWeight: 600, fontSize: '11px', textTransform: 'uppercase',
                        letterSpacing: '0.05em', borderBottom: '1px solid rgba(255,255,255,0.08)',
                        width: '90px',
                      }}>
                        {FLAG_LABELS[flag]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {activeModules.map(mod => {
                    const p = perms[mod.key]
                    const viewEnabled = p?.can_view ?? false
                    return (
                      <tr key={mod.key} style={{
                        borderBottom: '1px solid rgba(255,255,255,0.04)',
                        background: viewEnabled ? 'rgba(14,165,233,0.04)' : 'transparent',
                      }}>
                        <td style={{
                          padding: '11px 12px',
                          color: viewEnabled ? '#e2e8f0' : '#4b5563',
                          fontWeight: viewEnabled ? 500 : 400,
                          transition: 'color 0.15s',
                        }}>
                          {mod.label}
                        </td>
                        {ALL_FLAGS.map(flag => {
                          const supported = moduleSupportsAction(mod.key, flag)
                          const checked = p ? (p[flag] ?? false) : false
                          const disabled = !supported || (flag !== 'can_view' && !viewEnabled)

                          return (
                            <td key={flag} style={{ textAlign: 'center', padding: '8px' }}>
                              {supported ? (
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={disabled}
                                  onChange={() => toggleFlag(mod.key, flag)}
                                  style={{
                                    accentColor: '#0ea5e9',
                                    width: '16px',
                                    height: '16px',
                                    cursor: disabled ? 'not-allowed' : 'pointer',
                                    opacity: disabled && flag !== 'can_view' ? 0.3 : 1,
                                  }}
                                />
                              ) : (
                                <span style={{ color: '#334155', fontSize: '16px' }}>—</span>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Leyenda */}
            <div style={{
              display: 'flex', gap: '16px', flexWrap: 'wrap',
              padding: '10px 12px', background: 'rgba(255,255,255,0.02)',
              borderRadius: '8px', marginBottom: '20px', fontSize: '11px', color: '#64748b',
            }}>
              <span><strong style={{ color: '#94a3b8' }}>Ver</strong> = consultar datos</span>
              <span><strong style={{ color: '#94a3b8' }}>Crear</strong> = agregar nuevos</span>
              <span><strong style={{ color: '#94a3b8' }}>Editar</strong> = modificar existentes</span>
              <span><strong style={{ color: '#94a3b8' }}>Cambiar Estado</strong> = modificar estados</span>
              <span><strong style={{ color: '#334155' }}>—</strong> = no aplica</span>
            </div>
          </>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <button
            onClick={restoreDefaults}
            onMouseEnter={() => setHoveredRestore(true)}
            onMouseLeave={() => setHoveredRestore(false)}
            style={{
              padding: '9px 16px', borderRadius: '8px',
              border: '1px solid rgba(251,191,36,0.3)',
              background: hoveredRestore ? 'rgba(251,191,36,0.1)' : 'transparent',
              color: '#fbbf24', cursor: 'pointer', fontSize: '13px', fontWeight: 500,
              transition: 'all 0.15s',
            }}
          >
            Restaurar Predeterminados
          </button>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={onClose}
              style={{
                padding: '9px 18px', borderRadius: '8px',
                border: '1px solid rgba(255,255,255,0.1)',
                background: 'transparent', color: '#94a3b8',
                cursor: 'pointer', fontSize: '14px',
              }}
            >
              Cancelar
            </button>
            <button
              onClick={() => void guardar()}
              disabled={saving}
              style={{
                padding: '9px 20px', borderRadius: '8px', border: 'none',
                background: saving ? '#334155' : 'linear-gradient(135deg, #0ea5e9, #0d9488)',
                color: 'white', cursor: saving ? 'not-allowed' : 'pointer',
                fontSize: '14px', fontWeight: 600,
              }}
            >
              {saving ? 'Guardando...' : 'Guardar Permisos'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
