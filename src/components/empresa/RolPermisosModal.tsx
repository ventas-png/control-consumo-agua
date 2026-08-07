// Modal de roles y permisos por usuario (RBAC). Modelo en 3 niveles:
//   1. Plantillas — los roles del sistema ya no se asignan directamente: "Usar
//      plantilla" busca-o-crea la copia de empresa (linaje cloned_from_role_id)
//      y la selecciona; "Personalizar" abre el editor clonando.
//   2. Roles de la empresa — copias de plantillas + roles hechos a mano:
//      asignables (checkbox), editables, duplicables, con expiración. Las
//      asignaciones directas a roles del sistema previas al modelo se muestran
//      como "heredadas" con conversión opcional.
//   3. Ajustes individuales — el panel de permisos efectivos permite conceder
//      o bloquear permisos puntuales solo a este usuario (rol oculto con filas
//      allow/deny; el servidor ya resta deny de allow en get_user_permissions).
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  fetchCompanyRoles,
  fetchAllRolePermissions,
  fetchPermissionsCatalog,
  fetchUserRoleAssignments,
  fetchUserRoleIds,
  fetchUserOverrideRole,
  fetchRolePermissionsWithEffect,
  ensureCompanyRoleFromTemplate,
  createOverrideRole,
  deleteUserRoles,
  insertUserRoles,
  updateUserRoleExpiration,
  deleteRole,
  deleteRolePermissions,
  insertRolePermissions,
} from '../../domain/empresa/roles'
import type { PermissionDef, RoleDef } from '../../types'
import { CONDOMINIOS_SECTION_GROUPS, type SectionGroup } from '../../lib/condominiosRoles'
import { AGUA_MODULE_GROUPS } from '../../lib/aguaPermissions'
import { PLATFORM_MODULE_GROUPS } from '../../lib/platformPermissions'
import { condominiosTabPermission, isExemptPlatformRole } from '../../lib/permissions'
import {
  buildRolePermIndex,
  computeEffective,
  type PermissionEffect,
  type RolePermissionRow,
} from '../../lib/effectivePermissions'
import { Banner, CollapsibleSection, RoleCard, SectionHeader, TemplateCard } from './rolesUi'
import { PermissionMatrixPanel, type MatrixSectionBlock } from './PermissionMatrixPanel'
import { ModalPortal } from '../shared/ModalPortal'

/** Petición de apertura del editor de roles desde este modal. */
export interface CustomEditorRequest {
  roleId: string | null
  cloneFromRoleId?: string
  initialKeys?: string[]
  /** 'reusable': el rol nace de los ajustes individuales; al volver se
   * selecciona y los ajustes en memoria se limpian (se borran al guardar). */
  intent?: 'reusable'
  suggestedName?: string
}

interface Props {
  usuarioId: string
  usuarioNombre: string
  /** Tier de plataforma del usuario (app_users.role) — para avisar si es exento. */
  usuarioTier?: string
  companyId: string
  servicioAgua?: boolean
  servicioCondominios?: boolean
  /** Bump this counter to force a re-fetch of the roles list (preserves current selection) */
  rolesRefreshKey?: number
  /** Rol recién creado en el editor que debe quedar seleccionado al volver. */
  autoSelect?: { roleId: string; clearOverrides: boolean } | null
  onClose: () => void
  onSaved: () => void
  onOpenCustomEditor: (req: CustomEditorRequest) => void
}

// Grupos de condominios con claves de permiso completas (los SECTION_GROUPS
// traen ids de tab; agua/plataforma ya vienen como claves completas).
const CONDOMINIOS_KEY_GROUPS: SectionGroup[] = CONDOMINIOS_SECTION_GROUPS.map(g => ({
  ...g,
  tabs: g.tabs.map(condominiosTabPermission),
}))

export function RolPermisosModal({
  usuarioId, usuarioNombre, usuarioTier, companyId,
  servicioAgua, servicioCondominios,
  rolesRefreshKey = 0, autoSelect, onClose, onSaved, onOpenCustomEditor,
}: Props) {
  const [roles, setRoles] = useState<RoleDef[]>([])
  const [rolePerms, setRolePerms] = useState<RolePermissionRow[]>([])
  const [permLabels, setPermLabels] = useState<Map<string, string>>(new Map())
  const [selectedRoleIds, setSelectedRoleIds] = useState<Set<string>>(new Set())
  // role_id -> expiration ISO date (yyyy-mm-dd) or null for permanent
  const [expirations, setExpirations] = useState<Map<string, string | null>>(new Map())
  // Snapshot of initial state, used to detect changes for UPDATE
  const [initialExpirations, setInitialExpirations] = useState<Map<string, string | null>>(new Map())
  // Roles del sistema asignados directamente al cargar (estado heredado).
  const [inheritedSystemIds, setInheritedSystemIds] = useState<Set<string>>(new Set())
  // Ajustes individuales: rol oculto + mapa clave → allow/deny editado y snapshot.
  const [overrideRoleId, setOverrideRoleId] = useState<string | null>(null)
  const [overrides, setOverrides] = useState<Map<string, PermissionEffect>>(new Map())
  const [initialOverrides, setInitialOverrides] = useState<Map<string, PermissionEffect>>(new Map())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [ensuringTemplateId, setEnsuringTemplateId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadRoles = useCallback(async (): Promise<RoleDef[]> => {
    const [{ data: rolesData, error: rolesErr }, { data: rolePermsData }, { data: catalogData }] =
      await Promise.all([
        fetchCompanyRoles(companyId),
        fetchAllRolePermissions(),
        fetchPermissionsCatalog(),
      ])
    if (rolesErr) throw new Error(rolesErr)
    const loaded = (rolesData ?? []) as RoleDef[]
    setRoles(loaded)
    setRolePerms((rolePermsData ?? []) as RolePermissionRow[])
    setPermLabels(new Map(((catalogData ?? []) as PermissionDef[]).map(p => [p.key, p.label])))
    return loaded
  }, [companyId])

  // Initial: fetch roles + user's current assignments + override role. Re-runs
  // only on user/company change.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const loadedRoles = await loadRoles()
        const [{ data: userRolesData }, { data: overrideRole }] = await Promise.all([
          fetchUserRoleAssignments(usuarioId),
          fetchUserOverrideRole(usuarioId),
        ])
        let overrideMap = new Map<string, PermissionEffect>()
        if (overrideRole) {
          const { data: ovrPerms } = await fetchRolePermissionsWithEffect(overrideRole.id)
          overrideMap = new Map(
            ((ovrPerms ?? []) as Array<{ permission_key: string; effect: string }>)
              .filter(p => p.effect === 'allow' || p.effect === 'deny')
              .map(p => [p.permission_key, p.effect as PermissionEffect]),
          )
        }
        if (cancelled) return
        const rows = ((userRolesData ?? []) as Array<{ role_id: string; expires_at: string | null }>)
          // El rol de ajustes se gestiona aparte (no participa de la selección).
          .filter(r => r.role_id !== overrideRole?.id)
        setSelectedRoleIds(new Set(rows.map(ur => ur.role_id)))
        const expMap = new Map<string, string | null>()
        for (const r of rows) {
          expMap.set(r.role_id, r.expires_at ? r.expires_at.slice(0, 10) : null)
        }
        setExpirations(expMap)
        setInitialExpirations(new Map(expMap))
        // Snapshot de asignaciones directas a roles del sistema (heredadas del
        // modelo anterior): se muestran en "Roles de la empresa" con conversión.
        const systemIds = new Set(loadedRoles.filter(r => r.is_system).map(r => r.id))
        setInheritedSystemIds(new Set(rows.map(r => r.role_id).filter(id => systemIds.has(id))))
        setOverrideRoleId(overrideRole?.id ?? null)
        setOverrides(overrideMap)
        setInitialOverrides(new Map(overrideMap))
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'No se pudieron cargar los roles.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [loadRoles, usuarioId])

  // Refresh only the roles list (custom roles created/edited in another modal)
  // Preserves the current selection.
  useEffect(() => {
    if (rolesRefreshKey === 0) return
    void loadRoles().catch(e => setError(e instanceof Error ? e.message : 'Error al refrescar roles.'))
  }, [rolesRefreshKey, loadRoles])

  // Rol recién creado en el editor → seleccionarlo; si nació de los ajustes
  // individuales ('reusable'), limpiar los ajustes en memoria (se borran al guardar).
  useEffect(() => {
    if (!autoSelect) return
    setSelectedRoleIds(prev => new Set(prev).add(autoSelect.roleId))
    if (autoSelect.clearOverrides) setOverrides(new Map())
  }, [autoSelect])

  function toggleRole(roleId: string) {
    setSelectedRoleIds(prev => {
      const next = new Set(prev)
      if (next.has(roleId)) {
        next.delete(roleId)
        // Drop the expiration if we removed the role
        setExpirations(em => {
          const m = new Map(em); m.delete(roleId); return m
        })
      } else {
        next.add(roleId)
      }
      return next
    })
  }

  function setExpiration(roleId: string, value: string | null) {
    setExpirations(prev => {
      const next = new Map(prev)
      if (value) next.set(roleId, value)
      else next.set(roleId, null)
      return next
    })
  }

  const rolesById = useMemo(() => new Map(roles.map(r => [r.id, r])), [roles])
  const permIndex = useMemo(() => buildRolePermIndex(rolePerms), [rolePerms])
  const effectiveResult = useMemo(
    () => computeEffective(selectedRoleIds, permIndex, overrides),
    [selectedRoleIds, permIndex, overrides],
  )

  const companyRoles = roles.filter(r => !r.is_system)
  const systemRoles = roles.filter(r => r.is_system)
  const inheritedRoles = systemRoles.filter(r => inheritedSystemIds.has(r.id))
  const templateRoles = systemRoles.filter(r => !inheritedSystemIds.has(r.id))

  const showCondominios = servicioCondominios !== false
  const showAgua = servicioAgua !== false

  const templateSections = [
    showCondominios && {
      key: 'condominios',
      title: 'Plantillas — Condominios',
      roles: templateRoles.filter(r => r.service === 'condominios' || r.service == null),
    },
    showAgua && {
      key: 'agua',
      title: 'Plantillas — Agua',
      roles: templateRoles.filter(r => r.service === 'agua'),
    },
    {
      key: 'general',
      title: 'Plantillas — Plataforma',
      roles: templateRoles.filter(r => r.service === 'general'),
    },
  ].filter((s): s is { key: string; title: string; roles: RoleDef[] } => !!s && s.roles.length > 0)

  const matrixSections: MatrixSectionBlock[] = [
    ...(showCondominios ? [{ label: 'Condominios', groups: CONDOMINIOS_KEY_GROUPS }] : []),
    ...(showAgua ? [{ label: 'Agua', groups: AGUA_MODULE_GROUPS }] : []),
    { label: 'Plataforma', groups: PLATFORM_MODULE_GROUPS },
  ]

  const selectedChips = [...selectedRoleIds]
    .map(id => rolesById.get(id))
    .filter((r): r is RoleDef => !!r)

  // Toggle involutivo de un permiso puntual: con ajuste → quitarlo; otorgado
  // por roles → bloquear (deny); no otorgado → conceder (allow).
  function togglePermission(key: string) {
    const base = effectiveResult.base
    setOverrides(prev => {
      const next = new Map(prev)
      if (next.has(key)) next.delete(key)
      else if (base.has(key)) next.set(key, 'deny')
      else next.set(key, 'allow')
      return next
    })
  }

  async function handleUseTemplate(templateId: string) {
    setEnsuringTemplateId(templateId)
    setError(null)
    try {
      const { data, error: ensureErr } = await ensureCompanyRoleFromTemplate(companyId, templateId)
      if (ensureErr || !data) throw new Error(ensureErr ?? 'No se pudo crear el rol desde la plantilla.')
      await loadRoles()
      setSelectedRoleIds(prev => new Set(prev).add(data.id))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo usar la plantilla.')
    } finally {
      setEnsuringTemplateId(null)
    }
  }

  // Convierte una asignación heredada (rol del sistema) en la copia de empresa:
  // intercambia la selección y conserva la expiración; persiste al Guardar con
  // el diff normal (delete+insert → queda auditado).
  async function handleConvertInherited(systemRoleId: string) {
    setEnsuringTemplateId(systemRoleId)
    setError(null)
    try {
      const { data, error: ensureErr } = await ensureCompanyRoleFromTemplate(companyId, systemRoleId)
      if (ensureErr || !data) throw new Error(ensureErr ?? 'No se pudo convertir el rol.')
      await loadRoles()
      setSelectedRoleIds(prev => {
        const next = new Set(prev)
        if (next.delete(systemRoleId)) next.add(data.id)
        return next
      })
      setExpirations(prev => {
        const next = new Map(prev)
        const exp = next.get(systemRoleId)
        next.delete(systemRoleId)
        if (exp !== undefined) next.set(data.id, exp)
        return next
      })
      setInheritedSystemIds(prev => {
        const next = new Set(prev); next.delete(systemRoleId); return next
      })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo convertir el rol.')
    } finally {
      setEnsuringTemplateId(null)
    }
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const { data: existing } = await fetchUserRoleIds(usuarioId)
      const existingIds = new Set((existing ?? []).map(r => r.role_id))
      // El rol de ajustes se persiste aparte; no participa del diff de roles.
      if (overrideRoleId) existingIds.delete(overrideRoleId)

      const toAdd = [...selectedRoleIds].filter(id => !existingIds.has(id))
      const toRemove = [...existingIds].filter(id => !selectedRoleIds.has(id))
      // Rows that exist in both before and after, but whose expiration changed
      const toUpdateExpiration = [...selectedRoleIds].filter(id => {
        if (!existingIds.has(id)) return false
        const before = initialExpirations.get(id) ?? null
        const after = expirations.get(id) ?? null
        return before !== after
      })

      if (toRemove.length > 0) {
        const { error: delErr } = await deleteUserRoles(usuarioId, toRemove)
        if (delErr) throw new Error(delErr)
      }
      if (toAdd.length > 0) {
        const rows = toAdd.map(role_id => ({
          user_id: usuarioId,
          role_id,
          expires_at: expirations.get(role_id) ? expirations.get(role_id) : null,
        }))
        const { error: insErr } = await insertUserRoles(rows)
        if (insErr) throw new Error(insErr)
      }
      // UPDATE expires_at on roles that were already assigned
      for (const roleId of toUpdateExpiration) {
        const exp = expirations.get(roleId) ?? null
        const { error: updErr } = await updateUserRoleExpiration(usuarioId, roleId, exp)
        if (updErr) throw new Error(updErr)
      }

      // ── Ajustes individuales: poda de redundantes + diff contra el snapshot ──
      const desired = new Map(
        [...overrides].filter(([k]) => !effectiveResult.redundantOverrides.has(k)),
      )
      if (desired.size > 0) {
        let ovId = overrideRoleId
        if (!ovId) {
          const name = `Ajustes individuales — ${usuarioNombre} (${usuarioId.slice(0, 8)})`
          const { data: created, error: createErr } = await createOverrideRole(companyId, usuarioId, name)
          if (createErr || !created) throw new Error(createErr ?? 'No se pudo crear el rol de ajustes.')
          ovId = created.id
          // Asignación permanente: la expiración no aplica a los ajustes.
          const { error: asgErr } = await insertUserRoles([{ user_id: usuarioId, role_id: ovId, expires_at: null }])
          if (asgErr) throw new Error(asgErr)
        }
        // Cambio de effect = delete + insert (la PK es role_id + permission_key).
        const keysToRemove: string[] = []
        const rowsToAdd: Array<{ role_id: string; permission_key: string; effect: PermissionEffect }> = []
        for (const [key, eff] of initialOverrides) {
          const want = desired.get(key)
          if (want === undefined || want !== eff) keysToRemove.push(key)
        }
        for (const [key, eff] of desired) {
          const had = initialOverrides.get(key)
          if (had === undefined || had !== eff) rowsToAdd.push({ role_id: ovId, permission_key: key, effect: eff })
        }
        if (keysToRemove.length > 0) {
          const { error: delPermErr } = await deleteRolePermissions(ovId, keysToRemove)
          if (delPermErr) throw new Error(delPermErr)
        }
        if (rowsToAdd.length > 0) {
          const { error: insPermErr } = await insertRolePermissions(rowsToAdd)
          if (insPermErr) throw new Error(insPermErr)
        }
      } else if (overrideRoleId) {
        // Sin ajustes deseados: el rol oculto sobra (el cascade limpia
        // role_permissions y user_roles; queda auditado como delete_role).
        const { error: delOvErr } = await deleteRole(overrideRoleId)
        if (delOvErr) throw new Error(delOvErr)
      }

      onSaved()
      onClose()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteCustomRole(roleId: string) {
    if (!confirm('¿Eliminar este rol personalizado? Los usuarios que lo tengan asignado perderán esos permisos.')) return
    const { error: delErr } = await deleteRole(roleId)
    if (delErr) { setError(delErr); return }
    void loadRoles()
  }

  const exemptTier = isExemptPlatformRole(usuarioTier)

  return (
    <ModalPortal>
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '16px',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'var(--at-surface)', borderRadius: '16px', width: '100%', maxWidth: '980px',
        boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
        display: 'flex', flexDirection: 'column', maxHeight: '90vh',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px 16px', borderBottom: '1px solid var(--at-line)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '16px', color: 'var(--at-ink)' }}>Roles y permisos</div>
            <div style={{ fontSize: '13px', color: 'var(--at-ink-3)', marginTop: '2px' }}>{usuarioNombre}</div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '20px', color: 'var(--at-ink-3)', padding: '4px 8px', borderRadius: '6px', lineHeight: 1,
          }}>×</button>
        </div>

        {/* Body */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          {/* Left: roles de la empresa + plantillas */}
          <div style={{
            flex: '0 0 46%', borderRight: '1px solid var(--at-line)',
            overflowY: 'auto', padding: '16px',
          }}>
            {loading ? (
              <div style={{ color: 'var(--at-ink-3)', fontSize: '13px', textAlign: 'center', marginTop: '40px' }}>Cargando…</div>
            ) : (
              <>
                {exemptTier && (
                  <Banner color="var(--at-warning)">
                    Este usuario tiene un nivel de plataforma exento (administrador): los roles y
                    ajustes de esta pantalla no restringen su acceso mientras conserve ese nivel.
                  </Banner>
                )}

                {selectedChips.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '12px' }}>
                    {selectedChips.map(r => (
                      <span key={r.id} style={{
                        display: 'inline-flex', alignItems: 'center', gap: '5px',
                        padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 600,
                        background: r.color + '22', color: r.color,
                      }}>
                        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: r.color }} />
                        {r.name}
                        {expirations.get(r.id) && <span title="Temporal">⏱</span>}
                        <button
                          onClick={() => toggleRole(r.id)}
                          title="Quitar rol"
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer', color: 'inherit',
                            fontSize: '11px', padding: 0, lineHeight: 1,
                          }}
                        >×</button>
                      </span>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <SectionHeader>Roles de la empresa</SectionHeader>
                  <button
                    onClick={() => onOpenCustomEditor({ roleId: null })}
                    style={{
                      fontSize: '11px', fontWeight: 600, color: 'var(--at-primary-2)',
                      background: 'transparent', border: '1px solid var(--at-accent-2)', borderRadius: '6px',
                      padding: '3px 10px', cursor: 'pointer',
                    }}
                  >+ Crear</button>
                </div>
                {companyRoles.length === 0 && inheritedRoles.length === 0 ? (
                  <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', textAlign: 'center', padding: '14px 0' }}>
                    Aún no hay roles de empresa.<br />Usa una plantilla de abajo o crea uno desde "Crear".
                  </div>
                ) : (
                  <>
                    {companyRoles.map(r => (
                      <RoleCard
                        key={r.id}
                        role={r}
                        checked={selectedRoleIds.has(r.id)}
                        expiresAt={expirations.get(r.id) ?? null}
                        onToggle={() => toggleRole(r.id)}
                        onExpirationChange={(v) => setExpiration(r.id, v)}
                        onEdit={() => onOpenCustomEditor({ roleId: r.id })}
                        onDelete={() => void handleDeleteCustomRole(r.id)}
                        onClone={() => onOpenCustomEditor({ roleId: null, cloneFromRoleId: r.id })}
                      />
                    ))}
                    {inheritedRoles.map(r => (
                      <RoleCard
                        key={r.id}
                        role={r}
                        checked={selectedRoleIds.has(r.id)}
                        expiresAt={expirations.get(r.id) ?? null}
                        onToggle={() => toggleRole(r.id)}
                        onExpirationChange={(v) => setExpiration(r.id, v)}
                        onClone={() => onOpenCustomEditor({ roleId: null, cloneFromRoleId: r.id })}
                        inherited
                        onConvert={() => void handleConvertInherited(r.id)}
                      />
                    ))}
                  </>
                )}

                <div style={{ marginTop: '14px' }}>
                  <SectionHeader>Plantillas</SectionHeader>
                  <div style={{ fontSize: '10px', color: 'var(--at-ink-3)', marginBottom: '8px', lineHeight: 1.4 }}>
                    Puntos de partida del sistema. "Usar plantilla" crea (o reutiliza) el rol de tu
                    empresa con esos permisos; "Personalizar" te deja ajustarlo antes de crearlo.
                  </div>
                  {templateSections.map((section, idx) => (
                    <CollapsibleSection
                      key={section.key}
                      title={section.title}
                      badge={`${section.roles.length}`}
                      defaultOpen={companyRoles.length === 0 && idx === 0}
                    >
                      {section.roles.map(r => (
                        <TemplateCard
                          key={r.id}
                          role={r}
                          busy={ensuringTemplateId === r.id}
                          onUse={() => void handleUseTemplate(r.id)}
                          onCustomize={() => onOpenCustomEditor({ roleId: null, cloneFromRoleId: r.id })}
                        />
                      ))}
                    </CollapsibleSection>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Right: permisos efectivos (explorables y editables) */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
            {!loading && (
              <>
                {overrides.size === 0 && initialOverrides.size > 0 && (
                  <Banner color="var(--at-primary)">
                    Los ajustes individuales guardados se quitarán al guardar.
                  </Banner>
                )}
                <PermissionMatrixPanel
                  sections={matrixSections}
                  effective={effectiveResult.effective}
                  grantedBy={effectiveResult.grantedBy}
                  rolesById={rolesById}
                  permLabels={permLabels}
                  overrides={overrides}
                  redundantOverrides={effectiveResult.redundantOverrides}
                  selectedCount={selectedRoleIds.size}
                  onTogglePermission={togglePermission}
                  onResetOverrides={() => setOverrides(new Map())}
                  onSaveAsRole={() => onOpenCustomEditor({
                    roleId: null,
                    initialKeys: [...effectiveResult.effective],
                    intent: 'reusable',
                    suggestedName: `Perfil de ${usuarioNombre}`,
                  })}
                />
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 24px', borderTop: '1px solid var(--at-line)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
        }}>
          <div style={{ fontSize: '12px', color: error ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>{error ?? ''}</div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={onClose} style={{
              padding: '8px 18px', borderRadius: '8px', border: '1px solid var(--at-line)',
              background: 'var(--at-surface)', color: 'var(--at-ink-2)', fontWeight: 600, fontSize: '13px', cursor: 'pointer',
            }}>Cancelar</button>
            <button onClick={() => void handleSave()} disabled={saving || loading} style={{
              padding: '8px 20px', borderRadius: '8px', border: 'none',
              background: saving ? 'var(--at-accent-2)' : 'var(--at-primary-2)', color: 'white',
              fontWeight: 600, fontSize: '13px', cursor: saving ? 'default' : 'pointer',
            }}>{saving ? 'Guardando…' : 'Guardar roles'}</button>
          </div>
        </div>
      </div>
    </div>
    </ModalPortal>
  )
}
