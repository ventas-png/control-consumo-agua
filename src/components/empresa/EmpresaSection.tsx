import { useState, useEffect, useCallback } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../lib/supabase'
import type { UserSession, Proyecto } from '../../types'
import { MONEDAS } from '../../types'
import { AsignacionModal } from './AsignacionModal'
import { PermisosModuloModal } from './PermisosModuloModal'
import { StripePayPalConfig } from './StripePayPalConfig'
import { CONDOMINIOS_ROLES } from '../../lib/condominiosRoles'

const ESTADO_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  activo:     { label: 'Activo',     bg: 'rgba(34,197,94,0.15)',  color: '#22c55e' },
  inactivo:   { label: 'Inactivo',   bg: 'rgba(100,116,139,0.2)', color: '#94a3b8' },
  suspendido: { label: 'Suspendido', bg: 'rgba(245,158,11,0.15)', color: '#f59e0b' },
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
  condominios_role?: string | null
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
  const [usuarioPermisos, setUsuarioPermisos] = useState<Usuario | null>(null)

  const cargar = useCallback(async () => {
    setLoading(true)
    if (!currentUser.company_id) { setLoading(false); return }

    const [empresaRes, proyectosRes, usuariosRes] = await Promise.all([
      supabase.from('companies').select('id, nombre, nit, email, telefono, max_projects, logo_url').eq('id', currentUser.company_id).single(),
      supabase.from('projects').select('id, nombre, logo_url, descripcion, direccion, latitud, longitud, moneda, estado, max_unidades_apartamento, max_unidades_casa, max_unidades_bodega, max_unidades_local_comercial, max_unidades_oficina, max_unidades_parqueadero, max_unidades_otro').eq('company_id', currentUser.company_id).order('nombre'),
      supabase.from('app_users').select('id, full_name, role, activo, condominios_role')
        .eq('company_id', currentUser.company_id)
        .neq('id', currentUser.user_id)
        .order('full_name'),
    ])

    if (empresaRes.data) setEmpresa(empresaRes.data as EmpresaInfo)
    if (proyectosRes.data) setProyectos(proyectosRes.data as Proyecto[])
    if (usuariosRes.data) setUsuarios(usuariosRes.data as Usuario[])
    setLoading(false)
  }, [currentUser.company_id, currentUser.user_id])

  useEffect(() => { void cargar() }, [cargar])

  async function editarEmpresa() {
    if (!empresa) return
    const { value: formValues } = await Swal.fire({
      title: 'Editar Información de Empresa',
      html: `
        <input id="swal-nombre" class="swal2-input" placeholder="Nombre de la empresa *" value="${empresa.nombre}" />
        <input id="swal-nit" class="swal2-input" placeholder="NIT" value="${empresa.nit ?? ''}" />
        <input id="swal-email" class="swal2-input" placeholder="Email de contacto" type="email" value="${empresa.email ?? ''}" />
        <input id="swal-telefono" class="swal2-input" placeholder="Teléfono" value="${empresa.telefono ?? ''}" />
      `,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const nombre = (document.getElementById('swal-nombre') as HTMLInputElement)?.value?.trim()
        if (!nombre) { Swal.showValidationMessage('El nombre es obligatorio'); return false }
        return {
          nombre,
          nit: (document.getElementById('swal-nit') as HTMLInputElement)?.value?.trim() || null,
          email: (document.getElementById('swal-email') as HTMLInputElement)?.value?.trim() || null,
          telefono: (document.getElementById('swal-telefono') as HTMLInputElement)?.value?.trim() || null,
        }
      },
    })
    if (!formValues) return
    const { error } = await supabase.from('companies').update(formValues).eq('id', empresa.id)
    if (error) {
      void Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo actualizar la información.' })
    } else {
      void Swal.fire({ icon: 'success', title: 'Actualizado', timer: 1200, showConfirmButton: false })
      void cargar()
    }
  }

  async function subirLogo(file: File) {
    if (!empresa) return
    const path = `${empresa.id}/logo`
    const { error: uploadError } = await supabase.storage
      .from('company-logos')
      .upload(path, file, { upsert: true, contentType: file.type })
    if (uploadError) {
      void Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo subir el logo.' })
      return
    }
    const { data } = supabase.storage.from('company-logos').getPublicUrl(path)
    const url = `${data.publicUrl}?t=${Date.now()}`
    await supabase.from('companies').update({ logo_url: url }).eq('id', empresa.id)
    void cargar()
  }

  async function editarProyecto(proyecto: Proyecto) {
    const monedasOpts = MONEDAS.map(m =>
      `<option value="${m.simbolo}" ${proyecto.moneda === m.simbolo ? 'selected' : ''}>${m.simbolo} — ${m.nombre}</option>`
    ).join('')

    const tiposLimites = TIPOS_UNIDAD_LABELS.map(t => {
      const val = (proyecto[t.key] as number | null) ?? ''
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <span style="font-size:12px;color:#475569;min-width:140px">${t.label}</span>
          <input id="swal-${t.key}" type="number" min="0" step="1"
            class="swal2-input"
            placeholder="Sin límite"
            value="${val}"
            style="margin:0;width:110px;text-align:right;font-size:13px" />
        </div>`
    }).join('')

    const { value: formValues } = await Swal.fire({
      title: 'Editar Proyecto',
      width: 560,
      html: `
        <div style="text-align:left;padding:0 4px;max-height:70vh;overflow-y:auto">
          <label style="font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Nombre *</label>
          <input id="swal-nombre" class="swal2-input" value="${proyecto.nombre}" style="margin:4px 0 14px" />

          <label style="font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Descripción</label>
          <textarea id="swal-descripcion" class="swal2-textarea" style="margin:4px 0 14px;height:72px;resize:vertical">${proyecto.descripcion ?? ''}</textarea>

          <label style="font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Dirección</label>
          <input id="swal-direccion" class="swal2-input" placeholder="Ej: Calle 123 #45-67" value="${proyecto.direccion ?? ''}" style="margin:4px 0 14px" />

          <label style="font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Geolocalización</label>
          <div style="display:flex;gap:8px;margin:4px 0 6px">
            <input id="swal-lat" class="swal2-input" placeholder="Latitud" value="${proyecto.latitud ?? ''}" style="margin:0" />
            <input id="swal-lng" class="swal2-input" placeholder="Longitud" value="${proyecto.longitud ?? ''}" style="margin:0" />
          </div>
          <button id="swal-geolocate" type="button" style="font-size:12px;padding:6px 14px;border-radius:6px;border:1px solid #0ea5e9;background:transparent;color:#0ea5e9;cursor:pointer;margin-top:4px;margin-bottom:16px">
            📍 Usar mi ubicación actual
          </button>

          <hr style="border:none;border-top:1px solid #e2e8f0;margin:12px 0" />

          <div style="display:flex;gap:16px;margin-bottom:14px">
            <div style="flex:1">
              <label style="font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Moneda</label>
              <select id="swal-moneda" class="swal2-select" style="margin:4px 0 0;width:100%;padding:9px 10px;border-radius:6px;border:1px solid #d0d3d4;font-size:13px">
                ${monedasOpts}
              </select>
            </div>
            <div style="flex:1">
              <label style="font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Estado</label>
              <select id="swal-estado" class="swal2-select" style="margin:4px 0 0;width:100%;padding:9px 10px;border-radius:6px;border:1px solid #d0d3d4;font-size:13px">
                <option value="activo"     ${proyecto.estado === 'activo'     ? 'selected' : ''}>Activo</option>
                <option value="inactivo"   ${proyecto.estado === 'inactivo'   ? 'selected' : ''}>Inactivo</option>
                <option value="suspendido" ${proyecto.estado === 'suspendido' ? 'selected' : ''}>Suspendido</option>
              </select>
            </div>
          </div>

          <hr style="border:none;border-top:1px solid #e2e8f0;margin:12px 0" />

          <label style="font-size:12px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Límite de Unidades por Tipo</label>
          <p style="font-size:11px;color:#94a3b8;margin:4px 0 10px">Dejar en blanco = sin límite</p>
          ${tiposLimites}
        </div>
      `,
      didOpen: () => {
        document.getElementById('swal-geolocate')?.addEventListener('click', () => {
          const btn = document.getElementById('swal-geolocate') as HTMLButtonElement
          btn.textContent = 'Obteniendo ubicación...'
          btn.disabled = true
          navigator.geolocation.getCurrentPosition(
            pos => {
              (document.getElementById('swal-lat') as HTMLInputElement).value = pos.coords.latitude.toFixed(6)
              ;(document.getElementById('swal-lng') as HTMLInputElement).value = pos.coords.longitude.toFixed(6)
              btn.textContent = '✅ Ubicación capturada'
            },
            () => {
              btn.textContent = '❌ No se pudo obtener la ubicación'
              btn.disabled = false
            }
          )
        })
      },
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const nombre = (document.getElementById('swal-nombre') as HTMLInputElement).value.trim()
        if (!nombre) { Swal.showValidationMessage('El nombre es obligatorio'); return false }
        const latRaw = (document.getElementById('swal-lat') as HTMLInputElement).value.trim()
        const lngRaw = (document.getElementById('swal-lng') as HTMLInputElement).value.trim()
        const getLimit = (id: string): number | null => {
          const v = (document.getElementById(id) as HTMLInputElement).value.trim()
          if (!v) return null
          const n = parseInt(v, 10)
          return isNaN(n) || n < 0 ? null : n
        }
        return {
          nombre,
          descripcion: (document.getElementById('swal-descripcion') as HTMLTextAreaElement).value.trim() || null,
          direccion: (document.getElementById('swal-direccion') as HTMLInputElement).value.trim() || null,
          latitud: latRaw ? parseFloat(latRaw) : null,
          longitud: lngRaw ? parseFloat(lngRaw) : null,
          moneda: (document.getElementById('swal-moneda') as HTMLSelectElement).value,
          estado: (document.getElementById('swal-estado') as HTMLSelectElement).value,
          max_unidades_apartamento:     getLimit('swal-max_unidades_apartamento'),
          max_unidades_casa:            getLimit('swal-max_unidades_casa'),
          max_unidades_bodega:          getLimit('swal-max_unidades_bodega'),
          max_unidades_local_comercial: getLimit('swal-max_unidades_local_comercial'),
          max_unidades_oficina:         getLimit('swal-max_unidades_oficina'),
          max_unidades_parqueadero:     getLimit('swal-max_unidades_parqueadero'),
          max_unidades_otro:            getLimit('swal-max_unidades_otro'),
        }
      },
    })
    if (!formValues) return
    const { error } = await supabase.from('projects').update(formValues).eq('id', proyecto.id)
    if (error) {
      void Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo actualizar el proyecto.' })
    } else {
      void Swal.fire({ icon: 'success', title: 'Proyecto actualizado', timer: 1200, showConfirmButton: false })
      void cargar()
    }
  }

  async function cambiarEstadoProyecto(proyecto: Proyecto) {
    const estados: Proyecto['estado'][] = ['activo', 'inactivo', 'suspendido']
    const actual = proyecto.estado ?? 'activo'
    const config = ESTADO_CONFIG[actual]

    const { value: nuevoEstado } = await Swal.fire({
      title: 'Cambiar estado del proyecto',
      html: `
        <p style="color:#475569;margin-bottom:16px">Estado actual: <strong style="color:${config.color}">${config.label}</strong></p>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${estados.filter(e => e !== actual).map(e => {
            const c = ESTADO_CONFIG[e]
            return `<button data-estado="${e}" type="button" style="padding:10px 16px;border-radius:8px;border:1px solid ${c.color}44;background:${c.bg};color:${c.color};font-weight:600;font-size:14px;cursor:pointer">${c.label}</button>`
          }).join('')}
        </div>
      `,
      showConfirmButton: false,
      showCancelButton: true,
      cancelButtonText: 'Cancelar',
      didOpen: () => {
        document.querySelectorAll('[data-estado]').forEach(btn => {
          btn.addEventListener('click', () => {
            Swal.close()
            const estado = (btn as HTMLElement).dataset.estado as Proyecto['estado']
            // eslint-disable-next-line @typescript-eslint/no-use-before-define
            void aplicarCambioEstado(proyecto.id, estado)
          })
        })
      },
    })
    void nuevoEstado
  }

  async function aplicarCambioEstado(id: string, estado: Proyecto['estado']) {
    const { error } = await supabase.from('projects').update({ estado }).eq('id', id)
    if (error) {
      void Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo cambiar el estado.' })
    } else {
      void cargar()
    }
  }

  async function subirLogoProyecto(proyectoId: string, file: File) {
    const path = `${proyectoId}/logo`
    const { error: uploadError } = await supabase.storage
      .from('project-logos')
      .upload(path, file, { upsert: true, contentType: file.type })
    if (uploadError) {
      void Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo subir el logo del proyecto.' })
      return
    }
    const { data } = supabase.storage.from('project-logos').getPublicUrl(path)
    const url = `${data.publicUrl}?t=${Date.now()}`
    await supabase.from('projects').update({ logo_url: url }).eq('id', proyectoId)
    void cargar()
  }

  async function crearProyecto() {
    if (!empresa) return
    if (proyectos.length >= empresa.max_projects) {
      void Swal.fire({
        icon: 'warning',
        title: 'Límite alcanzado',
        text: `Tu empresa puede tener máximo ${empresa.max_projects} proyecto(s). Contacta al superadministrador para aumentar el límite.`,
        confirmButtonText: 'Entendido',
      })
      return
    }

    const { value: nombre } = await Swal.fire({
      title: 'Nuevo Proyecto',
      input: 'text',
      inputLabel: 'Nombre del proyecto',
      inputPlaceholder: 'Ej: Proyecto Norte',
      showCancelButton: true,
      confirmButtonText: 'Crear',
      cancelButtonText: 'Cancelar',
      inputValidator: (v: string) => !v.trim() ? 'El nombre es obligatorio' : null,
    })

    if (!nombre) return

    const { error } = await supabase.from('projects').insert({
      nombre: nombre.trim(),
      company_id: currentUser.company_id,
    })

    if (error) {
      void Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo crear el proyecto.' })
    } else {
      void Swal.fire({ icon: 'success', title: 'Proyecto creado', timer: 1500, showConfirmButton: false })
      void cargar()
    }
  }

  async function crearAdmin() {
    const showCondominiosRole = currentUser.servicio_condominios !== false
    const condominiosRoleOptions = CONDOMINIOS_ROLES.map(r =>
      `<option value="${r.id}">${r.label}</option>`
    ).join('')

    const { value: formValues } = await Swal.fire({
      title: 'Nuevo Administrador',
      html: `
        <input id="swal-nombre" class="swal2-input" placeholder="Nombre completo" />
        <input id="swal-email" class="swal2-input" placeholder="Correo electrónico" type="email" />
        <input id="swal-password" class="swal2-input" placeholder="Contraseña temporal" type="password" />
        <select id="swal-rol" class="swal2-select" style="width:100%;margin-top:8px;padding:10px;border-radius:6px;border:1px solid #d0d3d4">
          <option value="admin">Administrador</option>
          <option value="operator">Operador (Lecturas)</option>
          <option value="collector">Gestor de Cobros</option>
          <option value="viewer">Visualizador</option>
        </select>
        ${showCondominiosRole ? `
        <p style="font-size:12px;color:#94a3b8;margin:12px 0 4px;text-align:left;padding-left:4px">Rol en Condominios (opcional)</p>
        <select id="swal-condominios-rol" class="swal2-select" style="width:100%;padding:10px;border-radius:6px;border:1px solid #d0d3d4">
          <option value="">— Sin rol de condominios —</option>
          ${condominiosRoleOptions}
        </select>
        ` : ''}
      `,
      showCancelButton: true,
      confirmButtonText: 'Crear',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const nombre = (document.getElementById('swal-nombre') as HTMLInputElement)?.value?.trim()
        const email = (document.getElementById('swal-email') as HTMLInputElement)?.value?.trim()
        const password = (document.getElementById('swal-password') as HTMLInputElement)?.value
        const rol = (document.getElementById('swal-rol') as HTMLSelectElement)?.value
        const condominiosRol = showCondominiosRole
          ? ((document.getElementById('swal-condominios-rol') as HTMLSelectElement)?.value || null)
          : null
        if (!nombre || !email || !password) {
          Swal.showValidationMessage('Todos los campos son obligatorios')
          return false
        }
        if (password.length < 8) {
          Swal.showValidationMessage('La contraseña debe tener al menos 8 caracteres')
          return false
        }
        return { nombre, email, password, rol, condominiosRol }
      },
    })

    if (!formValues) return

    // Llamar al Edge Function para crear el usuario (requiere service role key)
    const { data: session } = await supabase.auth.getSession()
    const token = session.session?.access_token
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
    const res = await fetch(`${supabaseUrl}/functions/v1/create-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token ?? ''}`,
      },
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
      void Swal.fire({ icon: 'error', title: 'Error', text: err.error ?? 'No se pudo crear el usuario.' })
    } else {
      const created = await res.json() as { user_id?: string }
      if (formValues.condominiosRol && created.user_id) {
        await supabase.from('app_users')
          .update({ condominios_role: formValues.condominiosRol })
          .eq('id', created.user_id)
      }
      void Swal.fire({ icon: 'success', title: 'Usuario creado', timer: 1500, showConfirmButton: false })
      void cargar()
    }
  }

  async function cambiarRolCondominios(usuario: Usuario) {
    const condominiosRoleOptions = CONDOMINIOS_ROLES.map(r =>
      `<option value="${r.id}" ${usuario.condominios_role === r.id ? 'selected' : ''}>${r.label} — ${r.description}</option>`
    ).join('')

    const { value: nuevoRol } = await Swal.fire({
      title: `Rol Condominios`,
      html: `
        <p style="color:#94a3b8;font-size:13px;margin-bottom:12px">Usuario: <strong style="color:#e2e8f0">${usuario.full_name}</strong></p>
        <select id="swal-cond-rol" class="swal2-select" style="width:100%;padding:10px;border-radius:6px;border:1px solid #d0d3d4">
          <option value="" ${!usuario.condominios_role ? 'selected' : ''}>— Sin rol de condominios —</option>
          ${condominiosRoleOptions}
        </select>
      `,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        return (document.getElementById('swal-cond-rol') as HTMLSelectElement)?.value || null
      },
    })

    if (nuevoRol === undefined) return
    const { error } = await supabase.from('app_users')
      .update({ condominios_role: nuevoRol || null })
      .eq('id', usuario.id)
    if (error) {
      void Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo actualizar el rol.' })
    } else {
      void cargar()
    }
  }

  async function toggleActivoUsuario(usuario: Usuario) {
    await supabase.from('app_users').update({ activo: !usuario.activo }).eq('id', usuario.id)
    void cargar()
  }

  const roleLabel: Record<string, string> = {
    admin: 'Administrador',
    operator: 'Operador', operador: 'Operador',
    viewer: 'Visualizador', visor: 'Visualizador',
    collector: 'Gestor de Cobros',
  }

  const roleBadgeColor: Record<string, string> = {
    admin: '#0ea5e9',
    operator: '#10b981', operador: '#10b981',
    viewer: '#8b5cf6', visor: '#8b5cf6',
    collector: '#f59e0b',
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px' }}>
        <span style={{ color: '#64748b', fontSize: '16px' }}>Cargando...</span>
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
        background: 'linear-gradient(135deg, #0f172a, #1e293b)',
        borderRadius: '16px', padding: '24px 24px 20px', marginBottom: '24px',
        border: '1px solid rgba(255,255,255,0.06)',
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
                border: '2px solid rgba(255,255,255,0.18)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              }}
            >
              {empresa?.logo_url
                ? <img src={empresa.logo_url} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <div style={{
                    background: 'linear-gradient(135deg,#0ea5e9,#0d9488)',
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
                <h1 style={{ color: '#f1f5f9', fontSize: '20px', fontWeight: 700, margin: 0, lineHeight: 1.2 }}>
                  {empresa?.nombre ?? 'Mi Empresa'}
                </h1>
              </div>
              <div className="empresa-info-row" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '6px' }}>
                {empresa?.nit && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#64748b', fontSize: '12px' }}>
                    <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    NIT: {empresa.nit}
                  </span>
                )}
                {empresa?.email && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#64748b', fontSize: '12px' }}>
                    <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                    {empresa.email}
                  </span>
                )}
                {empresa?.telefono && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#64748b', fontSize: '12px' }}>
                    <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                    {empresa.telefono}
                  </span>
                )}
                {!empresa?.nit && !empresa?.email && !empresa?.telefono && (
                  <span style={{ color: '#475569', fontSize: '12px', fontStyle: 'italic' }}>Sin datos de contacto</span>
                )}
              </div>
            </div>
          </div>

          {/* Right: stats + edit button */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px', flexShrink: 0 }}>
            <div className="empresa-stats-box" style={{
              background: 'rgba(14,165,233,0.12)', border: '1px solid rgba(14,165,233,0.25)',
              borderRadius: '10px', padding: '10px 16px', textAlign: 'center',
            }}>
              <div style={{ color: '#38bdf8', fontSize: '22px', fontWeight: 700, lineHeight: 1 }}>
                {proyectos.length}<span style={{ color: '#64748b', fontSize: '15px' }}>/{empresa?.max_projects ?? 5}</span>
              </div>
              <div style={{ color: '#64748b', fontSize: '11px', marginTop: '3px' }}>proyectos</div>
            </div>
            <button
              onClick={() => void editarEmpresa()}
              style={{
                padding: '7px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)',
                color: '#cbd5e1', cursor: 'pointer', whiteSpace: 'nowrap',
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
          <h2 style={{ color: '#e2e8f0', fontSize: '16px', fontWeight: 600, margin: 0 }}>Proyectos</h2>
          <button
            onClick={() => void crearProyecto()}
            disabled={empresa ? proyectos.length >= empresa.max_projects : false}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '9px 16px', borderRadius: '8px', border: 'none',
              background: empresa && proyectos.length >= empresa.max_projects
                ? '#334155' : 'linear-gradient(135deg, #0ea5e9, #0d9488)',
              color: empresa && proyectos.length >= empresa.max_projects ? '#64748b' : 'white',
              cursor: empresa && proyectos.length >= empresa.max_projects ? 'not-allowed' : 'pointer',
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
            background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.1)',
            borderRadius: '12px', padding: '32px', textAlign: 'center',
          }}>
            <p style={{ color: '#475569', margin: 0 }}>No hay proyectos. Crea el primero.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: '14px' }}>
            {proyectos.map(p => {
              const estadoCfg = ESTADO_CONFIG[p.estado ?? 'activo']
              return (
              <div key={p.id} className="proyecto-card" style={{
                background: '#1e293b', borderRadius: '14px',
                border: '1px solid rgba(255,255,255,0.06)',
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
                      border: '1px solid rgba(255,255,255,0.12)',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                    }}
                  >
                    {p.logo_url
                      ? <img src={p.logo_url} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <div style={{
                          background: 'linear-gradient(135deg,#0ea5e9,#0d9488)',
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
                      <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                        background: 'rgba(14,165,233,0.12)', color: '#38bdf8', whiteSpace: 'nowrap',
                      }}>
                        {p.moneda ?? 'Q'}
                      </span>
                      <span style={{ color: '#334155', fontSize: '10px', fontFamily: 'monospace' }}>
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
                        padding: '5px 12px', borderRadius: '7px', border: '1px solid rgba(255,255,255,0.15)',
                        background: 'rgba(255,255,255,0.06)', color: '#94a3b8',
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
                    borderTop: '1px solid rgba(255,255,255,0.05)',
                  }}>
                    {p.descripcion && (
                      <p style={{ color: '#64748b', fontSize: '12px', margin: '0 0 6px', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {p.descripcion}
                      </p>
                    )}
                    {p.direccion && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: '#475569', fontSize: '11px', marginBottom: '3px' }}>
                        <span>📍</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.direccion}</span>
                      </div>
                    )}
                    {p.latitud && p.longitud && (
                      <div style={{ color: '#334155', fontSize: '10px', fontFamily: 'monospace' }}>
                        {p.latitud.toFixed(5)}, {p.longitud.toFixed(5)}
                      </div>
                    )}
                  </div>
                )}
                {/* Footer buttons (shown on mobile only) */}
                <div className="proyecto-btn-footer" style={{
                  gap: '8px', padding: '10px 14px',
                  borderTop: '1px solid rgba(255,255,255,0.06)',
                  background: 'rgba(0,0,0,0.2)',
                }}>
                  <button
                    onClick={() => void editarProyecto(p)}
                    style={{
                      flex: 1, padding: '9px 0', borderRadius: '8px',
                      border: '1px solid rgba(255,255,255,0.15)',
                      background: 'rgba(255,255,255,0.07)', color: '#cbd5e1',
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
          <h2 style={{ color: '#e2e8f0', fontSize: '16px', fontWeight: 600, margin: 0 }}>Usuarios de la Empresa</h2>
          <button
            onClick={() => void crearAdmin()}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '9px 16px', borderRadius: '8px', border: 'none',
              background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
              color: 'white', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
            }}
          >
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
            Nuevo Usuario
          </button>
        </div>

        {usuarios.length === 0 ? (
          <div style={{
            background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.1)',
            borderRadius: '12px', padding: '32px', textAlign: 'center',
          }}>
            <p style={{ color: '#475569', margin: 0 }}>No hay usuarios. Agrega el primero.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {usuarios.map(u => (
              <div key={u.id} style={{
                background: '#1e293b', borderRadius: '12px', padding: '14px 18px',
                border: '1px solid rgba(255,255,255,0.06)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
                opacity: u.activo ? 1 : 0.5,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                  <div style={{
                    width: '36px', height: '36px', borderRadius: '50%', flexShrink: 0,
                    background: `${roleBadgeColor[u.role] ?? '#64748b'}22`,
                    border: `1px solid ${roleBadgeColor[u.role] ?? '#64748b'}44`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: roleBadgeColor[u.role] ?? '#64748b', fontSize: '13px', fontWeight: 700,
                  }}>
                    {u.full_name.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {u.full_name}
                    </div>
                    <div style={{
                      display: 'inline-block', marginTop: '3px',
                      padding: '1px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 600,
                      background: `${roleBadgeColor[u.role] ?? '#64748b'}22`,
                      color: roleBadgeColor[u.role] ?? '#64748b',
                    }}>
                      {roleLabel[u.role] ?? u.role}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                  <button
                    onClick={() => setUsuarioAsignar(u)}
                    title="Asignar acceso a proyectos"
                    style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      padding: '7px 12px', borderRadius: '7px', border: '1px solid rgba(14,165,233,0.3)',
                      background: 'rgba(14,165,233,0.08)', color: '#38bdf8',
                      cursor: 'pointer', fontSize: '12px', fontWeight: 600,
                    }}
                  >
                    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                    </svg>
                    Asignar Acceso
                  </button>
                  <button
                    onClick={() => setUsuarioPermisos(u)}
                    title="Configurar permisos de modulos"
                    style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      padding: '7px 12px', borderRadius: '7px', border: '1px solid rgba(168,85,247,0.3)',
                      background: 'rgba(168,85,247,0.08)', color: '#c084fc',
                      cursor: 'pointer', fontSize: '12px', fontWeight: 600,
                    }}
                  >
                    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Permisos
                  </button>
                  {currentUser.servicio_condominios !== false && (
                    <button
                      onClick={() => void cambiarRolCondominios(u)}
                      title="Rol en módulo condominios"
                      style={{
                        display: 'flex', alignItems: 'center', gap: '6px',
                        padding: '7px 12px', borderRadius: '7px', border: '1px solid rgba(139,92,246,0.3)',
                        background: 'rgba(139,92,246,0.08)', color: '#a78bfa',
                        cursor: 'pointer', fontSize: '12px', fontWeight: 600,
                      }}
                    >
                      Rol Cond.
                    </button>
                  )}
                  <button
                    onClick={() => void toggleActivoUsuario(u)}
                    title={u.activo ? 'Desactivar' : 'Activar'}
                    style={{
                      padding: '7px 10px', borderRadius: '7px',
                      border: `1px solid ${u.activo ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)'}`,
                      background: u.activo ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)',
                      color: u.activo ? '#f87171' : '#4ade80',
                      cursor: 'pointer', fontSize: '12px',
                    }}
                  >
                    {u.activo ? 'Desactivar' : 'Activar'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Configuración de Pagos Online */}
      {currentUser.company_id && (
        <div style={{
          background: 'linear-gradient(135deg, #0f172a, #1e293b)',
          borderRadius: '16px', padding: '24px',
          border: '1px solid rgba(255,255,255,0.06)',
          marginTop: '24px',
        }}>
          <StripePayPalConfig
            companyId={currentUser.company_id}
            onConfigUpdated={() => void cargar()}
          />
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

      {/* Modal de permisos de módulos */}
      {usuarioPermisos && (
        <PermisosModuloModal
          usuario={usuarioPermisos}
          servicioAgua={currentUser.servicio_agua !== false}
          servicioCondominios={currentUser.servicio_condominios !== false}
          onClose={() => setUsuarioPermisos(null)}
          onSaved={() => void cargar()}
        />
      )}
    </div>
  )
}
