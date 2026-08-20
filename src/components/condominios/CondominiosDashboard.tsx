import { useState, useEffect, useCallback, useMemo, type CSSProperties} from 'react'
import type { UserSession, Proyecto, Unidad, AppSection } from '../../types'
import { fetchCondominioStatsForProject, fetchCondominioStatsRows } from '../../domain/condominios/queries'
import { DataTable, type DataTableColumn } from '../shared/DataTable'

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
  const [stats, setStats] = useState<ProjectStats>(EMPTY_STATS())
  const [perProject, setPerProject] = useState<Record<string, ProjectStats>>({})
  const companyId = currentUser.company_id

  // useMemo: el `.filter()` suelto devolvía un array nuevo por render, así que
  // el efecto no podía declararlo en deps sin re-ejecutarse siempre — de ahí el
  // `.length`, que no detecta un cambio de proyectos con el mismo conteo.
  const proyectosActivos = useMemo(
    () => proyectos.filter(p => p.estado === 'activo'),
    [proyectos],
  )

  // Reconcilia la selección con los proyectos activos VIGENTES. El enfoque
  // anterior (`projectInitialized`) solo miraba la lista una vez: si el
  // proyecto seleccionado se archivaba, o si la lista cambiaba de composición
  // manteniendo el conteo, el dashboard seguía pidiendo stats de un proyecto
  // que ya no está en el selector.
  //
  // Reglas, en orden:
  //   1. selección todavía válida  → se conserva tal cual;
  //   2. inválida y hay UN activo  → se elige ese;
  //   3. inválida en cualquier otro caso (cero o varios) → '' (vista agregada).
  //
  // Actualización funcional: la decisión se toma sobre el valor ACTUAL del
  // estado, así que `selectedProjectId` no entra en las dependencias y el
  // efecto no se re-dispara por su propio setState. Devolver `actual` cuando no
  // hay cambio evita además el render extra (React descarta el update).
  useEffect(() => {
    setSelectedProjectId(actual => {
      if (actual && proyectosActivos.some(p => p.id === actual)) return actual
      if (proyectosActivos.length === 1) return proyectosActivos[0].id
      return actual === '' ? actual : ''
    })
  }, [proyectosActivos])

  const cargarStats = useCallback(async () => {
    if (!companyId) return

    if (selectedProjectId) {
      const unidadesProyecto = unidades.filter(u => u.project_id === selectedProjectId)
      const s = await fetchCondominioStatsForProject(companyId, selectedProjectId)
      setStats({
        totalUnidades: unidadesProyecto.length,
        ocupadas: unidadesProyecto.filter(u => u.estado_ocupacional === 'habitado').length,
        ...s,
      })
      setPerProject({})
    } else {
      // All projects: lightweight row fetch + JS aggregation
      const rows = await fetchCondominioStatsRows(companyId)

      const byProject: Record<string, ProjectStats> = {}
      const ensure = (pid: string) => { if (!byProject[pid]) byProject[pid] = EMPTY_STATS() }

      // Unidades por proyecto
      for (const u of unidades) {
        if (!u.project_id) continue
        ensure(u.project_id)
        byProject[u.project_id].totalUnidades++
        if (u.estado_ocupacional === 'habitado') byProject[u.project_id].ocupadas++
      }
      for (const r of rows.cuotas) {
        const pid = r.project_id; if (!pid) continue; ensure(pid)
        if (r.estado === 'pendiente') byProject[pid].cuotasPendientes++
        if (r.estado === 'mora') byProject[pid].cuotasMora++
      }
      for (const r of rows.visitantes) { const pid = r.project_id; if (!pid) continue; ensure(pid); byProject[pid].visitantesHoy++ }
      for (const r of rows.tickets) { const pid = r.project_id; if (!pid) continue; ensure(pid); byProject[pid].ticketsAbiertos++ }
      for (const r of rows.conversations) { const pid = r.project_id; if (!pid) continue; ensure(pid); byProject[pid].comunSinAsignar++ }

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

      {/* Tabla por proyecto — F3.9: migrado a <DataTable> shared */}
      {!selectedProjectId && proyectosActivos.length > 1 && Object.keys(perProject).length > 0 && (
        <div style={{ marginBottom: '32px' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--at-ink-3)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Comparativa por Proyecto</h3>
          <DataTable<Proyecto>
            data={proyectosActivos}
            rowKey="id"
            pageSize={0}
            searchableKeys={['nombre']}
            searchPlaceholder="Buscar proyecto…"
            onRowClick={p => setSelectedProjectId(p.id)}
            defaultSort={{ key: 'mora', direction: 'desc' }}
            columns={[
              {
                key: 'nombre', header: 'Proyecto', sortable: true,
                accessor: p => p.nombre,
                render: p => {
                  const s = perProject[p.id] ?? EMPTY_STATS()
                  return (
                    <span style={{ fontWeight: 600, color: 'var(--at-ink)' }}>
                      {s.cuotasMora > 0 && <span style={{ color: 'var(--at-danger)', marginRight: 6 }}>●</span>}
                      {p.nombre}
                    </span>
                  )
                },
              },
              {
                key: 'ocupacion', header: '🏠 Ocupación', sortable: true,
                accessor: p => (perProject[p.id] ?? EMPTY_STATS()).ocupadas,
                render: p => {
                  const s = perProject[p.id] ?? EMPTY_STATS()
                  return <span style={{ color: 'var(--at-accent-hover)', fontWeight: 600 }}>{s.ocupadas}/{s.totalUnidades}</span>
                },
              },
              {
                key: 'pendientes', header: '💰 Pendientes', sortable: true,
                accessor: p => (perProject[p.id] ?? EMPTY_STATS()).cuotasPendientes,
                render: p => {
                  const v = (perProject[p.id] ?? EMPTY_STATS()).cuotasPendientes
                  return <span style={{ fontWeight: v > 0 ? 700 : 400, color: v > 0 ? 'var(--at-warning)' : 'var(--at-ink-3)' }}>{v}</span>
                },
                hideOnMobile: true,
              },
              {
                key: 'mora', header: '⚠️ Mora', sortable: true,
                accessor: p => (perProject[p.id] ?? EMPTY_STATS()).cuotasMora,
                render: p => {
                  const v = (perProject[p.id] ?? EMPTY_STATS()).cuotasMora
                  return <span style={{ fontWeight: v > 0 ? 700 : 400, color: v > 0 ? 'var(--at-danger)' : 'var(--at-ink-3)' }}>{v}</span>
                },
              },
              {
                key: 'visitantes', header: '👥 Visitantes hoy', sortable: true,
                accessor: p => (perProject[p.id] ?? EMPTY_STATS()).visitantesHoy,
                render: p => {
                  const v = (perProject[p.id] ?? EMPTY_STATS()).visitantesHoy
                  return <span style={{ fontWeight: v > 0 ? 700 : 400, color: v > 0 ? 'var(--at-primary-hover)' : 'var(--at-ink-3)' }}>{v}</span>
                },
                hideOnMobile: true,
              },
              {
                key: 'tickets', header: '🔧 Tickets', sortable: true,
                accessor: p => (perProject[p.id] ?? EMPTY_STATS()).ticketsAbiertos,
                render: p => {
                  const v = (perProject[p.id] ?? EMPTY_STATS()).ticketsAbiertos
                  return <span style={{ fontWeight: v > 0 ? 700 : 400, color: v > 0 ? 'var(--at-warning)' : 'var(--at-ink-3)' }}>{v}</span>
                },
                hideOnMobile: true,
              },
              {
                key: 'sin_asignar', header: '💬 Sin asignar', sortable: true,
                accessor: p => (perProject[p.id] ?? EMPTY_STATS()).comunSinAsignar,
                render: p => {
                  const v = (perProject[p.id] ?? EMPTY_STATS()).comunSinAsignar
                  return <span style={{ fontWeight: v > 0 ? 700 : 400, color: v > 0 ? 'var(--at-primary-hover)' : 'var(--at-ink-3)' }}>{v}</span>
                },
                hideOnMobile: true,
              },
            ] satisfies DataTableColumn<Proyecto>[]}
          />
          <p style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: 8 }}>Haz clic en un proyecto para filtrar el panel</p>
        </div>
      )}
    </div>
  )
}
