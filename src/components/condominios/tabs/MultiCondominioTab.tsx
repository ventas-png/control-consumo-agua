import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { Proyecto } from '../../../types'

interface Props {
  proyectos: Proyecto[]
  companyId: string
  moneda: string
}

interface ResumenProyecto {
  proyecto: Proyecto
  cuotasTotales: number
  cuotasPagadas: number
  cuotasMorosas: number
  montoRecaudado: number
  montoVencido: number
  ticketsAbiertos: number
  ticketsTotal: number
  unidades: number
  visitantesHoy: number
}

export default function MultiCondominioTab({ proyectos, companyId, moneda }: Props) {
  const [resumenes, setResumenes] = useState<ResumenProyecto[]>([])
  const [loading, setLoading] = useState(true)

  const proyectosActivos = proyectos.filter(p => p.estado === 'activo')
  const hoy = new Date().toISOString().slice(0, 10)

  useEffect(() => {
    if (proyectosActivos.length === 0) { setLoading(false); return }

    async function cargar() {
      setLoading(true)
      const resultado = await Promise.all(proyectosActivos.map(async p => {
        const [cuotasRes, ticketsRes, unidadesRes, visitantesRes] = await Promise.all([
          supabase.from('cuotas_condominio').select('estado, monto, fecha_vencimiento').eq('project_id', p.id).eq('company_id', companyId),
          supabase.from('tickets_mantenimiento').select('estado').eq('project_id', p.id).eq('company_id', companyId),
          supabase.from('unidades').select('id', { count: 'exact', head: true }).eq('project_id', p.id).eq('company_id', companyId),
          supabase.from('visitantes').select('id', { count: 'exact', head: true }).eq('project_id', p.id).eq('company_id', companyId).gte('hora_entrada', hoy),
        ])
        const cuotas = cuotasRes.data ?? []
        const tickets = ticketsRes.data ?? []
        return {
          proyecto: p,
          cuotasTotales: cuotas.length,
          cuotasPagadas: cuotas.filter(c => c.estado === 'pagado').length,
          cuotasMorosas: cuotas.filter(c => (c.estado === 'pendiente' || c.estado === 'moroso') && c.fecha_vencimiento && c.fecha_vencimiento < hoy).length,
          montoRecaudado: cuotas.filter(c => c.estado === 'pagado').reduce((s, c) => s + (c.monto ?? 0), 0),
          montoVencido: cuotas.filter(c => (c.estado === 'pendiente' || c.estado === 'moroso') && c.fecha_vencimiento && c.fecha_vencimiento < hoy).reduce((s, c) => s + (c.monto ?? 0), 0),
          ticketsAbiertos: tickets.filter(t => t.estado === 'abierto' || t.estado === 'en_proceso').length,
          ticketsTotal: tickets.length,
          unidades: unidadesRes.count ?? 0,
          visitantesHoy: visitantesRes.count ?? 0,
        } as ResumenProyecto
      }))
      setResumenes(resultado)
      setLoading(false)
    }
    cargar()
  }, [proyectosActivos.length, companyId])

  if (proyectosActivos.length <= 1) {
    return (
      <div style={{ padding: 16, textAlign: 'center', color: 'var(--at-ink-3)', paddingTop: 60 }}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>🏘️</div>
        Este módulo muestra el comparativo cuando hay 2 o más condominios activos.
        <div style={{ fontSize: 11, marginTop: 6 }}>Actualmente solo hay {proyectosActivos.length} proyecto activo.</div>
      </div>
    )
  }

  const totalRecaudado = resumenes.reduce((s, r) => s + r.montoRecaudado, 0)
  const totalVencido = resumenes.reduce((s, r) => s + r.montoVencido, 0)
  const totalTicketsAbiertos = resumenes.reduce((s, r) => s + r.ticketsAbiertos, 0)
  const totalUnidades = resumenes.reduce((s, r) => s + r.unidades, 0)

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs globales */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 20 }}>
        <div style={{ background: 'var(--at-success-tint)', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--at-success)' }}>{moneda} {totalRecaudado.toLocaleString('es', { minimumFractionDigits: 2 })}</div>
          <div style={{ fontSize: 11, color: 'var(--at-success)', fontWeight: 600 }}>Recaudado total — todos los condominios</div>
        </div>
        <div style={{ background: 'var(--at-danger-tint)', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--at-danger)' }}>{moneda} {totalVencido.toLocaleString('es', { minimumFractionDigits: 2 })}</div>
          <div style={{ fontSize: 11, color: 'var(--at-danger)', fontWeight: 600 }}>Cartera vencida global</div>
        </div>
        <div style={{ background: 'var(--at-warning-tint)', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--at-warning)' }}>{totalTicketsAbiertos}</div>
          <div style={{ fontSize: 11, color: 'var(--at-warning)', fontWeight: 600 }}>Tickets abiertos en total</div>
        </div>
        <div style={{ background: 'var(--at-primary-tint)', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--at-primary)' }}>{totalUnidades}</div>
          <div style={{ fontSize: 11, color: 'var(--at-primary)', fontWeight: 600 }}>Unidades totales activas</div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '40px 0' }}>Cargando datos de todos los condominios…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {resumenes.map(r => {
            const tasaRec = r.cuotasTotales > 0 ? Math.round((r.cuotasPagadas / r.cuotasTotales) * 100) : 0
            const tasaMora = r.cuotasTotales > 0 ? Math.round((r.cuotasMorosas / r.cuotasTotales) * 100) : 0
            return (
              <div key={r.proyecto.id} style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--at-ink)' }}>🏢 {r.proyecto.nombre}</div>
                    <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 2 }}>{r.unidades} unidades · {r.visitantesHoy} visitantes hoy</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: tasaRec >= 80 ? 'var(--at-success-tint)' : tasaRec >= 60 ? 'var(--at-warning-tint)' : 'var(--at-danger-tint)', color: tasaRec >= 80 ? 'var(--at-success)' : tasaRec >= 60 ? 'var(--at-warning)' : 'var(--at-danger)' }}>
                      {tasaRec}% recaudación
                    </span>
                    {r.ticketsAbiertos > 0 && (
                      <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: 'var(--at-warning-tint)', color: 'var(--at-warning)' }}>
                        {r.ticketsAbiertos} tickets abiertos
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8 }}>
                  {[
                    { label: 'Cuotas totales', val: r.cuotasTotales, color: 'var(--at-ink-2)' },
                    { label: 'Pagadas', val: r.cuotasPagadas, color: 'var(--at-success)' },
                    { label: 'Morosas', val: r.cuotasMorosas, color: 'var(--at-danger)' },
                    { label: `Recaudado ${moneda}`, val: r.montoRecaudado.toLocaleString('es', { maximumFractionDigits: 0 }), color: 'var(--at-success)' },
                    { label: `Mora ${moneda}`, val: r.montoVencido.toLocaleString('es', { maximumFractionDigits: 0 }), color: r.montoVencido > 0 ? 'var(--at-danger)' : 'var(--at-success)' },
                  ].map(k => (
                    <div key={k.label} style={{ background: 'var(--at-surface-2)', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: k.color }}>{k.val}</div>
                      <div style={{ fontSize: 9, color: 'var(--at-ink-3)' }}>{k.label}</div>
                    </div>
                  ))}
                </div>

                {/* Barra recaudación */}
                <div style={{ marginTop: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--at-ink-3)', marginBottom: 3 }}>
                    <span>Recaudación</span>
                    <span>{tasaRec}% · Mora {tasaMora}%</span>
                  </div>
                  <div style={{ background: 'var(--at-danger-tint)', borderRadius: 4, height: 8 }}>
                    <div style={{ height: '100%', background: tasaRec >= 80 ? 'var(--at-success)' : tasaRec >= 60 ? 'var(--at-warning)' : 'var(--at-danger)', width: `${tasaRec}%`, borderRadius: 4 }} />
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
