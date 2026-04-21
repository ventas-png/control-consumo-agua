import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { Unidad } from '../../../types'

interface Props {
  unidades: Unidad[]
  proyectoId: string
  companyId: string
}

interface ResumenMedidor {
  contador_id: string
  numero_medidor: string
  unidad_nombre: string
  ultima_lectura: number | null
  consumo_ultimo: number | null
  fecha_lectura: string | null
}

export default function IntegracionAguaTab({ unidades, proyectoId, companyId }: Props) {
  const [resumen, setResumen] = useState<ResumenMedidor[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function cargar() {
      setLoading(true)

      const { data: contadores } = await supabase
        .from('contadores')
        .select('id, numero_medidor, unidad_id, unidades(nombre)')
        .eq('project_id', proyectoId)
        .eq('company_id', companyId)
        .order('numero_medidor')

      if (!contadores || contadores.length === 0) { setLoading(false); return }

      const ids = (contadores as Record<string, unknown>[]).map(c => c.id as string)

      const { data: registros } = await supabase
        .from('registros')
        .select('contador_id, lectura_actual, consumo, fecha')
        .in('contador_id', ids)
        .order('fecha', { ascending: false })

      const lista: ResumenMedidor[] = (contadores as Record<string, unknown>[]).map(c => {
        const regs = ((registros ?? []) as Record<string, unknown>[]).filter(r => r.contador_id === c.id)
        const ultima = regs[0] as Record<string, unknown> | undefined
        const unidad = unidades.find(u => u.id === (c.unidad_id as string))
        const nombre = (c.unidades as { nombre: string } | null)?.nombre ?? unidad?.nombre ?? 'Sin unidad'
        return {
          contador_id: c.id as string,
          numero_medidor: c.numero_medidor as string,
          unidad_nombre: nombre,
          ultima_lectura: ultima ? (ultima.lectura_actual as number) : null,
          consumo_ultimo: ultima ? (ultima.consumo as number) : null,
          fecha_lectura: ultima ? (ultima.fecha as string) : null,
        }
      })

      setResumen(lista)
      setLoading(false)
    }
    cargar()
  }, [proyectoId, companyId, unidades])

  const totalConsumo = resumen.reduce((s, r) => s + (r.consumo_ultimo ?? 0), 0)
  const sinLectura = resumen.filter(r => !r.fecha_lectura).length
  const promedio = resumen.length > 0 ? totalConsumo / resumen.filter(r => r.consumo_ultimo !== null).length : 0
  const maxConsumo = Math.max(...resumen.map(r => r.consumo_ultimo ?? 0), 1)

  return (
    <div style={{ padding: 16 }}>
      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 20 }}>
        <div style={{ background: '#eff6ff', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#2563eb' }}>{resumen.length}</div>
          <div style={{ fontSize: 11, color: '#2563eb', fontWeight: 600 }}>Medidores activos</div>
        </div>
        <div style={{ background: '#f0fdf4', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#16a34a' }}>{totalConsumo.toLocaleString('es')} m³</div>
          <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>Consumo total último período</div>
        </div>
        <div style={{ background: '#f5f3ff', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#7c3aed' }}>{isNaN(promedio) ? '—' : promedio.toFixed(1)} m³</div>
          <div style={{ fontSize: 11, color: '#7c3aed', fontWeight: 600 }}>Promedio por unidad</div>
        </div>
        <div style={{ background: sinLectura > 0 ? '#fef3c7' : '#f0fdf4', borderRadius: 10, padding: '12px 16px' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: sinLectura > 0 ? '#d97706' : '#16a34a' }}>{sinLectura}</div>
          <div style={{ fontSize: 11, color: sinLectura > 0 ? '#d97706' : '#16a34a', fontWeight: 600 }}>Sin lectura registrada</div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: '#9ca3af', padding: '48px 0', fontSize: 13 }}>Cargando medidores…</div>
      ) : resumen.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#9ca3af', padding: '48px 0', fontSize: 13 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>💧</div>
          No hay medidores configurados para este proyecto.
          <div style={{ fontSize: 11, marginTop: 4 }}>Crea contadores en el módulo principal de agua.</div>
        </div>
      ) : (
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 14 }}>Consumo por unidad — última lectura disponible</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {resumen.map(r => {
              const pct = r.consumo_ultimo ? (r.consumo_ultimo / maxConsumo) * 100 : 0
              const alto = r.consumo_ultimo !== null && promedio > 0 && r.consumo_ultimo > promedio * 1.5
              return (
                <div key={r.contador_id} style={{ padding: '10px 12px', background: '#f9fafb', borderRadius: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontWeight: 600, fontSize: 12, color: '#0f172a' }}>{r.unidad_nombre}</span>
                      <span style={{ fontSize: 10, color: '#9ca3af' }}>#{r.numero_medidor}</span>
                      {alto && (
                        <span style={{ fontSize: 10, background: '#fef2f2', color: '#ef4444', padding: '1px 6px', borderRadius: 10, fontWeight: 700 }}>⚠ Alto</span>
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: alto ? '#ef4444' : '#0f172a' }}>
                        {r.consumo_ultimo !== null ? `${r.consumo_ultimo} m³` : '—'}
                      </span>
                      {r.fecha_lectura && <div style={{ fontSize: 10, color: '#9ca3af' }}>{r.fecha_lectura}</div>}
                    </div>
                  </div>
                  <div style={{ background: '#e5e7eb', borderRadius: 4, height: 6 }}>
                    <div style={{ height: '100%', background: alto ? '#ef4444' : '#3b82f6', width: `${pct}%`, borderRadius: 4 }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
