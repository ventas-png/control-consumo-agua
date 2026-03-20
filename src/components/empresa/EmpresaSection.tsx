import { useState, useEffect, useCallback } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../lib/supabase'
import type { UserSession } from '../../types'
import { AsignacionModal } from './AsignacionModal'

interface Proyecto {
  id: string
  name: string
}

interface Usuario {
  id: string
  full_name: string
  role: string
  activo: boolean
}

interface EmpresaInfo {
  id: string
  name: string
  max_projects: number
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

  const cargar = useCallback(async () => {
    setLoading(true)
    if (!currentUser.company_id) { setLoading(false); return }

    const [empresaRes, proyectosRes, usuariosRes] = await Promise.all([
      supabase.from('companies').select('id, name, max_projects').eq('id', currentUser.company_id).single(),
      supabase.from('projects').select('id, name').eq('company_id', currentUser.company_id).order('name'),
      supabase.from('app_users').select('id, full_name, role, activo')
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
      inputValidator: v => !v.trim() ? 'El nombre es obligatorio' : null,
    })

    if (!nombre) return

    const { error } = await supabase.from('projects').insert({
      name: nombre.trim(),
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
    const { value: formValues } = await Swal.fire({
      title: 'Nuevo Administrador',
      html: `
        <input id="swal-nombre" class="swal2-input" placeholder="Nombre completo" />
        <input id="swal-email" class="swal2-input" placeholder="Correo electrónico" type="email" />
        <input id="swal-password" class="swal2-input" placeholder="Contraseña temporal" type="password" />
        <select id="swal-rol" class="swal2-select" style="width:100%;margin-top:8px;padding:10px;border-radius:6px;border:1px solid #d0d3d4">
          <option value="admin">Administrador</option>
          <option value="operator">Operador</option>
          <option value="viewer">Visualizador</option>
        </select>
      `,
      showCancelButton: true,
      confirmButtonText: 'Crear',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const nombre = (document.getElementById('swal-nombre') as HTMLInputElement)?.value?.trim()
        const email = (document.getElementById('swal-email') as HTMLInputElement)?.value?.trim()
        const password = (document.getElementById('swal-password') as HTMLInputElement)?.value
        const rol = (document.getElementById('swal-rol') as HTMLSelectElement)?.value
        if (!nombre || !email || !password) {
          Swal.showValidationMessage('Todos los campos son obligatorios')
          return false
        }
        if (password.length < 8) {
          Swal.showValidationMessage('La contraseña debe tener al menos 8 caracteres')
          return false
        }
        return { nombre, email, password, rol }
      },
    })

    if (!formValues) return

    // Llamar al Edge Function para crear el usuario (requiere service role key)
    const { data: session } = await supabase.auth.getSession()
    const token = session.session?.access_token
    const { data: { supabaseUrl } } = { data: { supabaseUrl: import.meta.env.VITE_SUPABASE_URL as string } }
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
      void Swal.fire({ icon: 'success', title: 'Usuario creado', timer: 1500, showConfirmButton: false })
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
  }

  const roleBadgeColor: Record<string, string> = {
    admin: '#0ea5e9',
    operator: '#10b981', operador: '#10b981',
    viewer: '#8b5cf6', visor: '#8b5cf6',
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
      {/* Header empresa */}
      <div style={{
        background: 'linear-gradient(135deg, #0f172a, #1e293b)',
        borderRadius: '16px', padding: '28px 32px', marginBottom: '28px',
        border: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h1 style={{ color: '#f1f5f9', fontSize: '22px', fontWeight: 700, margin: 0 }}>
              {empresa?.name ?? 'Mi Empresa'}
            </h1>
            <p style={{ color: '#64748b', fontSize: '14px', marginTop: '4px' }}>
              Panel de administración de empresa
            </p>
          </div>
          <div style={{
            background: 'rgba(14,165,233,0.12)', border: '1px solid rgba(14,165,233,0.25)',
            borderRadius: '10px', padding: '10px 18px', textAlign: 'center',
          }}>
            <div style={{ color: '#38bdf8', fontSize: '22px', fontWeight: 700 }}>
              {proyectos.length}<span style={{ color: '#64748b', fontSize: '16px' }}>/{empresa?.max_projects ?? 5}</span>
            </div>
            <div style={{ color: '#64748b', fontSize: '11px', marginTop: '2px' }}>proyectos</div>
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '12px' }}>
            {proyectos.map(p => (
              <div key={p.id} style={{
                background: '#1e293b', borderRadius: '12px', padding: '18px 20px',
                border: '1px solid rgba(255,255,255,0.06)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                  <div style={{
                    width: '8px', height: '8px', borderRadius: '50%',
                    background: 'linear-gradient(135deg, #0ea5e9, #0d9488)',
                  }} />
                  <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: '14px' }}>{p.name}</span>
                </div>
                <div style={{ color: '#475569', fontSize: '11px', marginBottom: '12px', paddingLeft: '18px' }}>
                  ID: {p.id.slice(0, 8)}...
                </div>
              </div>
            ))}
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

      {/* Modal de asignación */}
      {usuarioAsignar && (
        <AsignacionModal
          usuario={usuarioAsignar}
          proyectos={proyectos}
          companyId={currentUser.company_id ?? ''}
          onClose={() => setUsuarioAsignar(null)}
          onSaved={() => void cargar()}
        />
      )}
    </div>
  )
}
