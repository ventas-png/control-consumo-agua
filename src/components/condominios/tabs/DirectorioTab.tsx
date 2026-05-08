import { useState, useEffect, type CSSProperties} from 'react'
import { supabase } from '../../../lib/supabase'
import type { PersonalCondominio, ContactoEmergencia } from '../../../types'

interface ResidenteEntry {
  unidad_nombre: string
  nombre?: string
  telefono?: string
  email?: string
  identificacion?: string
}

interface Props {
  personal: PersonalCondominio[]
  contactosEmergencia: ContactoEmergencia[]
  proyectoId: string
  companyId: string
}

type DirectorioTab = 'residentes' | 'personal' | 'emergencias'

const CARGO_ICONS: Record<string, string> = {
  conserje: '🧹', guardia: '🛡️', jardinero: '🌿', mantenimiento: '🔧',
  administrador: '👔', otro: '👤',
}

export function DirectorioTab({ personal, contactosEmergencia, proyectoId }: Props) {
  const [activeTab, setActiveTab] = useState<DirectorioTab>('residentes')
  const [residentes, setResidentes] = useState<ResidenteEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (activeTab !== 'residentes' || !proyectoId) return
    setLoading(true)
    supabase.from('unidades')
      .select('nombre, clientes(nombre, telefono, email, identificacion)')
      .eq('project_id', proyectoId)
      .order('nombre')
      .then(({ data }) => {
        setResidentes((data ?? []).map((r: Record<string, unknown>) => {
          const c = r.clientes as Record<string, unknown> | null
          return {
            unidad_nombre: r.nombre as string,
            nombre:        c?.nombre        as string | undefined,
            telefono:      c?.telefono      as string | undefined,
            email:         c?.email         as string | undefined,
            identificacion:c?.identificacion as string | undefined,
          }
        }))
        setLoading(false)
      })
  }, [activeTab, proyectoId])

  const filterStr = search.toLowerCase()

  const filteredResidentes = residentes.filter(r =>
    !filterStr ||
    r.unidad_nombre.toLowerCase().includes(filterStr) ||
    (r.nombre ?? '').toLowerCase().includes(filterStr) ||
    (r.email ?? '').toLowerCase().includes(filterStr) ||
    (r.telefono ?? '').includes(filterStr)
  )

  const filteredPersonal = personal.filter(p =>
    !filterStr ||
    p.nombre.toLowerCase().includes(filterStr) ||
    p.cargo.toLowerCase().includes(filterStr) ||
    (p.telefono ?? '').includes(filterStr)
  )

  const filteredEmergencias = contactosEmergencia.filter(c =>
    !filterStr ||
    c.nombre.toLowerCase().includes(filterStr) ||
    c.tipo.toLowerCase().includes(filterStr) ||
    (c.telefono ?? '').includes(filterStr)
  )

  const tabStyle = (t: DirectorioTab): CSSProperties => ({
    padding: '7px 16px', fontSize: '13px', fontWeight: 600, borderRadius: '8px', border: 'none',
    cursor: 'pointer', background: activeTab === t ? '#0ea5e9' : 'transparent', color: activeTab === t ? 'white' : '#64748b',
  })

  const cardStyle: CSSProperties = {
    background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '10px', padding: '12px 14px',
    display: 'flex', gap: '12px', alignItems: 'flex-start',
  }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>Directorio</h2>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar…"
          style={{ padding: '7px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', width: '200px' }} />
      </div>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', background: '#f1f5f9', borderRadius: '10px', padding: '4px', width: 'fit-content' }}>
        <button style={tabStyle('residentes')} onClick={() => setActiveTab('residentes')}>
          🏠 Residentes ({residentes.length})
        </button>
        <button style={tabStyle('personal')} onClick={() => setActiveTab('personal')}>
          👥 Personal ({personal.length})
        </button>
        <button style={tabStyle('emergencias')} onClick={() => setActiveTab('emergencias')}>
          🆘 Emergencias ({contactosEmergencia.length})
        </button>
      </div>

      {/* Residentes */}
      {activeTab === 'residentes' && (
        loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>Cargando…</div>
        ) : filteredResidentes.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8', fontSize: '13px' }}>No se encontraron residentes.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px' }}>
            {filteredResidentes.map((r, i) => (
              <div key={i} style={cardStyle}>
                <div style={{ fontSize: '24px' }}>🏠</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '13px', color: '#0f172a' }}>{r.unidad_nombre}</div>
                  {r.nombre ? (
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>{r.nombre}</div>
                  ) : (
                    <div style={{ fontSize: '12px', color: '#cbd5e1', fontStyle: 'italic' }}>Sin residente asignado</div>
                  )}
                  {r.telefono && (
                    <a href={`tel:${r.telefono}`} style={{ fontSize: '12px', color: '#0ea5e9', display: 'block', marginTop: '2px', textDecoration: 'none' }}>📞 {r.telefono}</a>
                  )}
                  {r.email && (
                    <a href={`mailto:${r.email}`} style={{ fontSize: '11px', color: '#64748b', display: 'block', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>✉️ {r.email}</a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Personal */}
      {activeTab === 'personal' && (
        filteredPersonal.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8', fontSize: '13px' }}>No se encontró personal.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px' }}>
            {filteredPersonal.map(p => (
              <div key={p.id} style={cardStyle}>
                <div style={{ fontSize: '24px' }}>{CARGO_ICONS[p.cargo] ?? '👤'}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '13px', color: '#0f172a' }}>{p.nombre}</div>
                  <div style={{ fontSize: '12px', color: '#64748b', textTransform: 'capitalize' }}>{p.cargo}</div>
                  {p.telefono && (
                    <a href={`tel:${p.telefono}`} style={{ fontSize: '12px', color: '#0ea5e9', display: 'block', marginTop: '2px', textDecoration: 'none' }}>📞 {p.telefono}</a>
                  )}
                  {p.email && (
                    <a href={`mailto:${p.email}`} style={{ fontSize: '11px', color: '#64748b', display: 'block', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>✉️ {p.email}</a>
                  )}
                  <div style={{ marginTop: '4px' }}>
                    <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: '20px',
                      background: p.estado === 'activo' ? '#dcfce7' : '#f1f5f9',
                      color: p.estado === 'activo' ? '#16a34a' : '#94a3b8' }}>
                      {p.estado}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Emergencias */}
      {activeTab === 'emergencias' && (
        filteredEmergencias.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8', fontSize: '13px' }}>No se encontraron contactos de emergencia.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px' }}>
            {filteredEmergencias.map(c => (
              <div key={c.id} style={{ ...cardStyle, borderLeft: '4px solid #ef4444' }}>
                <div style={{ fontSize: '24px' }}>🚨</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '13px', color: '#0f172a' }}>{c.nombre}</div>
                  <div style={{ fontSize: '12px', color: '#64748b', textTransform: 'capitalize' }}>{c.tipo}</div>
                  {c.telefono && (
                    <a href={`tel:${c.telefono}`} style={{ fontSize: '13px', fontWeight: 700, color: '#ef4444', display: 'block', marginTop: '4px', textDecoration: 'none' }}>📞 {c.telefono}</a>
                  )}
                  {c.telefono_alternativo && <div style={{ fontSize: '11px', color: '#94a3b8' }}>Alt: {c.telefono_alternativo}</div>}
                  {c.disponible_24h && <div style={{ fontSize: '11px', color: '#10b981', marginTop: '2px', fontWeight: 600 }}>⏰ Disponible 24h</div>}
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}
