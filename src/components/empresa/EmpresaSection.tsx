import { useState, useEffect, useCallback } from 'react'
import { notify } from '../shared/Dialog'
import { openTextPrompt, openPromptDialog } from '../shared/PromptDialog'
import { supabase } from '../../lib/supabase'
import type { UserSession, Proyecto } from '../../types'
import { MONEDAS } from '../../types'
import { SecureImage } from '../shared/SecureImage'
import { AsignacionModal } from './AsignacionModal'
import { StripePayPalConfig } from './StripePayPalConfig'
import { GoogleEmailConfig } from './GoogleEmailConfig'
import { RolPermisosModal } from './RolPermisosModal'
import { CustomRoleEditor } from './CustomRoleEditor'
import { AuditLogModal } from './AuditLogModal'
import { SYSTEM_ROLE_IDS, type AguaSystemRoleKey, type CondominiosSystemRoleKey } from '../../lib/systemRoleIds'
import { CONDOMINIOS_ROLES } from '../../lib/condominiosRoles'
import { usePlanLimits } from '../../hooks/usePlanLimits'
import { promptUpgrade } from '../shared/promptUpgrade'

const ESTADO_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  activo:     { label: 'Activo',     bg: 'rgba(34,197,94,0.15)',  color: 'var(--at-success)' },
  inactivo:   { label: 'Inactivo',   bg: 'rgba(100,116,139,0.2)', color: 'var(--at-ink-3)' },
  suspendido: { label: 'Suspendido', bg: 'rgba(245,158,11,0.15)', color: 'var(--at-warning)' },
}

const TIPOS_UNIDAD_LABELS: { key: keyof Proyecto; label: string }[] = [
  { key: 'max_unidades_apartamento',     label: 'Apartamentos' },
  { key: 'max_unidades_casa',            label: 'Casas' },
  { key: 'max_unidades_bodega',          label: 'Bodegas' },
  { key: 'max_unidades_local_comercial', label: 'Locales Comerciales' },
  { key: 'max_unidades_oficina',         label: 'Oficinas' },
  { key: 'max_unidades_parqueadero',     label: 'Parqueaderos' },
  { key: 'max_unidades_otro',            label: 'Otros' },
]

interface Usuario {
  id: string
  full_name: string
  role: string
  activo: boolean
  // Display chips derived at fetch time from user_roles + roles join
  assigned_roles?: Array<{ id: string; name: string; color: string; service: string | null }>
}

interface EmpresaInfo {
  id: string
  nombre: string
  nit: string | null
  email: string | null
  telefono: string | null
  max_projects: number
  logo_url: string | null
}

interface Props {
  currentUser: UserSession
}

export function EmpresaSection({ currentUser }: Props) {
  const [empresa, setEmpresa] = useState<EmpresaInfo | null>(null)
  const [proyectos, setProyectos] = useState<Proyecto[]>([])
  const [usuarios, setUsuarios] = useState<Usuario[]>([])
  const [loading, setLoading] = useState(true)
  const [usuarioAsignar, setUsuarioAsignar] = useState<Usuario | null>(null)
  const [rolCondModal, setRolCondModal] = useState<Usuario | null>(null)
  const [customRoleEditor, setCustomRoleEditor] = useState<{ roleId: string | null } | null>(null)
  const [rolesRefreshKey, setRolesRefreshKey] = useState(0)
  const [showAuditLog, setShowAuditLog] = useState(false)

  // Limites efectivos del plan (F2.13). Sobrescriben empresa.max_projects
  // legacy con el resultado de get_company_effective_limits que respeta
  // grandfathered overrides via GREATEST(plan, companies.max_X).
  const planLimits = usePlanLimits(currentUser.company_id ?? null)
  const effectiveMaxProjects = planLimits.max_projects ?? empresa?.max_projects ?? Infinity

  const cargar = useCallback(async () => {
    setLoading(true)
    if (!currentUser.company_id) { setLoading(false); return }

    const [empresaRes, proyectosRes, usuariosRes] = await Promise.all([
      supabase.from('companies').select('id, nombre, nit, email, telefono, max_projects, logo_url').eq('id', currentUser.company_id).single(),
      supabase.from('projects').select('id, nombre, logo_url, descripcion, direccion, latitud, longitud, moneda, moneda_condominios, estado, max_unidades_apartamento, max_unidades_casa, max_unidades_bodega, max_unidades_local_comercial, max_unidades_oficina, max_unidades_parqueadero, max_unidades_otro').eq('company_id', currentUser.company_id).order('nombre'),
      supabase.from('app_users').select('id, full_name, role, activo')
        .eq('company_id', currentUser.company_id)
        .neq('id', currentUser.user_id)
        .order('full_name'),
    ])

    if (empresaRes.data) setEmpresa(empresaRes.data as EmpresaInfo)
    if (proyectosRes.data) setProyectos(proyectosRes.data as Proyecto[])

    if (usuariosRes.data) {
      const baseUsers = usuariosRes.data as Usuario[]
      // Fetch assigned roles for chips display
      const userIds = baseUsers.map(u => u.id)
      if (userIds.length > 0) {
        const { data: userRolesData } = await supabase
          .from('user_roles')
          .select('user_id, role:roles(id, name, color, service)')
          .in('user_id', userIds)
        type Row = { user_id: string; role: { id: string; name: string; color: string; service: string | null } | null }
        const byUser = new Map<string, NonNullable<Row['role']>[]>()
        for (const r of ((userRolesData ?? []) as unknown as Row[])) {
          if (!r.role) continue
          const arr = byUser.get(r.user_id) ?? []
          arr.push(r.role)
          byUser.set(r.user_id, arr)
        }
        for (const u of baseUsers) {
          u.assigned_roles = byUser.get(u.id) ?? []
        }
      }
      setUsuarios(baseUsers)
    }
    setLoading(false)
  }, [currentUser.company_id, currentUser.user_id])

  useEffect(() => { void cargar() }, [cargar])

  async function editarEmpresa() {
    if (!empresa) return
    // F3.4b: PromptDialog reemplaza Swal.fire con html:/preConfirm: por
    // forma type-safe con InputField accesible (label asociado, aria-required).
    const formValues = await openPromptDialog({
      title: 'Editar información de empresa',
      fields: [
        { name: 'nombre', label: 'Nombre de la empresa', required: true, initialValue: empresa.nombre },
        { name: 'nit', label: 'NIT', initialValue: empresa.nit ?? '' },
        { name: 'email', label: 'Email de contacto', type: 'email', autoComplete: 'email', initialValue: empresa.email ?? '' },
        { name: 'telefono', label: 'Teléfono', type: 'tel', autoComplete: 'tel', initialValue: empresa.telefono ?? '' },
      ],
      submitText: 'Guardar',
      validate: (data) => data.nombre.trim() ? null : 'El nombre es obligatorio',
    })
    if (!formValues) return
    const payload = {
      nombre: formValues.nombre.trim(),
      nit: formValues.nit.trim() || null,
      email: formValues.email.trim() || null,
      telefono: formValues.telefono.trim() || null,
    }
    const { error } = await supabase.from('companies').update(payload).eq('id', empresa.id)
    if (error) {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo actualizar la información.' })
    } else {
      notify({ variant: 'success', title: 'Actualizado', duration: 1200 })
      void cargar()
    }
  }

  async function subirLogo(file: File) {
    if (!empresa) return
    // Path único por upload para que cada cambio de logo produzca una signed
    // URL fresca de inmediato (el useSignedUrl reacts a la nueva value en BD).
    // Logos viejos quedan huérfanos en el bucket — cleanup mecánico pendiente.
    const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
    const path = `${empresa.id}/logo-${Date.now()}.${ext}`
    const { error: uploadError } = await supabase.storage
      .from('company-logos')
      .upload(path, file, { contentType: file.type })
    if (uploadError) {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo subir el logo.' })
      return
    }
    // Guardamos el path bare; SecureImage firma en cada render.
    await supabase.from('companies').update({ logo_url: path }).eq('id', empresa.id)
    void cargar()
  }

  async function editarProyecto(proyecto: Proyecto) {
    const monedaOptions = MONEDAS.map(m => ({ value: m.simbolo, label: `${m.simbolo} — ${m.nombre}` }))

    const fields: Array<Parameters<typeof openPromptDialog>[0]['fields'][number]> = [
      { name: 'nombre', label: 'Nombre', required: true, initialValue: proyecto.nombre, autoFocus: true },
      { name: 'descripcion', label: 'Descripción', control: 'textarea', rows: 3, initialValue: proyecto.descripcion ?? '' },
      { name: 'direccion', label: 'Dirección', placeholder: 'Ej: Calle 123 #45-67', initialValue: proyecto.direccion ?? '' },
      { name: 'latitud', label: 'Latitud', placeholder: '0.000000', initialValue: proyecto.latitud != null ? String(proyecto.latitud) : '' },
      { name: 'longitud', label: 'Longitud', placeholder: '0.000000', initialValue: proyecto.longitud != null ? String(proyecto.longitud) : '' },
      { name: 'moneda', label: '💧 Moneda Agua', control: 'select', initialValue: proyecto.moneda, options: monedaOptions },
      { name: 'moneda_condominios', label: '🏢 Moneda Condominios', control: 'select', initialValue: proyecto.moneda_condominios ?? proyecto.moneda, options: monedaOptions },
      {
        name: 'estado',
        label: 'Estado',
        control: 'select',
        initialValue: proyecto.estado ?? 'activo',
        options: [
          { value: 'activo', label: '✅ Activo' },
          { value: 'inactivo', label: '⏸ Inactivo' },
          { value: 'suspendido', label: '🚫 Suspendido' },
        ],
      },
    ]
    TIPOS_UNIDAD_LABELS.forEach(t => {
      const val = proyecto[t.key] as number | null | undefined
      fields.push({
        name: t.key,
        label: `${t.label} (límite)`,
        type: 'number',
        min: 0,
        step: 1,
        placeholder: '∞',
        initialValue: val != null ? String(val) : '',
        helpText: 'Dejar vacío = sin límite',
      })
    })

    const result = await openPromptDialog({
      title: 'Editar Proyecto',
      fields,
      submitText: 'Guardar',
      validate: (data) => data.nombre?.trim() ? null : 'El nombre es obligatorio',
    })

    if (!result) return
    const getLimit = (key: string): number | null => {
      const v = (result[key] ?? '').trim()
      if (!v) return null
      const n = parseInt(v, 10)
      return isNaN(n) || n < 0 ? null : n
    }
    const formValues = {
      nombre: result.nombre.trim(),
      descripcion: result.descripcion?.trim() || null,
      direccion: result.direccion?.trim() || null,
      latitud: result.latitud?.trim() ? parseFloat(result.latitud) : null,
      longitud: result.longitud?.trim() ? parseFloat(result.longitud) : null,
      moneda: result.moneda,
      moneda_condominios: result.moneda_condominios,
      estado: result.estado,
      max_unidades_apartamento: getLimit('max_unidades_apartamento'),
      max_unidades_casa: getLimit('max_unidades_casa'),
      max_unidades_bodega: getLimit('max_unidades_bodega'),
      max_unidades_local_comercial: getLimit('max_unidades_local_comercial'),
      max_unidades_oficina: getLimit('max_unidades_oficina'),
      max_unidades_parqueadero: getLimit('max_unidades_parqueadero'),
      max_unidades_otro: getLimit('max_unidades_otro'),
    }
    const { error } = await supabase.from('projects').update(formValues).eq('id', proyecto.id)
    if (error) {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo actualizar el proyecto.' })
    } else {
      notify({ variant: 'success', title: 'Proyecto actualizado', duration: 1200 })
      void cargar()
    }
  }

  async function cambiarEstadoProyecto(proyecto: Proyecto) {
    const estados: Proyecto['estado'][] = ['activo', 'inactivo', 'suspendido']
    const actual = proyecto.estado ?? 'activo'
    const config = ESTADO_CONFIG[actual]

    const result = await openPromptDialog({
      title: 'Cambiar estado del proyecto',
      description: `Estado actual: ${config.label}`,
      fields: [{
        name: 'estado',
        label: 'Nuevo estado',
        control: 'select',
        required: true,
        options: estados.filter(e => e !== actual).map(e => ({
          value: e ?? 'activo',
          label: ESTADO_CONFIG[e ?? 'activo'].label,
        })),
        autoFocus: true,
      }],
      submitText: 'Cambiar estado',
    })
    if (!result) return
    const nuevoEstado = result.estado as Proyecto['estado']
    if (!nuevoEstado) return
    await aplicarCambioEstado(proyecto.id, nuevoEstado)
  }

  async function aplicarCambioEstado(id: string, estado: Proyecto['estado']) {
    const { error } = await supabase.from('projects').update({ estado }).eq('id', id)
    if (error) {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo cambiar el estado.' })
    } else {
      void cargar()
    }
  }

  async function subirLogoProyecto(proyectoId: string, file: File) {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
    const path = `${proyectoId}/logo-${Date.now()}.${ext}`
    const { error: uploadError } = await supabase.storage
      .from('project-logos')
      .upload(path, file, { contentType: file.type })
    if (uploadError) {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo subir el logo del proyecto.' })
      return
    }
    await supabase.from('projects').update({ logo_url: path }).eq('id', proyectoId)
    void cargar()
  }

  async function crearProyecto() {
    if (!empresa) return
    if (proyectos.length >= effectiveMaxProjects) {
      // F4.1.2: en lugar de un notify informativo, modal con CTA "Ver planes"
      // que navega a Perfil → Mi plan con auto-scroll y plan picker abierto.
      await promptUpgrade({
        resource: 'project',
        current: proyectos.length,
        limit: effectiveMaxProjects,
      })
      return
    }

    // F3.4b: openTextPrompt accesible — antes Swal.fire con input:'text'
    // y inputValidator. Devuelve string|null sin que el caller maneje
    // formValues.value.
    const nombre = await openTextPrompt({
      title: 'Nuevo Proyecto',
      label: 'Nombre del proyecto',
      placeholder: 'Ej: Proyecto Norte',
      required: true,
      validate: (v) => !v.trim() ? 'El nombre es obligatorio' : null,
    })

    if (!nombre) return

    const { error } = await supabase.from('projects').insert({
      nombre: nombre.trim(),
      company_id: currentUser.company_id,
    })

    if (error) {
      notify({ variant: 'error', title: 'Error', text: 'No se pudo crear el proyecto.' })
    } else {
      notify({ variant: 'success', title: 'Proyecto creado', duration: 1500 })
      void cargar()
    }
  }

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
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
      const res = await fetch(`${supabaseUrl}/functions/v1/create-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token ?? ''}` },
        body: JSON.stringify({
          email: formValues.email,
          password: formValues.password,
          full_name: formValues.nombre,
          role: formValues.rol,
          company_id: currentUser.company_id,
        }),
      })

      if (!res.ok) {
        const err = await res.json() as { error?: string }
        notify({ variant: 'error', title: 'Error al crear usuario', text: err.error ?? 'No se pudo crear el usuario.' })
        return
      }

      const created = await res.json() as { user_id?: string }
      if (!created.user_id) return

      // Assign RBAC roles via user_roles. With the legacy columns dropped,
      // user_roles is the sole source of truth for permissions.
      const newAssignments: { user_id: string; role_id: string }[] = []
      if (formValues.aguaRol && formValues.aguaRol in SYSTEM_ROLE_IDS.agua) {
        newAssignments.push({
          user_id: created.user_id,
          role_id: SYSTEM_ROLE_IDS.agua[formValues.aguaRol as AguaSystemRoleKey],
        })
      }
      if (formValues.condRol && formValues.condRol in SYSTEM_ROLE_IDS.condominios) {
        newAssignments.push({
          user_id: created.user_id,
          role_id: SYSTEM_ROLE_IDS.condominios[formValues.condRol as CondominiosSystemRoleKey],
        })
      }
      if (newAssignments.length > 0) {
        await supabase.from('user_roles').insert(newAssignments)
      }

      notify({ variant: 'success', title: 'Usuario creado', duration: 1500 })
      void cargar()
    } catch (err) {
      console.error('create-user request failed:', err)
      notify({ variant: 'error', title: 'Error de conexión', text: 'No se pudo contactar el servicio de creación de usuarios. Intente nuevamente; si el problema persiste, contacte al soporte técnico.' })
    }
  }

  // Note: agua and condominios role assignment is handled by the unified
  // RolPermisosModal, which writes directly to user_roles.

  async function toggleActivoUsuario(usuario: Usuario) {
    await supabase.from('app_users').update({ activo: !usuario.activo }).eq('id', usuario.id)
    void cargar()
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
      const { data: session } = await supabase.auth.getSession()
      const token = session.session?.access_token
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
      const res = await fetch(`${supabaseUrl}/functions/v1/delete-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token ?? ''}` },
        body: JSON.stringify({ user_id: usuario.id }),
      })

      if (!res.ok) {
        const err = await res.json() as { error?: string }
        notify({ variant: 'error', title: 'No se pudo eliminar', text: err.error ?? 'No se pudo eliminar el usuario.' })
        return
      }

      notify({ variant: 'success', title: 'Usuario eliminado', duration: 1500 })
      void cargar()
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

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px' }}>
        <span style={{ color: 'var(--at-ink-3)', fontSize: '16px' }}>Cargando...</span>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      {/* Input de archivo oculto para subir logo */}
      <input
        id="logo-upload"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) void subirLogo(f) }}
      />

      {/* Header empresa */}
      <div className="empresa-card" style={{
        background: 'var(--at-surface)',
        borderRadius: '16px', padding: '24px 24px 20px', marginBottom: '24px',
        border: '1px solid var(--at-line)',
      }}>
        <div className="empresa-header-inner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
          {/* Left: logo + info */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '14px' }}>
            {/* Avatar logo */}
            <div
              onClick={() => document.getElementById('logo-upload')?.click()}
              title="Haz clic para cambiar el logo"
              style={{
                width: 56, height: 56, borderRadius: 12, overflow: 'hidden',
                cursor: 'pointer', flexShrink: 0,
                border: '2px solid var(--at-line)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              }}
            >
              {empresa?.logo_url
                ? <SecureImage bucket="company-logos" src={empresa.logo_url} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <div style={{
                    background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))',
                    width: '100%', height: '100%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: 'white', fontSize: 22, fontWeight: 700,
                  }}>
                    {empresa?.nombre?.[0]?.toUpperCase() ?? 'E'}
                  </div>
              }
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '4px' }}>
                <h1 style={{ color: 'var(--at-ink)', fontSize: '20px', fontWeight: 700, margin: 0, lineHeight: 1.2 }}>
                  {empresa?.nombre ?? 'Mi Empresa'}
                </h1>
              </div>
              <div className="empresa-info-row" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '6px' }}>
                {empresa?.nit && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--at-ink-3)', fontSize: '12px' }}>
                    <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    NIT: {empresa.nit}
                  </span>
                )}
                {empresa?.email && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--at-ink-3)', fontSize: '12px' }}>
                    <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                    {empresa.email}
                  </span>
                )}
                {empresa?.telefono && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--at-ink-3)', fontSize: '12px' }}>
                    <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                    {empresa.telefono}
                  </span>
                )}
                {!empresa?.nit && !empresa?.email && !empresa?.telefono && (
                  <span style={{ color: 'var(--at-ink-2)', fontSize: '12px', fontStyle: 'italic' }}>Sin datos de contacto</span>
                )}
              </div>
            </div>
          </div>

          {/* Right: stats + edit button */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px', flexShrink: 0 }}>
            <div className="empresa-stats-box" style={{
              background: 'var(--at-primary-tint)', border: '1px solid var(--at-primary-soft)',
              borderRadius: '10px', padding: '10px 16px', textAlign: 'center',
            }}>
              <div style={{ color: 'var(--at-accent-2)', fontSize: '22px', fontWeight: 700, lineHeight: 1 }}>
                {proyectos.length}<span style={{ color: 'var(--at-ink-3)', fontSize: '15px' }}>/{planLimits.max_projects ?? empresa?.max_projects ?? 5}</span>
              </div>
              <div style={{ color: 'var(--at-ink-3)', fontSize: '11px', marginTop: '3px' }}>proyectos</div>
            </div>
            <button
              onClick={() => void editarEmpresa()}
              style={{
                padding: '7px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                border: '1px solid var(--at-line-strong)', background: 'var(--at-surface-2)',
                color: 'var(--at-ink-2)', cursor: 'pointer', whiteSpace: 'nowrap',
                transition: 'background 0.15s',
              }}
            >
              Editar información
            </button>
          </div>
        </div>
      </div>

      {/* Proyectos */}
      <div style={{ marginBottom: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h2 style={{ color: 'var(--at-ink)', fontSize: '16px', fontWeight: 600, margin: 0 }}>Proyectos</h2>
          <button
            onClick={() => void crearProyecto()}
            disabled={proyectos.length >= effectiveMaxProjects}
            title={proyectos.length >= effectiveMaxProjects ? 'Límite del plan alcanzado. Actualiza desde Perfil → Mi plan.' : undefined}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '9px 16px', borderRadius: '8px', border: 'none',
              background: proyectos.length >= effectiveMaxProjects
                ? 'var(--at-ink-2)' : 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
              color: proyectos.length >= effectiveMaxProjects ? 'var(--at-ink-3)' : 'white',
              cursor: proyectos.length >= effectiveMaxProjects ? 'not-allowed' : 'pointer',
              fontSize: '13px', fontWeight: 600,
            }}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Nuevo Proyecto
          </button>
        </div>

        {proyectos.length === 0 ? (
          <div style={{
            background: 'var(--at-surface-2)', border: '1px dashed var(--at-line)',
            borderRadius: '12px', padding: '32px', textAlign: 'center',
          }}>
            <p style={{ color: 'var(--at-ink-2)', margin: 0 }}>No hay proyectos. Crea el primero.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: '14px' }}>
            {proyectos.map(p => {
              const estadoCfg = ESTADO_CONFIG[p.estado ?? 'activo']
              return (
              <div key={p.id} className="proyecto-card" style={{
                background: 'var(--at-surface)', borderRadius: '14px',
                border: '1px solid var(--at-line)',
                overflow: 'hidden',
                borderTop: `3px solid ${estadoCfg.color}`,
              }}>
                {/* Input oculto para logo de este proyecto */}
                <input
                  id={`proj-logo-${p.id}`}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) void subirLogoProyecto(p.id, f) }}
                />
                {/* Cabecera de la tarjeta */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px 12px' }}>
                  {/* Avatar/logo del proyecto */}
                  <div
                    onClick={() => document.getElementById(`proj-logo-${p.id}`)?.click()}
                    title="Clic para cambiar logo"
                    style={{
                      width: 42, height: 42, borderRadius: 10, overflow: 'hidden',
                      cursor: 'pointer', flexShrink: 0,
                      border: '1px solid var(--at-line)',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                    }}
                  >
                    {p.logo_url
                      ? <SecureImage bucket="project-logos" src={p.logo_url} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <div style={{
                          background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))',
                          width: '100%', height: '100%',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: 'white', fontSize: 16, fontWeight: 700,
                        }}>
                          {p.nombre[0]?.toUpperCase()}
                        </div>
                    }
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '3px' }}>
                      <span style={{ color: 'var(--at-ink)', fontWeight: 600, fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.nombre}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', alignItems: 'center' }}>
                      {/* Estado badge */}
                      <span style={{
                        fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px',
                        background: estadoCfg.bg, color: estadoCfg.color, whiteSpace: 'nowrap',
                      }}>
                        {estadoCfg.label}
                      </span>
                      {/* Moneda badge */}
                      <span style={{
                        fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '20px',
                        background: 'var(--at-primary-tint)', color: 'var(--at-accent-2)', whiteSpace: 'nowrap',
                      }}>
                        {p.moneda ?? 'Q'}
                      </span>
                      <span style={{ color: 'var(--at-ink-2)', fontSize: '10px', fontFamily: 'monospace' }}>
                        {p.id.slice(0, 6)}…
                      </span>
                    </div>
                  </div>
                  {/* Side buttons (hidden on mobile) */}
                  <div className="proyecto-btn-side" style={{ flexDirection: 'column', gap: '4px', flexShrink: 0 }}>
                    <button
                      onClick={() => void editarProyecto(p)}
                      title="Editar proyecto"
                      style={{
                        padding: '5px 12px', borderRadius: '7px', border: '1px solid var(--at-line-strong)',
                        background: 'var(--at-surface-2)', color: 'var(--at-ink-3)',
                        cursor: 'pointer', fontSize: '12px', fontWeight: 500,
                      }}
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => void cambiarEstadoProyecto(p)}
                      title="Cambiar estado"
                      style={{
                        padding: '4px 12px', borderRadius: '7px',
                        border: `1px solid ${estadoCfg.color}44`,
                        background: estadoCfg.bg,
                        color: estadoCfg.color,
                        cursor: 'pointer', fontSize: '11px', fontWeight: 600,
                      }}
                    >
                      Estado
                    </button>
                  </div>
                </div>
                {/* Datos del proyecto */}
                {(p.descripcion || p.direccion || (p.latitud && p.longitud)) && (
                  <div style={{
                    padding: '10px 16px 12px',
                    borderTop: '1px solid var(--at-line)',
                  }}>
                    {p.descripcion && (
                      <p style={{ color: 'var(--at-ink-3)', fontSize: '12px', margin: '0 0 6px', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {p.descripcion}
                      </p>
                    )}
                    {p.direccion && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--at-ink-2)', fontSize: '11px', marginBottom: '3px' }}>
                        <span>📍</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.direccion}</span>
                      </div>
                    )}
                    {p.latitud && p.longitud && (
                      <div style={{ color: 'var(--at-ink-2)', fontSize: '10px', fontFamily: 'monospace' }}>
                        {p.latitud.toFixed(5)}, {p.longitud.toFixed(5)}
                      </div>
                    )}
                  </div>
                )}
                {/* Footer buttons (shown on mobile only) */}
                <div className="proyecto-btn-footer" style={{
                  gap: '8px', padding: '10px 14px',
                  borderTop: '1px solid var(--at-line)',
                  background: 'var(--at-surface-2)',
                }}>
                  <button
                    onClick={() => void editarProyecto(p)}
                    style={{
                      flex: 1, padding: '9px 0', borderRadius: '8px',
                      border: '1px solid var(--at-line-strong)',
                      background: 'var(--at-surface-2)', color: 'var(--at-ink-2)',
                      cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                    }}
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => void cambiarEstadoProyecto(p)}
                    style={{
                      flex: 1, padding: '9px 0', borderRadius: '8px',
                      border: `1px solid ${estadoCfg.color}55`,
                      background: estadoCfg.bg,
                      color: estadoCfg.color,
                      cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                    }}
                  >
                    Estado
                  </button>
                </div>
              </div>
            )})}
          </div>
        )}
      </div>

      {/* Usuarios */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h2 style={{ color: 'var(--at-ink)', fontSize: '16px', fontWeight: 600, margin: 0 }}>Usuarios de la Empresa</h2>
          <div style={{ display: 'flex', gap: '8px' }}>
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

      {/* Configuración de Pagos Online */}
      {currentUser.company_id && (
        <div style={{
          background: 'var(--at-surface)',
          borderRadius: '16px', padding: '24px',
          border: '1px solid var(--at-line)',
          marginTop: '24px',
        }}>
          <StripePayPalConfig
            companyId={currentUser.company_id}
            onConfigUpdated={() => void cargar()}
          />
        </div>
      )}

      {/* Configuración de Correo Google */}
      {currentUser.company_id && (
        <div style={{
          background: 'var(--at-surface)',
          borderRadius: '16px', padding: '28px',
          border: '1px solid var(--at-line)',
          marginTop: '24px',
          boxShadow: '0 2px 12px rgba(0,0,0,.04)',
        }}>
          <GoogleEmailConfig companyId={currentUser.company_id} />
        </div>
      )}

      {/* Modal de asignación de proyectos */}
      {usuarioAsignar && (
        <AsignacionModal
          usuario={usuarioAsignar}
          proyectos={proyectos}

          onClose={() => setUsuarioAsignar(null)}
          onSaved={() => void cargar()}
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
          onSaved={() => void cargar()}
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
      {showAuditLog && (
        <AuditLogModal onClose={() => setShowAuditLog(false)} />
      )}
    </div>
  )
}
