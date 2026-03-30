import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import type { UserSession } from '../../types'

interface Props {
  currentUser: UserSession
  onLogout: () => void
}

interface CompanyInfo {
  id: string
  nombre: string
}

interface ProjectInfo {
  id: string
  nombre: string
  company_id: string
  moneda: string
}

interface UnidadInfo {
  id: string
  nombre: string
  tipo: string
  piso: number | null
  area_m2: number | null
  project_id: string
  company_id: string
  activo: boolean
}

interface ContadorInfo {
  id: string
  numero_serie: string
  tipo_agua: string
  descripcion: string | null
  activo: boolean
  unidad_id: string | null
  project_id: string
  company_id: string
}

interface LecturaInfo {
  id: string
  fecha: string
  lectura_anterior: number
  lectura_actual: number
  consumo: number
  monto_calculado: number
  estado: string
  mes: string | null
  tipo_cobro: string
  contador_id: string | null
}

interface ClienteContacto {
  email: string | null
  telefono: string | null
  whatsapp: string | null
  telefono_alterno: string | null
}

const TIPO_AGUA_LABELS: Record<string, string> = {
  potable: 'Agua Potable',
  rehuso: 'Agua de Rehúso',
  piscina: 'Piscina',
  desalinada: 'Agua Desalinada',
  riego: 'Riego',
  jacuzzi: 'Jacuzzi',
  consumo_humano: 'Consumo Humano',
  desmineralizada: 'Desmineralizada',
  residuales_tratadas: 'Residuales Tratadas',
}

const ESTADO_COLORS: Record<string, { bg: string; color: string; label: string }> = {
  pendiente: { bg: '#fef3c7', color: '#92400e', label: 'Pendiente' },
  pagado: { bg: '#d1fae5', color: '#065f46', label: 'Pagado' },
  mora: { bg: '#fee2e2', color: '#991b1b', label: 'Mora' },
}

type PortalTab = 'servicios' | 'perfil'

export function CustomerPortal({ currentUser, onLogout }: Props) {
  const [tab, setTab] = useState<PortalTab>('servicios')
  const [loading, setLoading] = useState(true)
  const [companies, setCompanies] = useState<CompanyInfo[]>([])
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [unidades, setUnidades] = useState<UnidadInfo[]>([])
  const [contadores, setContadores] = useState<ContadorInfo[]>([])
  const [lecturas, setLecturas] = useState<LecturaInfo[]>([])
  const [contacto, setContacto] = useState<ClienteContacto>({
    email: null, telefono: null, whatsapp: null, telefono_alterno: null,
  })
  const [contactoEdit, setContactoEdit] = useState<ClienteContacto>({
    email: null, telefono: null, whatsapp: null, telefono_alterno: null,
  })
  const [savingContacto, setSavingContacto] = useState(false)
  const [contactoMsg, setContactoMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [expandedContador, setExpandedContador] = useState<string | null>(null)

  const clienteId = currentUser.cliente_id

  const cargarDatos = useCallback(async () => {
    if (!clienteId) { setLoading(false); return }
    setLoading(true)
    try {
      const [
        { data: ccData },
        { data: uData },
        { data: cData },
        { data: rData },
        { data: clData },
      ] = await Promise.all([
        // Companies the client belongs to
        supabase
          .from('company_clientes')
          .select('company_id, companies(id, nombre)')
          .eq('cliente_id', clienteId),
        // Active units
        supabase
          .from('unidades')
          .select('id, nombre, tipo, piso, area_m2, project_id, company_id, activo')
          .eq('cliente_id', clienteId)
          .eq('activo', true),
        // Active meters
        supabase
          .from('contadores')
          .select('id, numero_serie, tipo_agua, descripcion, activo, unidad_id, project_id, company_id')
          .eq('cliente_id', clienteId)
          .eq('activo', true),
        // Reading history (last 50)
        supabase
          .from('registros')
          .select('id, fecha, lectura_anterior, lectura_actual, consumo, monto_calculado, estado, mes, tipo_cobro, contador_id')
          .eq('cliente_id', clienteId)
          .order('fecha', { ascending: false })
          .limit(50),
        // Own contact info
        supabase
          .from('clientes')
          .select('email, telefono, whatsapp, telefono_alterno')
          .eq('id', clienteId)
          .single(),
      ])

      // Build companies list from junction
      const companyMap: Record<string, CompanyInfo> = {}
      if (ccData) {
        for (const row of ccData as { company_id: string; companies: { id: string; nombre: string } | null }[]) {
          if (row.companies) companyMap[row.companies.id] = row.companies
        }
      }
      const companiesList = Object.values(companyMap)
      setCompanies(companiesList)

      // Fetch projects for found companies
      if (companiesList.length > 0) {
        const { data: pData } = await supabase
          .from('projects')
          .select('id, nombre, company_id, moneda')
          .in('company_id', companiesList.map(c => c.id))
          .eq('estado', 'activo')
        setProjects((pData as ProjectInfo[]) ?? [])
      } else {
        setProjects([])
      }

      setUnidades((uData as UnidadInfo[]) ?? [])
      setContadores((cData as ContadorInfo[]) ?? [])
      setLecturas((rData as LecturaInfo[]) ?? [])

      if (clData) {
        const c = clData as ClienteContacto
        setContacto(c)
        setContactoEdit(c)
      }
    } finally {
      setLoading(false)
    }
  }, [clienteId])

  useEffect(() => {
    cargarDatos()
  }, [cargarDatos])

  async function guardarContacto() {
    if (!clienteId) return
    setSavingContacto(true)
    setContactoMsg(null)
    const { error } = await supabase
      .from('clientes')
      .update({
        email: contactoEdit.email?.trim() || null,
        telefono: contactoEdit.telefono?.trim() || null,
        whatsapp: contactoEdit.whatsapp?.trim() || null,
        telefono_alterno: contactoEdit.telefono_alterno?.trim() || null,
      })
      .eq('id', clienteId)

    setSavingContacto(false)
    if (error) {
      setContactoMsg({ type: 'error', text: 'No se pudo guardar. Intente nuevamente.' })
    } else {
      setContacto(contactoEdit)
      setContactoMsg({ type: 'success', text: 'Información de contacto actualizada correctamente.' })
    }
  }

  const hasServices = contadores.length > 0 || unidades.length > 0

  // ── Loading ──────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 50%, #0d9488 100%)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <div style={{
            width: '44px', height: '44px',
            border: '3px solid rgba(255,255,255,0.25)',
            borderTop: '3px solid white',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }} />
          <span style={{ color: 'white', fontSize: '15px', fontWeight: 500 }}>Cargando portal...</span>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    )
  }

  // ── No services screen ───────────────────────────────────
  if (!hasServices) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 50%, #0d9488 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px',
      }}>
        <div style={{
          background: 'white', borderRadius: '24px', padding: '48px 40px',
          maxWidth: '480px', width: '100%', textAlign: 'center',
          boxShadow: '0 24px 64px rgba(0,0,0,0.16)',
        }}>
          <div style={{ fontSize: '56px', marginBottom: '20px' }}>💧</div>
          <h2 style={{ margin: '0 0 12px', fontSize: '22px', fontWeight: 700, color: '#0f172a' }}>
            Sin servicios asociados
          </h2>
          <p style={{ margin: '0 0 8px', fontSize: '15px', color: '#475569', lineHeight: 1.6 }}>
            Por el momento no cuenta con contadores ni unidades activas vinculadas a su cuenta.
          </p>
          <p style={{ margin: '0 0 32px', fontSize: '13.5px', color: '#94a3b8' }}>
            Si cree que esto es un error, comuníquese con su empresa de servicios de agua.
          </p>
          <div style={{
            background: '#f1f5f9', borderRadius: '12px', padding: '16px',
            fontSize: '13px', color: '#64748b', marginBottom: '28px',
          }}>
            <strong style={{ color: '#334155' }}>Sesión activa:</strong> {currentUser.name}
            <br />{currentUser.email}
          </div>
          <button
            onClick={onLogout}
            style={{
              padding: '12px 32px', background: 'linear-gradient(135deg, #0ea5e9, #0d9488)',
              color: 'white', border: 'none', borderRadius: '12px',
              fontSize: '14px', fontWeight: 600, cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(14,165,233,0.35)',
            }}
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    )
  }

  // ── Full portal ──────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#f0f9ff' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .portal-tab:hover { background: rgba(14,165,233,0.08) !important; }
        .portal-tab.active { background: white !important; color: #0ea5e9 !important; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
        .portal-card:hover { box-shadow: 0 8px 24px rgba(0,0,0,0.1) !important; transform: translateY(-1px); }
        .contador-row:hover { background: #f0f9ff !important; cursor: pointer; }
        .lectura-row:nth-child(even) { background: #f8fafc; }
        .portal-input:focus { outline: none; border-color: #0ea5e9 !important; box-shadow: 0 0 0 3px rgba(14,165,233,0.12); }
      `}</style>

      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #0ea5e9, #0d9488)',
        padding: '0',
        boxShadow: '0 2px 12px rgba(14,165,233,0.3)',
      }}>
        <div style={{
          maxWidth: '900px', margin: '0 auto',
          padding: '16px 24px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '12px', flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{
              width: '38px', height: '38px', borderRadius: '10px',
              background: 'rgba(255,255,255,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '20px',
            }}>💧</div>
            <div>
              <div style={{ color: 'white', fontWeight: 700, fontSize: '16px' }}>
                {currentUser.name}
              </div>
              <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: '12px' }}>
                Portal de cliente
              </div>
            </div>
          </div>
          <button
            onClick={onLogout}
            style={{
              padding: '8px 18px', background: 'rgba(255,255,255,0.15)',
              color: 'white', border: '1.5px solid rgba(255,255,255,0.3)',
              borderRadius: '10px', fontSize: '13px', fontWeight: 500,
              cursor: 'pointer', transition: 'background 0.2s',
            }}
          >
            Cerrar sesión
          </button>
        </div>

        {/* Tabs */}
        <div style={{
          maxWidth: '900px', margin: '0 auto',
          padding: '0 24px',
          display: 'flex', gap: '4px',
        }}>
          {([
            { key: 'servicios', label: 'Mis Servicios', icon: '📊' },
            { key: 'perfil', label: 'Mi Perfil', icon: '👤' },
          ] as const).map(t => (
            <button
              key={t.key}
              className={`portal-tab${tab === t.key ? ' active' : ''}`}
              onClick={() => setTab(t.key)}
              style={{
                padding: '10px 18px',
                background: tab === t.key ? 'white' : 'transparent',
                color: tab === t.key ? '#0ea5e9' : 'rgba(255,255,255,0.85)',
                border: 'none',
                borderRadius: '10px 10px 0 0',
                fontSize: '13.5px', fontWeight: 600,
                cursor: 'pointer', transition: 'all 0.18s',
                display: 'flex', alignItems: 'center', gap: '6px',
              }}
            >
              <span>{t.icon}</span> {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '28px 24px' }}>

        {/* ── TAB: SERVICIOS ── */}
        {tab === 'servicios' && (
          <div>
            {/* Summary cards */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: '14px',
              marginBottom: '28px',
            }}>
              {[
                { icon: '🏢', label: 'Empresas', value: companies.length, color: '#6366f1' },
                { icon: '🏠', label: 'Unidades activas', value: unidades.length, color: '#0ea5e9' },
                { icon: '💧', label: 'Contadores activos', value: contadores.length, color: '#0d9488' },
                { icon: '📋', label: 'Registros de lectura', value: lecturas.length, color: '#f59e0b' },
              ].map(s => (
                <div
                  key={s.label}
                  className="portal-card"
                  style={{
                    background: 'white', borderRadius: '14px', padding: '18px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                    display: 'flex', alignItems: 'center', gap: '14px',
                    transition: 'all 0.2s',
                  }}
                >
                  <div style={{
                    width: '40px', height: '40px', borderRadius: '10px',
                    background: `${s.color}18`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '18px', flexShrink: 0,
                  }}>{s.icon}</div>
                  <div>
                    <div style={{ fontSize: '22px', fontWeight: 700, color: s.color }}>{s.value}</div>
                    <div style={{ fontSize: '12px', color: '#64748b' }}>{s.label}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Companies & meters tree */}
            {companies.map(company => {
              const companyProjects = projects.filter(p => p.company_id === company.id)
              const companyContadores = contadores.filter(c => c.company_id === company.id)
              const companyUnidades = unidades.filter(u => u.company_id === company.id)
              if (companyContadores.length === 0 && companyUnidades.length === 0) return null
              return (
                <div key={company.id} style={{ marginBottom: '24px' }}>
                  {/* Company header */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    marginBottom: '14px',
                  }}>
                    <div style={{
                      width: '32px', height: '32px', borderRadius: '8px',
                      background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '15px', color: 'white',
                    }}>🏢</div>
                    <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#1e293b' }}>
                      {company.nombre}
                    </h2>
                  </div>

                  {/* Contadores for this company */}
                  {companyContadores.map(contador => {
                    const unidad = unidades.find(u => u.id === contador.unidad_id)
                    const project = companyProjects.find(p => p.id === contador.project_id)
                    const moneda = project?.moneda ?? 'Q'
                    const contLecturas = lecturas
                      .filter(l => l.contador_id === contador.id)
                      .slice(0, 12)
                    const isExpanded = expandedContador === contador.id

                    return (
                      <div
                        key={contador.id}
                        className="portal-card"
                        style={{
                          background: 'white', borderRadius: '14px',
                          marginBottom: '12px',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                          overflow: 'hidden',
                          transition: 'all 0.2s',
                        }}
                      >
                        {/* Meter header row */}
                        <div
                          className="contador-row"
                          onClick={() => setExpandedContador(isExpanded ? null : contador.id)}
                          style={{
                            padding: '16px 20px',
                            display: 'flex', alignItems: 'center',
                            justifyContent: 'space-between', gap: '12px',
                            transition: 'background 0.15s',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                            <div style={{
                              width: '36px', height: '36px', borderRadius: '9px', flexShrink: 0,
                              background: 'linear-gradient(135deg, #0ea5e9, #0d9488)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: '16px', color: 'white',
                            }}>💧</div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600, color: '#0f172a', fontSize: '14.5px' }}>
                                Contador #{contador.numero_serie}
                              </div>
                              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                                {TIPO_AGUA_LABELS[contador.tipo_agua] ?? contador.tipo_agua}
                                {unidad && ` · ${unidad.nombre}`}
                                {project && ` · ${project.nombre}`}
                              </div>
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                            <span style={{
                              padding: '3px 10px', borderRadius: '20px',
                              background: '#dcfce7', color: '#166534',
                              fontSize: '11px', fontWeight: 600,
                            }}>Activo</span>
                            <span style={{ color: '#94a3b8', fontSize: '16px', transition: 'transform 0.2s', display: 'inline-block', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)' }}>▼</span>
                          </div>
                        </div>

                        {/* Reading history */}
                        {isExpanded && (
                          <div style={{ borderTop: '1px solid #f1f5f9' }}>
                            {contLecturas.length === 0 ? (
                              <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: '13.5px' }}>
                                No hay lecturas registradas para este contador.
                              </div>
                            ) : (
                              <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                  <thead>
                                    <tr style={{ background: '#f8fafc' }}>
                                      {['Fecha', 'Período', 'Lect. anterior', 'Lect. actual', 'Consumo (m³)', `Monto (${moneda})`, 'Estado'].map(h => (
                                        <th key={h} style={{
                                          padding: '10px 14px', textAlign: 'left',
                                          fontSize: '11.5px', fontWeight: 600,
                                          color: '#64748b', whiteSpace: 'nowrap',
                                          borderBottom: '1px solid #e2e8f0',
                                        }}>{h}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {contLecturas.map(lectura => {
                                      const est = ESTADO_COLORS[lectura.estado] ?? ESTADO_COLORS.pendiente
                                      return (
                                        <tr key={lectura.id} className="lectura-row">
                                          <td style={{ padding: '10px 14px', color: '#374151', whiteSpace: 'nowrap' }}>
                                            {new Date(lectura.fecha + 'T12:00:00').toLocaleDateString('es-GT')}
                                          </td>
                                          <td style={{ padding: '10px 14px', color: '#64748b' }}>
                                            {lectura.mes ?? '—'}
                                          </td>
                                          <td style={{ padding: '10px 14px', color: '#374151', textAlign: 'right' }}>
                                            {lectura.lectura_anterior.toFixed(2)}
                                          </td>
                                          <td style={{ padding: '10px 14px', color: '#374151', textAlign: 'right' }}>
                                            {lectura.lectura_actual.toFixed(2)}
                                          </td>
                                          <td style={{ padding: '10px 14px', fontWeight: 600, color: '#0ea5e9', textAlign: 'right' }}>
                                            {lectura.consumo.toFixed(2)}
                                          </td>
                                          <td style={{ padding: '10px 14px', fontWeight: 600, color: '#0f172a', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                            {moneda} {lectura.monto_calculado.toFixed(2)}
                                          </td>
                                          <td style={{ padding: '10px 14px' }}>
                                            <span style={{
                                              padding: '3px 9px', borderRadius: '20px',
                                              background: est.bg, color: est.color,
                                              fontSize: '11px', fontWeight: 600, whiteSpace: 'nowrap',
                                            }}>{est.label}</span>
                                          </td>
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {/* Units without meters */}
                  {companyUnidades
                    .filter(u => !companyContadores.some(c => c.unidad_id === u.id))
                    .map(unidad => (
                      <div
                        key={unidad.id}
                        className="portal-card"
                        style={{
                          background: 'white', borderRadius: '14px', padding: '16px 20px',
                          marginBottom: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                          display: 'flex', alignItems: 'center', gap: '12px',
                          transition: 'all 0.2s',
                        }}
                      >
                        <div style={{
                          width: '36px', height: '36px', borderRadius: '9px', flexShrink: 0,
                          background: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '16px', color: 'white',
                        }}>🏠</div>
                        <div>
                          <div style={{ fontWeight: 600, color: '#0f172a', fontSize: '14.5px' }}>
                            {unidad.nombre}
                          </div>
                          <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                            {unidad.tipo.replace('_', ' ')}
                            {unidad.piso != null && ` · Piso ${unidad.piso}`}
                            {unidad.area_m2 != null && ` · ${unidad.area_m2} m²`}
                            {' · Sin contador asignado'}
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              )
            })}
          </div>
        )}

        {/* ── TAB: PERFIL ── */}
        {tab === 'perfil' && (
          <div>
            <div style={{
              background: 'white', borderRadius: '16px', padding: '28px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
              maxWidth: '520px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
                <div style={{
                  width: '44px', height: '44px', borderRadius: '12px',
                  background: 'linear-gradient(135deg, #0ea5e9, #0d9488)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '20px', color: 'white',
                }}>👤</div>
                <div>
                  <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#0f172a' }}>
                    {currentUser.name}
                  </h2>
                  <div style={{ fontSize: '12.5px', color: '#64748b' }}>Actualice su información de contacto</div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {([
                  { key: 'email', label: 'Correo electrónico', placeholder: 'correo@ejemplo.com', type: 'email' },
                  { key: 'telefono', label: 'Teléfono', placeholder: 'Ej. 5555-1234', type: 'tel' },
                  { key: 'whatsapp', label: 'WhatsApp', placeholder: 'Ej. 5555-1234', type: 'tel' },
                  { key: 'telefono_alterno', label: 'Teléfono alterno', placeholder: 'Ej. 2255-1234', type: 'tel' },
                ] as const).map(field => (
                  <div key={field.key}>
                    <label style={{
                      display: 'block', fontSize: '12.5px',
                      fontWeight: 600, color: '#374151', marginBottom: '5px',
                    }}>
                      {field.label}
                    </label>
                    <input
                      className="portal-input"
                      type={field.type}
                      value={contactoEdit[field.key] ?? ''}
                      onChange={e => setContactoEdit(prev => ({ ...prev, [field.key]: e.target.value }))}
                      placeholder={field.placeholder}
                      style={{
                        width: '100%', boxSizing: 'border-box',
                        padding: '10px 14px', fontSize: '14px',
                        border: '1.5px solid #e2e8f0', borderRadius: '10px',
                        background: '#f8fafc', color: '#0f172a',
                        transition: 'border-color 0.2s, box-shadow 0.2s',
                      }}
                    />
                  </div>
                ))}

                {contactoMsg && (
                  <div style={{
                    padding: '11px 14px', borderRadius: '10px', fontSize: '13px',
                    background: contactoMsg.type === 'success' ? '#f0fdf4' : '#fef2f2',
                    border: `1px solid ${contactoMsg.type === 'success' ? '#bbf7d0' : '#fecaca'}`,
                    color: contactoMsg.type === 'success' ? '#166534' : '#b91c1c',
                    display: 'flex', gap: '8px', alignItems: 'center',
                  }}>
                    <span>{contactoMsg.type === 'success' ? '✅' : '⚠️'}</span>
                    {contactoMsg.text}
                  </div>
                )}

                <button
                  onClick={guardarContacto}
                  disabled={savingContacto}
                  style={{
                    padding: '12px', marginTop: '4px',
                    background: savingContacto
                      ? '#94a3b8'
                      : 'linear-gradient(135deg, #0ea5e9, #0d9488)',
                    color: 'white', border: 'none', borderRadius: '12px',
                    fontSize: '14.5px', fontWeight: 600,
                    cursor: savingContacto ? 'not-allowed' : 'pointer',
                    boxShadow: savingContacto ? 'none' : '0 4px 14px rgba(14,165,233,0.3)',
                    transition: 'all 0.2s',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  }}
                >
                  {savingContacto ? (
                    <>
                      <div style={{
                        width: '14px', height: '14px',
                        border: '2px solid rgba(255,255,255,0.4)',
                        borderTop: '2px solid white',
                        borderRadius: '50%',
                        animation: 'spin 0.8s linear infinite',
                      }} />
                      Guardando...
                    </>
                  ) : (
                    'Guardar cambios'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
