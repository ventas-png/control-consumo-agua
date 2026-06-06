// T7 / plat:P12 — Extraído de EmpresaSection.
// Sección de usuarios de la empresa: barra de acciones (reportes, trazabilidad,
// papelera, auditoría, alta), banner de ayuda RBAC, lista de usuarios con sus
// chips de rol y acciones (asignar acceso, roles/permisos, activar, eliminar),
// y todos los modales asociados. Posee su propio estado de modales y las
// mutaciones de usuario; refresca la vista vía `onReload`.
import { useState } from 'react'
import { notify } from '../shared/Dialog'
import { openPromptDialog } from '../shared/PromptDialog'
import { createCompanyUser, deleteCompanyUser, setUsuarioActivo } from '../../domain/empresa/usuarios'
import { insertUserRoles } from '../../domain/empresa/roles'
import type { UserSession, Proyecto } from '../../types'
import { AsignacionModal } from './AsignacionModal'
import { RolPermisosModal } from './RolPermisosModal'
import { CustomRoleEditor } from './CustomRoleEditor'
import { AuditLogModal } from './AuditLogModal'
import { FinancialAuditModal } from './FinancialAuditModal'
import { PapeleraModal } from './PapeleraModal'
import { SavedReportsModal } from './SavedReportsModal'
import { SYSTEM_ROLE_IDS, type AguaSystemRoleKey, type CondominiosSystemRoleKey } from '../../lib/systemRoleIds'
import { CONDOMINIOS_ROLES } from '../../lib/condominiosRoles'
import type { Usuario } from '../../domain/empresa/queries'

interface Props {
  currentUser: UserSession
  usuarios: Usuario[]
  proyectos: Proyecto[]
  onReload: () => void
}

export function EmpresaUsuariosSection({ currentUser, usuarios, proyectos, onReload }: Props) {
  const [usuarioAsignar, setUsuarioAsignar] = useState<Usuario | null>(null)
  const [rolCondModal, setRolCondModal] = useState<Usuario | null>(null)
  const [customRoleEditor, setCustomRoleEditor] = useState<{ roleId: string | null } | null>(null)
  const [rolesRefreshKey, setRolesRefreshKey] = useState(0)
  const [showAuditLog, setShowAuditLog] = useState(false)
  const [showFinancialAudit, setShowFinancialAudit] = useState(false)
  const [showPapelera, setShowPapelera] = useState(false)
  const [showSavedReports, setShowSavedReports] = useState(false)

  async function crearAdmin() {
    const showAgua = currentUser.servicio_agua !== false
    const showCond = currentUser.servicio_condominios !== false

    const fields: Array<Parameters<typeof openPromptDialog>[0]['fields'][number]> = [
      { name: 'nombre', label: 'Nombre completo', required: true, autoFocus: true },
      { name: 'email', label: 'Correo electrónico', type: 'email', required: true, autoComplete: 'email' },
      { name: 'password', label: 'Contraseña temporal', type: 'password', required: true, helpText: 'Mínimo 8 caracteres' },
    ]
    if (showAgua) {
      fields.push(
        { name: 'aguaEnabled', label: '💧 Acceso a Control de Agua', control: 'checkbox' },
        {
          name: 'aguaRol',
          label: 'Rol en Agua',
          control: 'select',
          initialValue: 'viewer',
          options: [
            { value: 'admin', label: 'Administrador — acceso completo' },
            { value: 'operator', label: 'Operador — lecturas y operaciones' },
            { value: 'collector', label: 'Gestor de Cobros' },
            { value: 'viewer', label: 'Visualizador — solo lectura' },
          ],
        },
      )
    }
    if (showCond) {
      fields.push(
        { name: 'condEnabled', label: '🏢 Acceso a Condominios', control: 'checkbox' },
        {
          name: 'condRol',
          label: 'Rol en Condominios',
          control: 'select',
          options: CONDOMINIOS_ROLES.map(r => ({ value: r.id, label: r.label })),
        },
      )
    }

    const result = await openPromptDialog({
      title: 'Nuevo Usuario',
      description: 'Marca las aplicaciones a las que debe tener acceso y elige el rol.',
      fields,
      submitText: 'Crear usuario',
      validate: (data) => {
        if (!data.nombre?.trim() || !data.email?.trim() || !data.password) {
          return 'Nombre, correo y contraseña son obligatorios'
        }
        if (data.password.length < 8) return 'La contraseña debe tener al menos 8 caracteres'
        const aguaEnabled = showAgua && data.aguaEnabled === 'true'
        const condEnabled = showCond && data.condEnabled === 'true'
        if (!aguaEnabled && !condEnabled) return 'Selecciona acceso a al menos una aplicación'
        if (condEnabled && !data.condRol) return 'Selecciona un rol para Condominios'
        return null
      },
    })

    if (!result) return
    const aguaEnabled = showAgua && result.aguaEnabled === 'true'
    const condEnabled = showCond && result.condEnabled === 'true'
    const aguaRol = aguaEnabled ? result.aguaRol : null
    const condRol = condEnabled ? (result.condRol || null) : null
    // El tier de plataforma (app_users.role) NO debe ser un rol exento.
    // 'admin' salta TODO el RBAC (condominios incluido) vía user_has_permission,
    // así que un "Admin de Agua" se crea como 'operator' (no exento) y recibe
    // su poder de agua desde el rol RBAC "Admin Agua" (user_roles), no del tier.
    const platformTier = aguaRol === 'admin' ? 'operator' : (aguaRol ?? 'viewer')
    const formValues = {
      nombre: result.nombre.trim(),
      email: result.email.trim(),
      password: result.password,
      rol: platformTier,
      aguaRol,
      condRol,
    }

    try {
      const { userId, error } = await createCompanyUser({
        email: formValues.email,
        password: formValues.password,
        full_name: formValues.nombre,
        role: formValues.rol,
        company_id: currentUser.company_id,
      })

      if (error) {
        notify({ variant: 'error', title: 'Error al crear usuario', text: error })
        return
      }
      if (!userId) return

      // Assign RBAC roles via user_roles. With the legacy columns dropped,
      // user_roles is the sole source of truth for permissions.
      const newAssignments: { user_id: string; role_id: string }[] = []
      if (formValues.aguaRol && formValues.aguaRol in SYSTEM_ROLE_IDS.agua) {
        newAssignments.push({
          user_id: userId,
          role_id: SYSTEM_ROLE_IDS.agua[formValues.aguaRol as AguaSystemRoleKey],
        })
      }
      if (formValues.condRol && formValues.condRol in SYSTEM_ROLE_IDS.condominios) {
        newAssignments.push({
          user_id: userId,
          role_id: SYSTEM_ROLE_IDS.condominios[formValues.condRol as CondominiosSystemRoleKey],
        })
      }
      if (newAssignments.length > 0) {
        await insertUserRoles(newAssignments)
      }

      notify({ variant: 'success', title: 'Usuario creado', duration: 1500 })
      onReload()
    } catch (err) {
      console.error('create-user request failed:', err)
      notify({ variant: 'error', title: 'Error de conexión', text: 'No se pudo contactar el servicio de creación de usuarios. Intente nuevamente; si el problema persiste, contacte al soporte técnico.' })
    }
  }

  // Note: agua and condominios role assignment is handled by the unified
  // RolPermisosModal, which writes directly to user_roles.

  async function toggleActivoUsuario(usuario: Usuario) {
    await setUsuarioActivo(usuario.id, !usuario.activo)
    onReload()
  }

  async function eliminarUsuario(usuario: Usuario) {
    const result = await openPromptDialog({
      title: 'Eliminar usuario definitivamente',
      description: `Esta acción no se puede deshacer. Se eliminarán el acceso y el perfil de ${usuario.full_name}. Los registros que haya creado se conservan, pero quedarán sin autor asignado.`,
      fields: [{
        name: 'confirmacion',
        label: `Para confirmar, escribe el nombre del usuario`,
        placeholder: usuario.full_name,
        required: true,
        autoFocus: true,
      }],
      submitText: 'Eliminar definitivamente',
      validate: (data) =>
        (data.confirmacion ?? '').trim().toLowerCase() === usuario.full_name.trim().toLowerCase()
          ? null
          : 'El nombre no coincide',
    })
    if (!result) return

    try {
      const { error } = await deleteCompanyUser(usuario.id)
      if (error) {
        notify({ variant: 'error', title: 'No se pudo eliminar', text: error })
        return
      }

      notify({ variant: 'success', title: 'Usuario eliminado', duration: 1500 })
      onReload()
    } catch (err) {
      console.error('delete-user request failed:', err)
      notify({ variant: 'error', title: 'Error de conexión', text: 'No se pudo contactar el servicio de eliminación. Intente nuevamente; si el problema persiste, contacte al soporte técnico.' })
    }
  }

  const roleBadgeColor: Record<string, string> = {
    admin: 'var(--at-primary)',
    operator: 'var(--at-success)', operador: 'var(--at-success)',
    viewer: 'var(--at-accent)', visor: 'var(--at-accent)',
    collector: 'var(--at-warning)',
  }

  // Who can permanently delete users, and which target roles are deletable.
  // Mirrors the server-side checks in the delete-user edge function so the button
  // only appears when the action would actually succeed.
  const isSuperAdmin = currentUser.role === 'super_admin'
  const canDeleteUsers = isSuperAdmin || currentUser.role === 'company_owner' || currentUser.role === 'admin'
  const DELETABLE_TARGET_ROLES = ['admin', 'operator', 'operador', 'viewer', 'visor', 'collector']

  return (
    <>
      {/* Usuarios */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h2 style={{ color: 'var(--at-ink)', fontSize: '16px', fontWeight: 600, margin: 0 }}>Usuarios de la Empresa</h2>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              onClick={() => setShowSavedReports(true)}
              title="Reportes guardados (F4.5.1)"
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '9px 14px', borderRadius: '8px',
                border: '1px solid var(--at-line-strong)',
                background: 'var(--at-surface-2)', color: 'var(--at-ink-2)',
                cursor: 'pointer', fontSize: '13px', fontWeight: 600,
              }}
            >
              📑 Reportes
            </button>
            <button
              onClick={() => setShowFinancialAudit(true)}
              title="Trazabilidad financiera y de mantenimiento (audit_log generico de F2.7)"
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '9px 14px', borderRadius: '8px',
                border: '1px solid var(--at-line-strong)',
                background: 'var(--at-surface-2)', color: 'var(--at-ink-2)',
                cursor: 'pointer', fontSize: '13px', fontWeight: 600,
              }}
            >
              📊 Trazabilidad
            </button>
            <button
              onClick={() => setShowPapelera(true)}
              title="Papelera — restaurar registros borrados"
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '9px 14px', borderRadius: '8px',
                border: '1px solid var(--at-line-strong)',
                background: 'var(--at-surface-2)', color: 'var(--at-ink-2)',
                cursor: 'pointer', fontSize: '13px', fontWeight: 600,
              }}
            >
              🗑️ Papelera
            </button>
            <button
              onClick={() => setShowAuditLog(true)}
              title="Auditoría de roles y permisos"
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '9px 14px', borderRadius: '8px',
                border: '1px solid var(--at-line-strong)',
                background: 'var(--at-surface-2)', color: 'var(--at-ink-2)',
                cursor: 'pointer', fontSize: '13px', fontWeight: 600,
              }}
            >
              📜 Auditoría
            </button>
            <button
              onClick={() => void crearAdmin()}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '9px 16px', borderRadius: '8px', border: 'none',
                background: 'linear-gradient(135deg, var(--at-accent), var(--at-accent-hover))',
                color: 'white', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
              }}
            >
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
              Nuevo Usuario
            </button>
          </div>
        </div>

        {(currentUser.role === 'company_owner' || currentUser.role === 'admin') && (
          <div style={{
            background: 'var(--at-accent-tint)',
            border: '1px solid var(--at-accent-soft)',
            borderRadius: '10px', padding: '10px 14px', marginBottom: '12px',
            display: 'flex', alignItems: 'flex-start', gap: '10px',
            color: 'var(--at-ink-2)', fontSize: '12px', lineHeight: 1.5,
          }}>
            <span style={{ color: 'var(--at-accent-light)', fontSize: '14px', lineHeight: 1, marginTop: '1px' }}>💡</span>
            <div>
              <strong style={{ color: 'var(--at-ink)' }}>Personalización fina de permisos:</strong>{' '}
              Asigna un rol del sistema desde el botón <em>Roles y permisos</em> en cada usuario.
              Si necesitas un perfil distinto, crea un <em>rol personalizado</em> desde el mismo modal y
              ajusta exactamente qué tabs/acciones permite. Los cambios se auditan en{' '}
              <span style={{ color: 'var(--at-accent-light)' }}>📜 Auditoría</span>.
            </div>
          </div>
        )}

        {usuarios.length === 0 ? (
          <div style={{
            background: 'var(--at-surface-2)', border: '1px dashed var(--at-line)',
            borderRadius: '12px', padding: '32px', textAlign: 'center',
          }}>
            <p style={{ color: 'var(--at-ink-2)', margin: 0 }}>No hay usuarios. Agrega el primero.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {usuarios.map(u => (
              <div key={u.id} style={{
                background: 'var(--at-surface)', borderRadius: '12px', padding: '14px 18px',
                border: '1px solid var(--at-line)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
                flexWrap: 'wrap',
                opacity: u.activo ? 1 : 0.5,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: '160px' }}>
                  <div style={{
                    width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
                    background: `${roleBadgeColor[u.role] ?? 'var(--at-ink-3)'}22`,
                    border: `1px solid ${roleBadgeColor[u.role] ?? 'var(--at-ink-3)'}44`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: roleBadgeColor[u.role] ?? 'var(--at-ink-3)', fontSize: '13px', fontWeight: 700,
                  }}>
                    {u.full_name.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: 'var(--at-ink)', fontWeight: 600, fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {u.full_name}
                    </div>
                    <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginTop: '3px' }}>
                      {(u.assigned_roles ?? []).map(r => {
                        const icon = r.service === 'agua' ? '💧' : r.service === 'condominios' ? '🏢' : '⚙️'
                        return (
                          <span key={r.id} style={{
                            padding: '1px 8px', borderRadius: '20px',
                            fontSize: '11px', fontWeight: 600,
                            background: r.color + '22', color: r.color,
                          }}>
                            {icon} {r.name}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => setUsuarioAsignar(u)}
                    title="Asignar acceso a proyectos"
                    style={{
                      display: 'flex', alignItems: 'center', gap: '5px',
                      padding: '6px 10px', borderRadius: '7px', border: '1px solid var(--at-primary-soft)',
                      background: 'var(--at-primary-tint)', color: 'var(--at-accent-2)',
                      cursor: 'pointer', fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap',
                    }}
                  >
                    <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                    </svg>
                    Acceso
                  </button>
                  <button
                    onClick={() => setRolCondModal(u)}
                    title="Roles y permisos (agua, condominios y plataforma)"
                    style={{
                      display: 'flex', alignItems: 'center', gap: '5px',
                      padding: '6px 10px', borderRadius: '7px', border: '1px solid var(--at-primary-soft)',
                      background: 'var(--at-primary-tint)', color: 'var(--at-accent-2)',
                      cursor: 'pointer', fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap',
                    }}
                  >
                    🔑 Roles y permisos
                  </button>
                  <button
                    onClick={() => void toggleActivoUsuario(u)}
                    title={u.activo ? 'Desactivar' : 'Activar'}
                    style={{
                      padding: '6px 10px', borderRadius: '7px', whiteSpace: 'nowrap',
                      border: `1px solid ${u.activo ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
                      background: u.activo ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)',
                      color: u.activo ? 'var(--at-danger)' : 'var(--at-success)',
                      cursor: 'pointer', fontSize: '12px', fontWeight: 600,
                    }}
                  >
                    {u.activo ? 'Desactivar' : 'Activar'}
                  </button>
                  {canDeleteUsers && (isSuperAdmin || DELETABLE_TARGET_ROLES.includes(u.role)) && (
                    <button
                      onClick={() => void eliminarUsuario(u)}
                      title="Eliminar definitivamente"
                      style={{
                        display: 'flex', alignItems: 'center', gap: '5px',
                        padding: '6px 10px', borderRadius: '7px', whiteSpace: 'nowrap',
                        border: '1px solid var(--at-danger)',
                        background: 'var(--at-danger)', color: '#fff',
                        cursor: 'pointer', fontSize: '12px', fontWeight: 600,
                      }}
                    >
                      <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      Eliminar
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal de asignación de proyectos */}
      {usuarioAsignar && (
        <AsignacionModal
          usuario={usuarioAsignar}
          proyectos={proyectos}

          onClose={() => setUsuarioAsignar(null)}
          onSaved={() => onReload()}
        />
      )}

      {/* Modal de roles y permisos (RBAC) */}
      {rolCondModal && currentUser.company_id && (
        <RolPermisosModal
          usuarioId={rolCondModal.id}
          usuarioNombre={rolCondModal.full_name}
          companyId={currentUser.company_id}
          rolesRefreshKey={rolesRefreshKey}
          onClose={() => setRolCondModal(null)}
          onSaved={() => onReload()}
          onOpenCustomEditor={(roleId) => setCustomRoleEditor({ roleId })}
        />
      )}

      {/* Editor de rol personalizado */}
      {customRoleEditor && currentUser.company_id && (
        <CustomRoleEditor
          companyId={currentUser.company_id}
          roleId={customRoleEditor.roleId}
          onClose={() => setCustomRoleEditor(null)}
          onSaved={() => setRolesRefreshKey(k => k + 1)}
        />
      )}

      {/* Modal de auditoría */}
      {showFinancialAudit && (
        <FinancialAuditModal onClose={() => setShowFinancialAudit(false)} />
      )}
      {showPapelera && (
        <PapeleraModal onClose={() => setShowPapelera(false)} />
      )}
      {showSavedReports && currentUser.company_id && (
        <SavedReportsModal onClose={() => setShowSavedReports(false)} companyId={currentUser.company_id} />
      )}
      {showAuditLog && (
        <AuditLogModal onClose={() => setShowAuditLog(false)} />
      )}
    </>
  )
}
