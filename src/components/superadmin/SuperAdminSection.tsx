import React, { useState, useEffect, useCallback } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../lib/supabase'

interface Empresa {
  id: string
  name: string
  max_projects: number
  project_count?: number
  user_count?: number
}

export function SuperAdminSection() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [loading, setLoading] = useState(true)
  const [editingMax, setEditingMax] = useState<Record<string, number>>({})

  const cargar = useCallback(async () => {
    setLoading(true)
    const { data: companiesData } = await supabase
      .from('companies')
      .select('id, name, max_projects')
      .order('name')

    if (!companiesData) { setLoading(false); return }

    // Obtener conteos por empresa
    const empresasConConteos = await Promise.all(
      (companiesData as Empresa[]).map(async (c) => {
        const [{ count: projectCount }, { count: userCount }] = await Promise.all([
          supabase.from('projects').select('id', { count: 'exact', head: true }).eq('company_id', c.id),
          supabase.from('app_users').select('id', { count: 'exact', head: true }).eq('company_id', c.id),
        ])
        return {
          ...c,
          project_count: projectCount ?? 0,
          user_count: userCount ?? 0,
        }
      })
    )

    setEmpresas(empresasConConteos)
    setLoading(false)
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  async function actualizarMaxProyectos(empresaId: string) {
    const nuevoMax = editingMax[empresaId]
    if (nuevoMax === undefined || nuevoMax < 1) {
      void Swal.fire({ icon: 'warning', title: 'Valor inválido', text: 'El mínimo es 1 proyecto.' })
      return
    }

    const { error } = await supabase
      .from('companies')
      .update({ max_projects: nuevoMax })
      .eq('id', empresaId)

    if (error) {
      void Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo actualizar el límite.' })
    } else {
      void Swal.fire({ icon: 'success', title: 'Actualizado', timer: 1200, showConfirmButton: false })
      setEditingMax(prev => { const n = { ...prev }; delete n[empresaId]; return n })
      void cargar()
    }
  }

  async function crearEmpresa() {
    const { value: formValues } = await Swal.fire({
      title: 'Nueva Empresa',
      html: `
        <input id="swal-empresa" class="swal2-input" placeholder="Nombre de la empresa" />
        <input id="swal-owner-nombre" class="swal2-input" placeholder="Nombre del administrador" />
        <input id="swal-owner-email" class="swal2-input" placeholder="Email del administrador" type="email" />
        <input id="swal-owner-pass" class="swal2-input" placeholder="Contraseña temporal" type="password" />
        <input id="swal-max" class="swal2-input" placeholder="Límite de proyectos" type="number" value="5" min="1" />
      `,
      showCancelButton: true,
      confirmButtonText: 'Crear',
      cancelButtonText: 'Cancelar',
      preConfirm: () => {
        const empresaNombre = (document.getElementById('swal-empresa') as HTMLInputElement)?.value?.trim()
        const ownerNombre = (document.getElementById('swal-owner-nombre') as HTMLInputElement)?.value?.trim()
        const ownerEmail = (document.getElementById('swal-owner-email') as HTMLInputElement)?.value?.trim()
        const ownerPass = (document.getElementById('swal-owner-pass') as HTMLInputElement)?.value
        const maxProj = parseInt((document.getElementById('swal-max') as HTMLInputElement)?.value ?? '5')
        if (!empresaNombre || !ownerNombre || !ownerEmail || !ownerPass) {
          Swal.showValidationMessage('Todos los campos son obligatorios')
          return false
        }
        if (ownerPass.length < 8) {
          Swal.showValidationMessage('La contraseña debe tener al menos 8 caracteres')
          return false
        }
        return { empresaNombre, ownerNombre, ownerEmail, ownerPass, maxProj: isNaN(maxProj) ? 5 : maxProj }
      },
    })

    if (!formValues) return

    // 1. Crear la empresa
    const { data: nuevaEmpresa, error: empresaError } = await supabase
      .from('companies')
      .insert({ name: formValues.empresaNombre, max_projects: formValues.maxProj })
      .select()
      .single()

    if (empresaError || !nuevaEmpresa) {
      void Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo crear la empresa.' })
      return
    }

    // 2. Crear el company_owner via Edge Function (requiere service role)
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
        email: formValues.ownerEmail,
        password: formValues.ownerPass,
        full_name: formValues.ownerNombre,
        role: 'company_owner',
        company_id: (nuevaEmpresa as { id: string }).id,
      }),
    })

    if (!res.ok) {
      const err = await res.json() as { error?: string }
      void Swal.fire({ icon: 'error', title: 'Advertencia', text: `Empresa creada pero error al crear administrador: ${err.error ?? 'Error desconocido'}` })
    } else {
      void Swal.fire({ icon: 'success', title: 'Empresa creada', text: `"${formValues.empresaNombre}" lista con su administrador.`, timer: 2000, showConfirmButton: false })
      void cargar()
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px' }}>
        <span style={{ color: '#64748b', fontSize: '16px' }}>Cargando...</span>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #0f172a, #1e293b)',
        borderRadius: '16px', padding: '28px 32px', marginBottom: '28px',
        border: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px',
      }}>
        <div>
          <h1 style={{ color: '#f1f5f9', fontSize: '22px', fontWeight: 700, margin: 0 }}>
            Panel Superadministrador
          </h1>
          <p style={{ color: '#64748b', fontSize: '14px', marginTop: '4px' }}>
            {empresas.length} empresa(s) registrada(s)
          </p>
        </div>
        <button
          onClick={() => void crearEmpresa()}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '10px 18px', borderRadius: '8px', border: 'none',
            background: 'linear-gradient(135deg, #0ea5e9, #0d9488)',
            color: 'white', cursor: 'pointer', fontSize: '14px', fontWeight: 600,
          }}
        >
          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Nueva Empresa
        </button>
      </div>

      {/* Lista de empresas */}
      {empresas.length === 0 ? (
        <div style={{
          background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.1)',
          borderRadius: '12px', padding: '48px', textAlign: 'center',
        }}>
          <p style={{ color: '#475569', margin: 0 }}>No hay empresas registradas.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {empresas.map(e => {
            const isEditing = editingMax[e.id] !== undefined
            return (
              <div key={e.id} style={{
                background: '#1e293b', borderRadius: '14px', padding: '20px 24px',
                border: '1px solid rgba(255,255,255,0.06)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '16px' }}>{e.name}</div>
                    <div style={{ display: 'flex', gap: '16px', marginTop: '6px', flexWrap: 'wrap' }}>
                      <span style={{ color: '#64748b', fontSize: '13px' }}>
                        <span style={{ color: '#38bdf8', fontWeight: 600 }}>{e.project_count}</span>/{e.max_projects} proyectos
                      </span>
                      <span style={{ color: '#64748b', fontSize: '13px' }}>
                        <span style={{ color: '#a78bfa', fontWeight: 600 }}>{e.user_count}</span> usuarios
                      </span>
                    </div>
                  </div>

                  {/* Control de límite de proyectos */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ color: '#94a3b8', fontSize: '13px', whiteSpace: 'nowrap' }}>Límite proyectos:</span>
                    <input
                      type="number"
                      min={1}
                      value={isEditing ? editingMax[e.id] : e.max_projects}
                      onChange={(ev: React.ChangeEvent<HTMLInputElement>) => setEditingMax(prev => ({ ...prev, [e.id]: parseInt(ev.target.value) || 1 }))}
                      style={{
                        width: '64px', padding: '6px 8px', borderRadius: '6px',
                        border: `1px solid ${isEditing ? '#0ea5e9' : 'rgba(255,255,255,0.1)'}`,
                        background: '#0f172a', color: '#f1f5f9', fontSize: '14px',
                        textAlign: 'center',
                      }}
                    />
                    {isEditing && (
                      <button
                        onClick={() => void actualizarMaxProyectos(e.id)}
                        style={{
                          padding: '6px 12px', borderRadius: '6px', border: 'none',
                          background: 'linear-gradient(135deg, #0ea5e9, #0d9488)',
                          color: 'white', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
                        }}
                      >
                        Guardar
                      </button>
                    )}
                    {isEditing && (
                      <button
                        onClick={() => setEditingMax(prev => { const n = { ...prev }; delete n[e.id]; return n })}
                        style={{
                          padding: '6px 10px', borderRadius: '6px',
                          border: '1px solid rgba(255,255,255,0.1)', background: 'transparent',
                          color: '#64748b', cursor: 'pointer', fontSize: '12px',
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
