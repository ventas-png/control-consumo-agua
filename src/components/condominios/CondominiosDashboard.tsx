import { useState, useEffect, useCallback, type CSSProperties} from 'react'
import type { UserSession, Proyecto, Unidad, AppSection } from '../../types'
import { supabase } from '../../lib/supabase'

interface Props {
  currentUser: UserSession
  proyectos: Proyecto[]
  unidades: Unidad[]
  onNavigateSection: (s: AppSection) => void
}

interface ProjectStats {
  ocupadas: number
  totalUnidades: number
  cuotasPendientes: number
  cuotasMora: number
  visitantesHoy: number
  ticketsAbiertos: number
  comunSinAsignar: number
}

const EMPTY_STATS = (): ProjectStats => ({
  ocupadas: 0, totalUnidades: 0,
  cuotasPendientes: 0, cuotasMora: 0,
  visitantesHoy: 0, ticketsAbiertos: 0,
  comunSinAsignar: 0,
})

export function CondominiosDashboard({ currentUser, proyectos, unidades, onNavigateSection }: Props) {
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [projectInitialized, setProjectInitialized] = useState(false)
  const [stats, setStats] = useState<ProjectStats>(EMPTY_STATS())
  const [perProject, setPerProject] = useState<Record<string, ProjectStats>>({})
  const companyId = currentUser.company_id

  const proyectosActivos = proyectos.filter(p => p.estado === 'activo')

  useEffect(() => {
    if (proyectosActivos.length > 0 && !projectInitialized) {
      if (proyectosActivos.length === 1) {
        setSelectedProjectId(proyectosActivos[0].id)
      }
      setProjectInitialized(true)
    }
  }, [proyectosActivos.length, projectInitialized])

  const cargarStats = useCallback(async () => {
    if (!companyId) return
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
    const todayISO = todayStart.toISOString()

    const mkBase = (table: string) => {
      let q = supabase.from(table).select('id', { count: 'exact', head: true }).eq('company_id', companyId)
      if (selectedProjectId) q = q.eq('project_id', selectedProjectId)
      return q
    }

    if (selectedProjectId) {
      const unidadesProyecto = unidades.filter(u => u.project_id === selectedProjectId)
      const [cuotasPendRes, cuotasMoraRes, visitantesRes, ticketsRes, comunRes] = await Promise.all([
        mkBase('cuotas_condominio').eq('estado', 'pendiente'),
        mkBase('cuotas_condominio').eq('estado', 'mora'),
        mkBase('visitantes').gte('hora_entrada', todayISO),
        supabase.from('tickets_mantenimiento').select('id', { count: 'exact', head: true })
          .eq('company_id', companyId).eq('project_id', selectedProjectId).neq('estado', 'cerrado'),
        supabase.from('conversations').select('id', { count: 'exact', head: true })
          .eq('company_id', companyId).eq('service_type', 'condominios').eq('project_id', selectedProjectId)
          .in('status', ['abierta', 'en_progreso', 'esperando_cliente']).is('assigned_to', null),
      ])
      setStats({
        totalUnidades: unidadesProyecto.length,
        ocupadas: unidadesProyecto.filter(u => u.estado_ocupacional === 'habitado').length,
        cuotasPendientes: cuotasPendRes.count ?? 0,
        cuotasMora: cuotasMoraRes.count ?? 0,
        visitantesHoy: visitantesRes.count ?? 0,
        ticketsAbiertos: ticketsRes.count ?? 0,
        comunSinAsignar: comunRes.count ?? 0,
      })
      setPerProject({})
    } else {
      // All projects: lightweight row fetch + JS aggregation
      const [cuotasRes, visitantesRes, ticketsRes, comunRes] = await Promise.all([
        supabase.from('cuotas_condominio').select('project_id, estado').eq('company_id', companyId),
        supabase.from('visitantes').select('project_id').eq('company_id', companyId).gte('hora_entrada', todayISO),
        supabase.from('tickets_mantenimiento').select('project_id, estado').eq('company_id', companyId).neq('estado', 'cerrado'),
        supabase.from('conversations').select('project_id').eq('company_id', companyId)
          .eq('service_type', 'condominios').in('status', ['abierta', 'en_progreso', 'esperando_cliente']).is('assigned_to', null),
      ])

      const byProject: Record<string, ProjectStats> = {}
      const ensure = (pid: string) => { if (!byProject[pid]) byProject[pid] = EMPTY_STATS() }

      // Unidades por proyecto
      for (const u of unidades) {
        if (!u.project_id) continue
        ensure(u.project_id)
        byProject[u.project_id].totalUnidades++
        if (u.estado_ocupacional === 'habitado') byProject[u.project_id].ocupadas++
      }
      for (const r of cuotasRes.data ?? []) {
        const pid = r.project_id; if (!pid) continue; ensure(pid)
        if (r.estado === 'pendiente') byProject[pid].cuotasPendientes++
        if (r.estado === 'mora') byProject[pid].cuotasMora++
      }
      for (const r of visitantesRes.data ?? []) { const pid = r.project_id; if (!pid) continue; ensure(pid); byProject[pid].visitantesHoy++ }
      for (const r of ticketsRes.data ?? []) { const pid = r.project_id; if (!pid) continue; ensure(pid); byProject[pid].ticketsAbiertos++ }
      for (const r of comunRes.data ?? []) { const pid = r.project_id; if (!pid) continue; ensure(pid); byProject[pid].comunSinAsignar++ }

      const totals = EMPTY_STATS()
      for (const s of Object.values(byProject)) {
        totals.totalUnidades += s.totalUnidades; totals.ocupadas += s.ocupadas
        totals.cuotasPendientes += s.cuotasPendientes; totals.cuotasMora += s.cuotasMora
        totals.visitantesHoy += s.visitantesHoy; totals.ticketsAbiertos += s.ticketsAbiertos
        totals.comunSinAsignar += s.comunSinAsignar
      }
      setStats(totals)
      setPerProject(byProject)
    }
  }, [companyId, selectedProjectId, unidades])

  useEffect(() => { void cargarStats() }, [cargarStats])

  const kpis = [
    { label: 'Unidades ocupadas', value: `${stats.ocupadas}/${stats.totalUnidades}`, sub: 'habitadas vs total', icon: '🏠', from: 'var(--at-accent)', to: 'var(--at-accent-hover)' },
    { label: 'Cuotas pendientes', value: stats.cuotasPendientes, sub: 'por cobrar', icon: '💰', from: 'var(--at-warning)', to: 'var(--at-warning)' },
    { label: 'Cuotas en mora', value: stats.cuotasMora, sub: 'vencidas', icon: '⚠️', from: 'var(--at-danger)', to: 'var(--at-danger)' },
    { label: 'Visitantes hoy', value: stats.visitantesHoy, sub: 'entradas del día', icon: '👥', from: 'var(--at-accent-2)', to: 'var(--at-primary-hover)' },
    { label: 'Tickets abiertos', value: stats.ticketsAbiertos, sub: 'mantenimiento', icon: '🔧', from: 'var(--at-warning)', to: 'var(--at-warning)' },
    { label: 'Comun. sin asignar', value: stats.comunSinAsignar, sub: 'sin agente', icon: '💬', from: 'var(--at-primary)', to: 'var(--at-primary-hover)' },
  ] as const

  const accesos = [
    { label: 'Visitantes', icon: '👥', section: 'condominios_visitantes' as AppSection },
    { label: 'Cuotas', icon: '💰', section: 'condominios_cuotas' as AppSection },
    { label: 'Mantenimiento', icon: '🔧', section: 'condominios_mantenimiento' as AppSection },
    { label: 'Módulo Completo', icon: '🏢', section: 'condominios' as AppSection },
  ]

  const cardStyle = (from: string, to: string): CSSProperties => ({
    background: `linear-gradient(135deg, ${from}, ${to})`,
    borderRadius: '16px', padding: '24px', color: 'white',
    boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
    display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
  })

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '28px', fontWeight: 700, color: 'var(--at-ink)', marginBottom: '16px' }}>
          Panel — Condominios
        </h1>

        {/* Selector de proyecto */}
        {proyectosActivos.length > 0 && (
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '24px' }}>
            <label style={{ fontSize: '14px', fontWeight: 600, color: 'var(--at-ink-2)' }}>Proyecto:</label>
            <select
              value={selectedProjectId}
              onChange={e => setSelectedProjectId(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--at-line)', fontSize: '14px', fontWeight: 500, background: 'var(--at-surface)', cursor: 'pointer', minWidth: '200px' }}
            >
              <option value="">-- Todos los proyectos --</option>
              {proyectosActivos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '32px' }}>
        {kpis.map(k => (
          <div key={k.label} style={cardStyle(k.from, k.to)}>
            <div style={{ fontSize: '28px', marginBottom: '4px' }}>{k.icon}</div>
            <div style={{ fontSize: '30px', fontWeight: 800, lineHeight: 1 }}>{k.value}</div>
            <div style={{ marginTop: '8px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, opacity: 0.95 }}>{k.label}</div>
              <div style={{ fontSize: '11px', opacity: 0.8, marginTop: '2px' }}>{k.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Accesos rápidos */}
      <div style={{ marginBottom: '32px' }}>
        <h3 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Acceso Rápido</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px' }}>
          {accesos.map(a => (
            <button
              key={a.label}
              onClick={() => onNavigateSection(a.section)}
              style={{ padding: '16px', background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '12px', cursor: 'pointer', textAlign: 'center', transition: 'box-shadow 0.15s, transform 0.15s', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 6px 20px rgba(0,0,0,0.1)'; (e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-2px)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)'; (e.currentTarget as HTMLButtonElement).style.transform = '' }}
            >
              <div style={{ fontSize: '28px', marginBottom: '8px' }}>{a.icon}</div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)' }}>{a.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Tabla por proyecto */}
      {!selectedProjectId && proyectosActivos.length > 1 && Object.keys(perProject).length > 0 && (
        <div style={{ marginBottom: '32px' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Comparativa por Proyecto</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: 'var(--at-surface-2)' }}>
                  <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, color: 'var(--at-ink-2)', borderBottom: '2px solid var(--at-line)' }}>Proyecto</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: 'var(--at-accent-hover)', borderBottom: '2px solid var(--at-line)' }}>🏠 Ocupación</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: 'var(--at-warning)', borderBottom: '2px solid var(--at-line)' }}>💰 Pendientes</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: 'var(--at-danger)', borderBottom: '2px solid var(--at-line)' }}>⚠️ Mora</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: 'var(--at-primary-hover)', borderBottom: '2px solid var(--at-line)' }}>👥 Visitantes hoy</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: 'var(--at-warning)', borderBottom: '2px solid var(--at-line)' }}>🔧 Tickets</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: 'var(--at-primary-hover)', borderBottom: '2px solid var(--at-line)' }}>💬 Sin asignar</th>
                </tr>
              </thead>
              <tbody>
                {proyectosActivos.map((p, i) => {
                  const s = perProject[p.id] ?? EMPTY_STATS()
                  const hasMora = s.cuotasMora > 0
                  return (
                    <tr
                      key={p.id}
                      style={{ background: i % 2 === 0 ? 'var(--at-surface)' : 'var(--at-surface-2)', cursor: 'pointer', transition: 'background 0.15s' }}
                      onClick={() => setSelectedProjectId(p.id)}
                      onMouseEnter={e => (e.currentTarget as HTMLTableRowElement).style.background = 'var(--at-primary-tint)'}
                      onMouseLeave={e => (e.currentTarget as HTMLTableRowElement).style.background = i % 2 === 0 ? 'var(--at-surface)' : 'var(--at-surface-2)'}
                    >
                      <td style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--at-ink)', borderBottom: '1px solid var(--at-chip)' }}>
                        {hasMora && <span style={{ color: 'var(--at-danger)', marginRight: 6 }}>●</span>}
                        {p.nombre}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid var(--at-chip)', color: 'var(--at-accent-hover)', fontWeight: 600 }}>{s.ocupadas}/{s.totalUnidades}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid var(--at-chip)', fontWeight: s.cuotasPendientes > 0 ? 700 : 400, color: s.cuotasPendientes > 0 ? 'var(--at-warning)' : 'var(--at-ink-3)' }}>{s.cuotasPendientes}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid var(--at-chip)', fontWeight: s.cuotasMora > 0 ? 700 : 400, color: s.cuotasMora > 0 ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>{s.cuotasMora}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid var(--at-chip)', fontWeight: s.visitantesHoy > 0 ? 700 : 400, color: s.visitantesHoy > 0 ? 'var(--at-primary-hover)' : 'var(--at-ink-3)' }}>{s.visitantesHoy}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid var(--at-chip)', fontWeight: s.ticketsAbiertos > 0 ? 700 : 400, color: s.ticketsAbiertos > 0 ? 'var(--at-warning)' : 'var(--at-ink-3)' }}>{s.ticketsAbiertos}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', borderBottom: '1px solid var(--at-chip)', fontWeight: s.comunSinAsignar > 0 ? 700 : 400, color: s.comunSinAsignar > 0 ? 'var(--at-primary-hover)' : 'var(--at-ink-3)' }}>{s.comunSinAsignar}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: 8 }}>Haz clic en un proyecto para filtrar el panel</p>
          </div>
        </div>
      )}
    </div>
  )
}
