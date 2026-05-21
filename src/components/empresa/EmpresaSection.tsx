import { useState, useEffect, useCallback } from 'react'
import Swal from 'sweetalert2'
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

const ESTADO_CONFIG: Record<string, { label: string; bg: string; color: string }> = {
  activo:     { label: 'Activo',     bg: 'rgba(34,197,94,0.15)',  color: '#22c55e' },
  inactivo:   { label: 'Inactivo',   bg: 'rgba(100,116,139,0.2)', color: 'var(--at-ink-3)' },
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
    // Path único por upload para que cada cambio de logo produzca una signed
    // URL fresca de inmediato (el useSignedUrl reacts a la nueva value en BD).
    // Logos viejos quedan huérfanos en el bucket — cleanup mecánico pendiente.
    const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
    const path = `${empresa.id}/logo-${Date.now()}.${ext}`
    const { error: uploadError } = await supabase.storage
      .from('company-logos')
      .upload(path, file, { contentType: file.type })
    if (uploadError) {
      void Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo subir el logo.' })
      return
    }
    // Guardamos el path bare; SecureImage firma en cada render.
    await supabase.from('companies').update({ logo_url: path }).eq('id', empresa.id)
    void cargar()
  }

  async function editarProyecto(proyecto: Proyecto) {
    const monedasOpts = MONEDAS.map(m =>
      `<option value="${m.simbolo}" ${proyecto.moneda === m.simbolo ? 'selected' : ''}>${m.simbolo} — ${m.nombre}</option>`
    ).join('')
    const monedasOptsCondominios = MONEDAS.map(m =>
      `<option value="${m.simbolo}" ${(proyecto.moneda_condominios ?? proyecto.moneda) === m.simbolo ? 'selected' : ''}>${m.simbolo} — ${m.nombre}</option>`
    ).join('')

    const inpStyle = 'width:100%;box-sizing:border-box;padding:9px 12px;border:1.5px solid var(--at-line);border-radius:8px;font-size:14px;color:var(--at-ink);background:#fff;outline:none;transition:border-color .15s'
    const selStyle = `${inpStyle};cursor:pointer;appearance:auto`
    const secTitle = (icon: string, text: string) =>
      `<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><span style="font-size:18px">${icon}</span><span style="font-size:13px;font-weight:700;color:var(--at-ink);letter-spacing:.01em">${text}</span></div>`
    const lbl = (text: string, sub = '') =>
      `<label style="display:block;font-size:11px;font-weight:700;color:var(--at-ink-3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px">${text}${sub ? `<span style="font-weight:400;text-transform:none;color:var(--at-ink-3);margin-left:4px">${sub}</span>` : ''}</label>`

    const tiposLimites = TIPOS_UNIDAD_LABELS.map(t => {
      const val = (proyecto[t.key] as number | null) ?? ''
      const icons: Record<string, string> = {
        max_unidades_apartamento: '🏢', max_unidades_casa: '🏠',
        max_unidades_bodega: '📦', max_unidades_local_comercial: '🏪',
        max_unidades_oficina: '💼', max_unidades_parqueadero: '🚗',
        max_unidades_otro: '📋',
      }
      return `
        <div style="display:flex;align-items:center;gap:10px;background:#fff;border:1.5px solid var(--at-chip);border-radius:10px;padding:10px 12px">
          <span style="font-size:18px;flex-shrink:0">${icons[t.key] ?? '📋'}</span>
          <span style="font-size:13px;color:var(--at-ink-2);flex:1">${t.label}</span>
          <input id="swal-${t.key}" type="number" min="0" step="1"
            placeholder="∞"
            value="${val}"
            style="width:80px;padding:6px 8px;border:1.5px solid var(--at-line);border-radius:8px;font-size:14px;font-weight:700;text-align:center;color:var(--at-ink);background:var(--at-surface-2)" />
        </div>`
    }).join('')

    const { value: formValues } = await Swal.fire({
      title: '<span style="font-size:20px;font-weight:800;color:var(--at-ink)">Editar Proyecto</span>',
      width: 620,
      html: `
        <div style="text-align:left;padding:0 2px;max-height:72vh;overflow-y:auto;display:flex;flex-direction:column;gap:16px">

          <!-- Info básica -->
          <div style="background:var(--at-surface-2);border-radius:14px;padding:16px 18px">
            ${secTitle('📋', 'Información del proyecto')}
            ${lbl('Nombre', '(requerido)')}
            <input id="swal-nombre" value="${proyecto.nombre}" style="${inpStyle};margin-bottom:12px" />
            ${lbl('Descripción')}
            <textarea id="swal-descripcion" style="${inpStyle};height:68px;resize:vertical;font-family:inherit">${proyecto.descripcion ?? ''}</textarea>
          </div>

          <!-- Ubicación -->
          <div style="background:var(--at-surface-2);border-radius:14px;padding:16px 18px">
            ${secTitle('📍', 'Ubicación')}
            ${lbl('Dirección')}
            <input id="swal-direccion" placeholder="Ej: Calle 123 #45-67" value="${proyecto.direccion ?? ''}" style="${inpStyle};margin-bottom:12px" />
            <div style="display:flex;gap:8px;margin-bottom:10px">
              <div style="flex:1">${lbl('Latitud')}<input id="swal-lat" placeholder="0.000000" value="${proyecto.latitud ?? ''}" style="${inpStyle}" /></div>
              <div style="flex:1">${lbl('Longitud')}<input id="swal-lng" placeholder="0.000000" value="${proyecto.longitud ?? ''}" style="${inpStyle}" /></div>
            </div>
            <button id="swal-geolocate" type="button" style="display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;padding:7px 14px;border-radius:8px;border:1.5px solid var(--at-primary);background:var(--at-primary-tint);color:var(--at-primary-hover);cursor:pointer">
              📍 Usar mi ubicación actual
            </button>
          </div>

          <!-- Configuración financiera y estado -->
          <div style="background:var(--at-surface-2);border-radius:14px;padding:16px 18px">
            ${secTitle('⚙️', 'Configuración')}
            <div style="display:flex;flex-wrap:wrap;gap:12px">
              <div style="flex:1;min-width:140px">
                ${lbl('💧 Moneda Agua')}
                <select id="swal-moneda" style="${selStyle}">${monedasOpts}</select>
              </div>
              <div style="flex:1;min-width:140px">
                ${lbl('🏢 Moneda Condominios')}
                <select id="swal-moneda-condominios" style="${selStyle}">${monedasOptsCondominios}</select>
              </div>
              <div style="flex:1;min-width:120px">
                ${lbl('Estado')}
                <select id="swal-estado" style="${selStyle}">
                  <option value="activo"     ${proyecto.estado === 'activo'     ? 'selected' : ''}>✅ Activo</option>
                  <option value="inactivo"   ${proyecto.estado === 'inactivo'   ? 'selected' : ''}>⏸ Inactivo</option>
                  <option value="suspendido" ${proyecto.estado === 'suspendido' ? 'selected' : ''}>🚫 Suspendido</option>
                </select>
              </div>
            </div>
          </div>

          <!-- Límite de unidades -->
          <div style="background:var(--at-surface-2);border-radius:14px;padding:16px 18px">
            ${secTitle('🏗️', 'Límite de unidades por tipo')}
            <p style="font-size:12px;color:var(--at-ink-3);margin:0 0 12px">Dejar vacío = sin límite (∞)</p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              ${tiposLimites}
            </div>
          </div>

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
          moneda_condominios: (document.getElementById('swal-moneda-condominios') as HTMLSelectElement).value,
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
        <p style="color:var(--at-ink-2);margin-bottom:16px">Estado actual: <strong style="color:${config.color}">${config.label}</strong></p>
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
    const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
    const path = `${proyectoId}/logo-${Date.now()}.${ext}`
    const { error: uploadError } = await supabase.storage
      .from('project-logos')
      .upload(path, file, { contentType: file.type })
    if (uploadError) {
      void Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo subir el logo del proyecto.' })
      return
    }
    await supabase.from('projects').update({ logo_url: path }).eq('id', proyectoId)
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
    const showAgua = currentUser.servicio_agua !== false
    const showCond = currentUser.servicio_condominios !== false
    const condOpts = CONDOMINIOS_ROLES.map(r => `<option value="${r.id}">${r.label}</option>`).join('')
    const selStyle = 'width:100%;padding:8px 10px;border-radius:6px;border:1px solid #d0d3d4;font-size:13px;margin-top:8px;background:#fff;color:var(--at-ink)'
    const cols = showAgua && showCond ? '1fr 1fr' : '1fr'

    const { value: formValues } = await Swal.fire({
      title: 'Nuevo Usuario',
      width: 520,
      html: `
        <div style="text-align:left">
          <input id="swal-nombre" class="swal2-input" placeholder="Nombre completo" style="margin:0 0 8px" />
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">
            <input id="swal-email" class="swal2-input" placeholder="Correo electrónico" type="email" style="margin:0" />
            <input id="swal-password" class="swal2-input" placeholder="Contraseña temporal" type="password" style="margin:0" />
          </div>
          <p style="font-size:11px;color:var(--at-ink-3);font-weight:700;text-transform:uppercase;letter-spacing:.6px;margin:0 0 10px">
            Acceso a aplicaciones
          </p>
          <div style="display:grid;grid-template-columns:${cols};gap:12px">
            ${showAgua ? `
            <div id="card-agua" style="border:1px solid #1B3B3633;border-radius:10px;padding:12px">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:600;color:var(--at-ink);margin-bottom:2px">
                <input type="checkbox" id="chk-agua" style="width:16px;height:16px;cursor:pointer;accent-color:var(--at-primary)" />
                💧 Control de Agua
              </label>
              <select id="swal-rol-agua" disabled style="${selStyle};opacity:0.4">
                <option value="admin">Administrador — acceso completo</option>
                <option value="operator">Operador — lecturas y operaciones</option>
                <option value="collector">Gestor de Cobros</option>
                <option value="viewer">Visualizador — solo lectura</option>
              </select>
            </div>
            ` : ''}
            ${showCond ? `
            <div id="card-cond" style="border:1px solid #B96A3F33;border-radius:10px;padding:12px">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;font-weight:600;color:var(--at-ink);margin-bottom:2px">
                <input type="checkbox" id="chk-cond" style="width:16px;height:16px;cursor:pointer;accent-color:var(--at-accent)" />
                🏢 Condominios
              </label>
              <select id="swal-rol-cond" disabled style="${selStyle};opacity:0.4">
                <option value="">— Seleccionar rol —</option>
                ${condOpts}
              </select>
            </div>
            ` : ''}
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Crear usuario',
      cancelButtonText: 'Cancelar',
      didOpen: () => {
        const wireToggle = (chkId: string, selId: string, cardId: string, color: string) => {
          const chk = document.getElementById(chkId) as HTMLInputElement | null
          const sel = document.getElementById(selId) as HTMLSelectElement | null
          const card = document.getElementById(cardId) as HTMLDivElement | null
          if (!chk || !sel || !card) return
          chk.addEventListener('change', () => {
            sel.disabled = !chk.checked
            sel.style.opacity = chk.checked ? '1' : '0.4'
            card.style.borderColor = chk.checked ? color + '88' : color + '33'
            card.style.background = chk.checked ? color + '11' : 'transparent'
          })
        }
        wireToggle('chk-agua', 'swal-rol-agua', 'card-agua', 'var(--at-primary)')
        wireToggle('chk-cond', 'swal-rol-cond', 'card-cond', 'var(--at-accent)')
      },
      preConfirm: () => {
        const nombre = (document.getElementById('swal-nombre') as HTMLInputElement)?.value?.trim()
        const email = (document.getElementById('swal-email') as HTMLInputElement)?.value?.trim()
        const password = (document.getElementById('swal-password') as HTMLInputElement)?.value
        const aguaEnabled = showAgua && (document.getElementById('chk-agua') as HTMLInputElement)?.checked
        const condEnabled = showCond && (document.getElementById('chk-cond') as HTMLInputElement)?.checked
        const aguaRol = aguaEnabled ? (document.getElementById('swal-rol-agua') as HTMLSelectElement)?.value : null
        const condRol = condEnabled ? ((document.getElementById('swal-rol-cond') as HTMLSelectElement)?.value || null) : null

        if (!nombre || !email || !password) { Swal.showValidationMessage('Nombre, correo y contraseña son obligatorios'); return false }
        if (password.length < 8) { Swal.showValidationMessage('La contraseña debe tener al menos 8 caracteres'); return false }
        if (!aguaEnabled && !condEnabled) { Swal.showValidationMessage('Selecciona acceso a al menos una aplicación'); return false }
        if (condEnabled && !condRol) { Swal.showValidationMessage('Selecciona un rol para Condominios'); return false }
        // El tier de plataforma (app_users.role) NO debe ser un rol exento.
        // 'admin' salta TODO el RBAC (condominios incluido) vía user_has_permission,
        // así que un "Admin de Agua" se crea como 'operator' (no exento) y recibe
        // su poder de agua desde el rol RBAC "Admin Agua" (user_roles), no del tier.
        const platformTier = aguaRol === 'admin' ? 'operator' : (aguaRol ?? 'viewer')
        return { nombre, email, password, rol: platformTier, aguaRol, condRol }
      },
    })

    if (!formValues) return

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
        void Swal.fire({ icon: 'error', title: 'Error al crear usuario', text: err.error ?? 'No se pudo crear el usuario.' })
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

      void Swal.fire({ icon: 'success', title: 'Usuario creado', timer: 1500, showConfirmButton: false })
      void cargar()
    } catch (err) {
      console.error('create-user request failed:', err)
      void Swal.fire({ icon: 'error', title: 'Error de conexión', text: 'No se pudo contactar el servicio de creación de usuarios. Intente nuevamente; si el problema persiste, contacte al soporte técnico.' })
    }
  }

  // Note: agua and condominios role assignment is handled by the unified
  // RolPermisosModal, which writes directly to user_roles.

  async function toggleActivoUsuario(usuario: Usuario) {
    await supabase.from('app_users').update({ activo: !usuario.activo }).eq('id', usuario.id)
    void cargar()
  }

  const roleBadgeColor: Record<string, string> = {
    admin: 'var(--at-primary)',
    operator: '#10b981', operador: '#10b981',
    viewer: 'var(--at-accent)', visor: 'var(--at-accent)',
    collector: '#f59e0b',
  }

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
        background: 'linear-gradient(135deg, var(--at-ink), var(--at-ink))',
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
                <h1 style={{ color: 'var(--at-chip)', fontSize: '20px', fontWeight: 700, margin: 0, lineHeight: 1.2 }}>
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
              background: 'rgba(27, 59, 54,0.12)', border: '1px solid rgba(27, 59, 54,0.25)',
              borderRadius: '10px', padding: '10px 16px', textAlign: 'center',
            }}>
              <div style={{ color: 'var(--at-accent-2)', fontSize: '22px', fontWeight: 700, lineHeight: 1 }}>
                {proyectos.length}<span style={{ color: 'var(--at-ink-3)', fontSize: '15px' }}>/{empresa?.max_projects ?? 5}</span>
              </div>
              <div style={{ color: 'var(--at-ink-3)', fontSize: '11px', marginTop: '3px' }}>proyectos</div>
            </div>
            <button
              onClick={() => void editarEmpresa()}
              style={{
                padding: '7px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 600,
                border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.08)',
                color: 'var(--at-line-strong)', cursor: 'pointer', whiteSpace: 'nowrap',
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
          <h2 style={{ color: 'var(--at-line)', fontSize: '16px', fontWeight: 600, margin: 0 }}>Proyectos</h2>
          <button
            onClick={() => void crearProyecto()}
            disabled={empresa ? proyectos.length >= empresa.max_projects : false}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '9px 16px', borderRadius: '8px', border: 'none',
              background: empresa && proyectos.length >= empresa.max_projects
                ? 'var(--at-ink-2)' : 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
              color: empresa && proyectos.length >= empresa.max_projects ? 'var(--at-ink-3)' : 'white',
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
            <p style={{ color: 'var(--at-ink-2)', margin: 0 }}>No hay proyectos. Crea el primero.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: '14px' }}>
            {proyectos.map(p => {
              const estadoCfg = ESTADO_CONFIG[p.estado ?? 'activo']
              return (
              <div key={p.id} className="proyecto-card" style={{
                background: 'var(--at-ink)', borderRadius: '14px',
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
                      <span style={{ color: 'var(--at-line)', fontWeight: 600, fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                        background: 'rgba(27, 59, 54,0.12)', color: 'var(--at-accent-2)', whiteSpace: 'nowrap',
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
                        padding: '5px 12px', borderRadius: '7px', border: '1px solid rgba(255,255,255,0.15)',
                        background: 'rgba(255,255,255,0.06)', color: 'var(--at-ink-3)',
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
                  borderTop: '1px solid rgba(255,255,255,0.06)',
                  background: 'rgba(0,0,0,0.2)',
                }}>
                  <button
                    onClick={() => void editarProyecto(p)}
                    style={{
                      flex: 1, padding: '9px 0', borderRadius: '8px',
                      border: '1px solid rgba(255,255,255,0.15)',
                      background: 'rgba(255,255,255,0.07)', color: 'var(--at-line-strong)',
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
          <h2 style={{ color: 'var(--at-line)', fontSize: '16px', fontWeight: 600, margin: 0 }}>Usuarios de la Empresa</h2>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setShowAuditLog(true)}
              title="Auditoría de roles y permisos"
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '9px 14px', borderRadius: '8px',
                border: '1px solid rgba(148,163,184,0.3)',
                background: 'rgba(148,163,184,0.08)', color: 'var(--at-line-strong)',
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
            background: 'rgba(185, 106, 63,0.06)',
            border: '1px solid rgba(185, 106, 63,0.18)',
            borderRadius: '10px', padding: '10px 14px', marginBottom: '12px',
            display: 'flex', alignItems: 'flex-start', gap: '10px',
            color: 'var(--at-line-strong)', fontSize: '12px', lineHeight: 1.5,
          }}>
            <span style={{ color: 'var(--at-accent-light)', fontSize: '14px', lineHeight: 1, marginTop: '1px' }}>💡</span>
            <div>
              <strong style={{ color: 'var(--at-line)' }}>Personalización fina de permisos:</strong>{' '}
              Asigna un rol del sistema desde el botón <em>Roles y permisos</em> en cada usuario.
              Si necesitas un perfil distinto, crea un <em>rol personalizado</em> desde el mismo modal y
              ajusta exactamente qué tabs/acciones permite. Los cambios se auditan en{' '}
              <span style={{ color: 'var(--at-accent-light)' }}>📜 Auditoría</span>.
            </div>
          </div>
        )}

        {usuarios.length === 0 ? (
          <div style={{
            background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.1)',
            borderRadius: '12px', padding: '32px', textAlign: 'center',
          }}>
            <p style={{ color: 'var(--at-ink-2)', margin: 0 }}>No hay usuarios. Agrega el primero.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {usuarios.map(u => (
              <div key={u.id} style={{
                background: 'var(--at-ink)', borderRadius: '12px', padding: '14px 18px',
                border: '1px solid rgba(255,255,255,0.06)',
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
                    <div style={{ color: 'var(--at-line)', fontWeight: 600, fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
                      padding: '6px 10px', borderRadius: '7px', border: '1px solid rgba(27, 59, 54,0.3)',
                      background: 'rgba(27, 59, 54,0.08)', color: 'var(--at-accent-2)',
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
                      padding: '6px 10px', borderRadius: '7px', border: '1px solid rgba(27, 59, 54,0.3)',
                      background: 'rgba(27, 59, 54,0.08)', color: 'var(--at-accent-2)',
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
                      color: u.activo ? '#f87171' : '#4ade80',
                      cursor: 'pointer', fontSize: '12px', fontWeight: 600,
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
          background: 'linear-gradient(135deg, var(--at-ink), var(--at-ink))',
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
