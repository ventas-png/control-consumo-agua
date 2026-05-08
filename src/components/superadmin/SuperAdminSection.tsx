import { useState, useEffect, useCallback, type ChangeEvent} from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../lib/supabase'

interface Empresa {
  id: string
  nombre: string
  nit: string | null
  email: string | null
  telefono: string | null
  plan: string
  activa: boolean
  max_projects: number
  max_units: number
  servicio_agua: boolean
  servicio_condominios: boolean
  project_count?: number
  user_count?: number
  unit_count?: number
}

export function SuperAdminSection() {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [loading, setLoading] = useState(true)
  const [editingMax, setEditingMax] = useState<Record<string, number>>({})
  const [editingMaxUnits, setEditingMaxUnits] = useState<Record<string, number>>({})
  const [maxUnitsSupported, setMaxUnitsSupported] = useState(false)

  const cargar = useCallback(async () => {
    setLoading(true)

    // Try with max_units first; fall back without it if the column doesn't exist yet
    let companiesData: Empresa[] | null = null
    const { data: fullData, error: fullError } = await supabase
      .from('companies')
      .select('id, nombre, nit, email, telefono, plan, activa, max_projects, max_units, servicio_agua, servicio_condominios')
      .order('nombre')

    type RawEmpresa = Omit<Empresa, 'servicio_agua' | 'servicio_condominios'> & { servicio_agua?: boolean; servicio_condominios?: boolean }
    const normalizeFlags = (c: RawEmpresa): Empresa => ({
      ...c,
      servicio_agua: c.servicio_agua ?? true,
      servicio_condominios: c.servicio_condominios ?? true,
    })

    if (!fullError && fullData) {
      companiesData = (fullData as RawEmpresa[]).map(normalizeFlags)
      setMaxUnitsSupported(true)
    } else {
      // Column max_units may not exist yet — fetch without it
      const { data: fallbackData } = await supabase
        .from('companies')
        .select('id, nombre, nit, email, telefono, plan, activa, max_projects, servicio_agua, servicio_condominios')
        .order('nombre')
      if (fallbackData) {
        companiesData = (fallbackData as (Omit<Empresa, 'max_units'> & { servicio_agua?: boolean; servicio_condominios?: boolean })[])
          .map(c => ({ ...normalizeFlags(c), max_units: 50 }))
      }
      setMaxUnitsSupported(false)
    }

    if (!companiesData) { setLoading(false); return }

    // Obtener conteos por empresa
    const empresasConConteos = await Promise.all(
      companiesData.map(async (c) => {
        const [{ count: projectCount }, { count: userCount }, unidadesResult] = await Promise.all([
          supabase.from('projects').select('id', { count: 'exact', head: true }).eq('company_id', c.id),
          supabase.from('app_users').select('id', { count: 'exact', head: true }).eq('company_id', c.id),
          supabase.from('unidades').select('id', { count: 'exact', head: true }).eq('company_id', c.id),
        ])
        return {
          ...c,
          project_count: projectCount ?? 0,
          user_count: userCount ?? 0,
          // unidades table may not exist yet
          unit_count: unidadesResult.error ? 0 : (unidadesResult.count ?? 0),
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
    const { error } = await supabase.from('companies').update({ max_projects: nuevoMax }).eq('id', empresaId)
    if (error) {
      void Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo actualizar el límite.' })
    } else {
      void Swal.fire({ icon: 'success', title: 'Actualizado', timer: 1200, showConfirmButton: false })
      setEditingMax(prev => { const n = { ...prev }; delete n[empresaId]; return n })
      void cargar()
    }
  }

  async function actualizarMaxUnidades(empresaId: string) {
    const nuevoMax = editingMaxUnits[empresaId]
    const empresa = empresas.find(e => e.id === empresaId)
    if (nuevoMax === undefined || nuevoMax < 1) {
      void Swal.fire({ icon: 'warning', title: 'Valor inválido', text: 'El mínimo es 1 unidad.' })
      return
    }
    if (empresa && nuevoMax < (empresa.unit_count ?? 0)) {
      void Swal.fire({
        icon: 'warning', title: 'Límite menor al uso actual',
        text: `Esta empresa ya tiene ${empresa.unit_count} unidades creadas. El nuevo límite debe ser igual o mayor.`,
      })
      return
    }
    const { error } = await supabase.from('companies').update({ max_units: nuevoMax }).eq('id', empresaId)
    if (error) {
      void Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo actualizar el límite de unidades.' })
    } else {
      void Swal.fire({ icon: 'success', title: 'Actualizado', timer: 1200, showConfirmButton: false })
      setEditingMaxUnits(prev => { const n = { ...prev }; delete n[empresaId]; return n })
      void cargar()
    }
  }

  async function toggleServicio(empresaId: string, campo: 'servicio_agua' | 'servicio_condominios', nuevoValor: boolean) {
    const { error } = await supabase.from('companies').update({ [campo]: nuevoValor }).eq('id', empresaId)
    if (error) {
      void Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo actualizar el servicio.' })
    } else {
      setEmpresas(prev => prev.map(e => e.id === empresaId ? { ...e, [campo]: nuevoValor } : e))
    }
  }

  async function editarEmpresa(empresa: Empresa) {
    const { value: formValues } = await Swal.fire({
      title: 'Editar Empresa',
      html: `
        <input id="swal-nombre" class="swal2-input" placeholder="Nombre de la empresa *" value="${empresa.nombre}" />
        <input id="swal-nit" class="swal2-input" placeholder="NIT" value="${empresa.nit ?? ''}" />
        <input id="swal-email" class="swal2-input" placeholder="Email de contacto" type="email" value="${empresa.email ?? ''}" />
        <input id="swal-telefono" class="swal2-input" placeholder="Teléfono" value="${empresa.telefono ?? ''}" />
        <select id="swal-plan" class="swal2-select">
          <option value="basico" ${empresa.plan === 'basico' ? 'selected' : ''}>Plan Básico</option>
          <option value="profesional" ${empresa.plan === 'profesional' ? 'selected' : ''}>Plan Profesional</option>
          <option value="enterprise" ${empresa.plan === 'enterprise' ? 'selected' : ''}>Plan Enterprise</option>
        </select>
        <label style="display:flex;align-items:center;gap:8px;margin-top:10px;justify-content:center;color:#94a3b8;font-size:14px;">
          <input id="swal-activa" type="checkbox" ${empresa.activa ? 'checked' : ''} style="width:16px;height:16px;accent-color:#0ea5e9;" />
          Empresa activa
        </label>
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
          plan: (document.getElementById('swal-plan') as HTMLSelectElement)?.value,
          activa: (document.getElementById('swal-activa') as HTMLInputElement)?.checked,
        }
      },
    })

    if (!formValues) return

    const { error } = await supabase
      .from('companies')
      .update(formValues)
      .eq('id', empresa.id)

    if (error) {
      void Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo actualizar la empresa.' })
    } else {
      void Swal.fire({ icon: 'success', title: 'Actualizado', timer: 1200, showConfirmButton: false })
      void cargar()
    }
  }

  async function crearEmpresa() {
    const { value: formValues } = await Swal.fire({
      title: 'Nueva Empresa',
      html: `
        <input id="swal-empresa" class="swal2-input" placeholder="Nombre de la empresa *" />
        <input id="swal-nit" class="swal2-input" placeholder="NIT (opcional)" />
        <input id="swal-email-empresa" class="swal2-input" placeholder="Email de la empresa (opcional)" type="email" />
        <input id="swal-telefono" class="swal2-input" placeholder="Teléfono (opcional)" />
        <input id="swal-max" class="swal2-input" placeholder="Límite de proyectos" type="number" value="5" min="1" />
        <input id="swal-max-units" class="swal2-input" placeholder="Límite de unidades" type="number" value="50" min="1" />
        <hr style="border-color:rgba(255,255,255,0.1);margin:8px 0;" />
        <input id="swal-owner-nombre" class="swal2-input" placeholder="Nombre del administrador *" />
        <input id="swal-owner-email" class="swal2-input" placeholder="Email del administrador *" type="email" />
        <input id="swal-owner-pass" class="swal2-input" placeholder="Contraseña temporal *" type="password" />
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
        const maxUnits = parseInt((document.getElementById('swal-max-units') as HTMLInputElement)?.value ?? '50')
        if (!empresaNombre || !ownerNombre || !ownerEmail || !ownerPass) {
          Swal.showValidationMessage('Los campos marcados con * son obligatorios')
          return false
        }
        if (ownerPass.length < 8) {
          Swal.showValidationMessage('La contraseña debe tener al menos 8 caracteres')
          return false
        }
        return {
          empresaNombre,
          nit: (document.getElementById('swal-nit') as HTMLInputElement)?.value?.trim() || null,
          emailEmpresa: (document.getElementById('swal-email-empresa') as HTMLInputElement)?.value?.trim() || null,
          telefono: (document.getElementById('swal-telefono') as HTMLInputElement)?.value?.trim() || null,
          ownerNombre,
          ownerEmail,
          ownerPass,
          maxProj: isNaN(maxProj) ? 5 : maxProj,
          maxUnits: isNaN(maxUnits) ? 50 : maxUnits,
        }
      },
    })

    if (!formValues) return

    // 1. Crear la empresa
    const insertPayload: Record<string, unknown> = {
      nombre: formValues.empresaNombre,
      nit: formValues.nit,
      email: formValues.emailEmpresa,
      telefono: formValues.telefono,
      max_projects: formValues.maxProj,
    }
    if (maxUnitsSupported) insertPayload.max_units = formValues.maxUnits

    const { data: nuevaEmpresa, error: empresaError } = await supabase
      .from('companies')
      .insert(insertPayload)
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
            const isEditingProj = editingMax[e.id] !== undefined
            const isEditingUnits = editingMaxUnits[e.id] !== undefined
            const unitsUsoPct = Math.round(((e.unit_count ?? 0) / e.max_units) * 100)
            const unitsAlerta = unitsUsoPct >= 80
            return (
              <div key={e.id} style={{
                background: '#1e293b', borderRadius: '14px', padding: '20px 24px',
                border: '1px solid rgba(255,255,255,0.06)',
              }}>
                {/* Fila superior: info + botón editar */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '16px' }}>{e.nombre}</div>
                      {!e.activa && (
                        <span style={{ background: '#ef444422', color: '#f87171', fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '20px', border: '1px solid #ef444444' }}>
                          Inactiva
                        </span>
                      )}
                      <span style={{ background: 'rgba(255,255,255,0.06)', color: '#94a3b8', fontSize: '11px', padding: '2px 8px', borderRadius: '20px' }}>
                        {e.plan}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '16px', marginTop: '6px', flexWrap: 'wrap' }}>
                      <span style={{ color: '#64748b', fontSize: '13px' }}>
                        <span style={{ color: '#38bdf8', fontWeight: 600 }}>{e.project_count}</span>/{e.max_projects} proyectos
                      </span>
                      <span style={{ color: '#64748b', fontSize: '13px' }}>
                        <span style={{ color: unitsAlerta ? '#f59e0b' : '#34d399', fontWeight: 600 }}>{e.unit_count ?? 0}</span>/{e.max_units} unidades
                      </span>
                      <span style={{ color: '#64748b', fontSize: '13px' }}>
                        <span style={{ color: '#a78bfa', fontWeight: 600 }}>{e.user_count}</span> usuarios
                      </span>
                      {e.nit && <span style={{ color: '#64748b', fontSize: '13px' }}>NIT: {e.nit}</span>}
                      {e.email && <span style={{ color: '#64748b', fontSize: '13px' }}>{e.email}</span>}
                      {e.telefono && <span style={{ color: '#64748b', fontSize: '13px' }}>{e.telefono}</span>}
                    </div>
                  </div>
                  <button
                    onClick={() => void editarEmpresa(e)}
                    style={{
                      padding: '6px 14px', borderRadius: '6px',
                      border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)',
                      color: '#94a3b8', cursor: 'pointer', fontSize: '12px', fontWeight: 600,
                    }}
                  >
                    Editar
                  </button>
                </div>

                {/* Barra de progreso de unidades */}
                <div style={{ marginBottom: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '11px', color: '#475569' }}>Uso de unidades</span>
                    <span style={{ fontSize: '11px', fontWeight: 600, color: unitsAlerta ? '#f59e0b' : '#34d399' }}>
                      {unitsUsoPct}%
                    </span>
                  </div>
                  <div style={{ height: '5px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.min(unitsUsoPct, 100)}%`,
                      background: unitsUsoPct >= 100 ? '#ef4444' : unitsAlerta ? '#f59e0b' : '#34d399',
                      borderRadius: '3px',
                      transition: 'width 0.3s',
                    }} />
                  </div>
                </div>

                {/* Fila de controles de límites */}
                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'center' }}>
                  {/* Límite proyectos */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ color: '#94a3b8', fontSize: '12px', whiteSpace: 'nowrap' }}>Proyectos:</span>
                    <input
                      type="number" min={1}
                      value={isEditingProj ? editingMax[e.id] : e.max_projects}
                      onChange={(ev: ChangeEvent<HTMLInputElement>) => setEditingMax(prev => ({ ...prev, [e.id]: parseInt(ev.target.value) || 1 }))}
                      style={{
                        width: '60px', padding: '5px 7px', borderRadius: '6px',
                        border: `1px solid ${isEditingProj ? '#0ea5e9' : 'rgba(255,255,255,0.1)'}`,
                        background: '#0f172a', color: '#f1f5f9', fontSize: '13px', textAlign: 'center',
                      }}
                    />
                    {isEditingProj && (
                      <>
                        <button onClick={() => void actualizarMaxProyectos(e.id)} style={{ padding: '5px 10px', borderRadius: '6px', border: 'none', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}>
                          Guardar
                        </button>
                        <button onClick={() => setEditingMax(prev => { const n = { ...prev }; delete n[e.id]; return n })} style={{ padding: '5px 8px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: '11px' }}>
                          ✕
                        </button>
                      </>
                    )}
                  </div>

                  {/* Límite unidades */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ color: '#94a3b8', fontSize: '12px', whiteSpace: 'nowrap' }}>Unidades:</span>
                    <input
                      type="number" min={1}
                      value={isEditingUnits ? editingMaxUnits[e.id] : e.max_units}
                      onChange={(ev: ChangeEvent<HTMLInputElement>) => setEditingMaxUnits(prev => ({ ...prev, [e.id]: parseInt(ev.target.value) || 1 }))}
                      style={{
                        width: '60px', padding: '5px 7px', borderRadius: '6px',
                        border: `1px solid ${isEditingUnits ? '#34d399' : 'rgba(255,255,255,0.1)'}`,
                        background: '#0f172a', color: '#f1f5f9', fontSize: '13px', textAlign: 'center',
                      }}
                    />
                    {isEditingUnits && (
                      <>
                        <button onClick={() => void actualizarMaxUnidades(e.id)} style={{ padding: '5px 10px', borderRadius: '6px', border: 'none', background: 'linear-gradient(135deg,#34d399,#059669)', color: 'white', cursor: 'pointer', fontSize: '11px', fontWeight: 600 }}>
                          Guardar
                        </button>
                        <button onClick={() => setEditingMaxUnits(prev => { const n = { ...prev }; delete n[e.id]; return n })} style={{ padding: '5px 8px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#64748b', cursor: 'pointer', fontSize: '11px' }}>
                          ✕
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Líneas de servicio */}
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <span style={{ color: '#475569', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', whiteSpace: 'nowrap' }}>Servicios:</span>

                  {/* Toggle Control Agua */}
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}>
                    <span style={{
                      position: 'relative', display: 'inline-block',
                      width: '36px', height: '20px', flexShrink: 0,
                    }}>
                      <input
                        type="checkbox"
                        checked={e.servicio_agua}
                        onChange={ev => void toggleServicio(e.id, 'servicio_agua', ev.target.checked)}
                        style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }}
                      />
                      <span style={{
                        position: 'absolute', inset: 0,
                        background: e.servicio_agua ? 'linear-gradient(135deg,#0ea5e9,#0284c7)' : 'rgba(255,255,255,0.1)',
                        borderRadius: '20px',
                        transition: 'background 0.2s',
                        boxShadow: e.servicio_agua ? '0 0 8px rgba(14,165,233,0.4)' : 'none',
                      }} />
                      <span style={{
                        position: 'absolute',
                        top: '3px',
                        left: e.servicio_agua ? '19px' : '3px',
                        width: '14px', height: '14px',
                        background: 'white',
                        borderRadius: '50%',
                        transition: 'left 0.2s',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                      }} />
                    </span>
                    <span style={{ fontSize: '12px', color: e.servicio_agua ? '#38bdf8' : '#475569', fontWeight: 500, whiteSpace: 'nowrap' }}>
                      Control Agua
                    </span>
                  </label>

                  {/* Toggle Condominios */}
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}>
                    <span style={{
                      position: 'relative', display: 'inline-block',
                      width: '36px', height: '20px', flexShrink: 0,
                    }}>
                      <input
                        type="checkbox"
                        checked={e.servicio_condominios}
                        onChange={ev => void toggleServicio(e.id, 'servicio_condominios', ev.target.checked)}
                        style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }}
                      />
                      <span style={{
                        position: 'absolute', inset: 0,
                        background: e.servicio_condominios ? 'linear-gradient(135deg,#a78bfa,#7c3aed)' : 'rgba(255,255,255,0.1)',
                        borderRadius: '20px',
                        transition: 'background 0.2s',
                        boxShadow: e.servicio_condominios ? '0 0 8px rgba(167,139,250,0.4)' : 'none',
                      }} />
                      <span style={{
                        position: 'absolute',
                        top: '3px',
                        left: e.servicio_condominios ? '19px' : '3px',
                        width: '14px', height: '14px',
                        background: 'white',
                        borderRadius: '50%',
                        transition: 'left 0.2s',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                      }} />
                    </span>
                    <span style={{ fontSize: '12px', color: e.servicio_condominios ? '#a78bfa' : '#475569', fontWeight: 500, whiteSpace: 'nowrap' }}>
                      Condominios
                    </span>
                  </label>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
