import { useState, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import type { RegistroResiduo, TipoResiduo } from '../../../types'

interface Props {
  residuos: RegistroResiduo[]
  proyectoId: string
  companyId: string
}

interface AguaMes { mes: string; m3: number }

const TIPO_RECICLABLE: Set<TipoResiduo> = new Set(['reciclable', 'electronico'])

function barWidth(val: number, max: number) {
  return max > 0 ? `${Math.round((val / max) * 100)}%` : '0%'
}

function mesLabel(ym: string) {
  const [y, m] = ym.split('-')
  const nombres = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
  return `${nombres[parseInt(m)]} ${y}`
}

export function SostenibilidadTab({ residuos, proyectoId, companyId }: Props) {
  const [aguaMeses, setAguaMeses] = useState<AguaMes[]>([])
  const [loadingAgua, setLoadingAgua] = useState(false)

  useEffect(() => {
    if (!proyectoId || !companyId) return
    setLoadingAgua(true)
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5)
    sixMonthsAgo.setDate(1)
    const desde = sixMonthsAgo.toISOString().slice(0, 10)

    supabase
      .from('contadores')
      .select('id')
      .eq('project_id', proyectoId)
      .then(({ data: contadores }) => {
        const ids = (contadores ?? []).map(c => c.id)
        if (ids.length === 0) { setLoadingAgua(false); return }
        return supabase
          .from('registros')
          .select('consumo_m3, fecha_lectura')
          .in('contador_id', ids)
          .gte('fecha_lectura', desde)
          .order('fecha_lectura')
      })
      .then(res => {
        if (!res) return
        const byMes: Record<string, number> = {}
        for (const r of (res.data ?? [])) {
          const mes = (r.fecha_lectura as string).slice(0, 7)
          byMes[mes] = (byMes[mes] ?? 0) + (r.consumo_m3 ?? 0)
        }
        setAguaMeses(Object.entries(byMes).map(([mes, m3]) => ({ mes, m3 })).sort((a, b) => a.mes.localeCompare(b.mes)))
        setLoadingAgua(false)
      })
  }, [proyectoId, companyId])

  // ── Métricas residuos ──
  const totalKg = residuos.reduce((s, r) => s + (r.cantidad_kg ?? 0), 0)
  const reciclableKg = residuos.filter(r => TIPO_RECICLABLE.has(r.tipo_residuo)).reduce((s, r) => s + (r.cantidad_kg ?? 0), 0)
  const pctReciclaje = totalKg > 0 ? (reciclableKg / totalKg) * 100 : 0

  // kg CO2 equivalentes ahorrados por reciclaje (estimado IPCC)
  const co2Ahorrado = reciclableKg * 1.5

  // Residuos por mes (últimos 6)
  const sixAgo = new Date(); sixAgo.setMonth(sixAgo.getMonth() - 5); sixAgo.setDate(1)
  const residuosPorMes: Record<string, number> = {}
  for (const r of residuos) {
    if (r.fecha < sixAgo.toISOString().slice(0, 10)) continue
    const mes = r.fecha.slice(0, 7)
    residuosPorMes[mes] = (residuosPorMes[mes] ?? 0) + (r.cantidad_kg ?? 0)
  }
  const residuosMeses = Object.entries(residuosPorMes).map(([mes, kg]) => ({ mes, kg })).sort((a, b) => a.mes.localeCompare(b.mes))

  // ── CO2 agua ──
  const totalM3Agua = aguaMeses.reduce((s, a) => s + a.m3, 0)
  const co2Agua = totalM3Agua * 0.298

  const maxAgua = Math.max(...aguaMeses.map(a => a.m3), 1)
  const maxResiduo = Math.max(...residuosMeses.map(r => r.kg), 1)

  // ── Residuos por tipo ──
  const porTipo: Partial<Record<TipoResiduo, number>> = {}
  for (const r of residuos) porTipo[r.tipo_residuo] = (porTipo[r.tipo_residuo] ?? 0) + (r.cantidad_kg ?? 0)
  const tipoEntries = Object.entries(porTipo).sort((a, b) => b[1] - a[1]) as [TipoResiduo, number][]
  const maxTipo = Math.max(...tipoEntries.map(([, v]) => v), 1)

  const TIPO_LABELS: Record<TipoResiduo, string> = {
    general: '🗑️ General', reciclable: '♻️ Reciclable', organico: '🌿 Orgánico',
    electronico: '💻 Electrónico', peligroso: '⚠️ Peligroso', escombros: '🏗️ Escombros',
  }

  return (
    <div style={{ padding: '20px 24px' }}>
      <h2 style={{ margin: '0 0 20px', fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Dashboard de Sostenibilidad</h2>

      {/* KPIs globales */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '12px', marginBottom: '24px' }}>
        {[
          { label: 'Agua consumida (6m)', value: `${totalM3Agua.toFixed(0)} m³`, icon: '💧', color: 'var(--at-primary)' },
          { label: 'CO₂ equiv. agua',     value: `${co2Agua.toFixed(0)} kg`,     icon: '🌊', color: 'var(--at-accent-hover)' },
          { label: 'Residuos totales',    value: `${totalKg.toFixed(0)} kg`,     icon: '🗑️', color: 'var(--at-ink-3)' },
          { label: '% Reciclaje',         value: `${pctReciclaje.toFixed(0)}%`,  icon: '♻️', color: 'var(--at-success)' },
          { label: 'CO₂ ahorrado',        value: `${co2Ahorrado.toFixed(0)} kg`, icon: '🌱', color: 'var(--at-success)' },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '12px', textAlign: 'center' }}>
            <div style={{ fontSize: '22px', marginBottom: '4px' }}>{k.icon}</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', fontWeight: 500 }}>{k.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '20px' }}>

        {/* Consumo agua por mes */}
        <div style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700, color: 'var(--at-ink)' }}>💧 Consumo de Agua (últimos 6 meses)</h3>
          {loadingAgua ? (
            <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '20px' }}>Cargando...</div>
          ) : aguaMeses.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '20px', fontSize: '13px' }}>Sin datos de consumo de agua</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {aguaMeses.map(a => (
                <div key={a.mes}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--at-ink-3)', marginBottom: '3px' }}>
                    <span>{mesLabel(a.mes)}</span>
                    <span style={{ fontWeight: 700, color: 'var(--at-primary)' }}>{a.m3.toFixed(1)} m³</span>
                  </div>
                  <div style={{ background: 'var(--at-chip)', borderRadius: '4px', height: '8px' }}>
                    <div style={{ background: 'var(--at-primary)', height: '8px', borderRadius: '4px', width: barWidth(a.m3, maxAgua), transition: 'width 0.3s' }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Residuos por mes */}
        <div style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700, color: 'var(--at-ink)' }}>♻️ Residuos por Mes (últimos 6 meses)</h3>
          {residuosMeses.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '20px', fontSize: '13px' }}>Sin datos de residuos</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {residuosMeses.map(r => (
                <div key={r.mes}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--at-ink-3)', marginBottom: '3px' }}>
                    <span>{mesLabel(r.mes)}</span>
                    <span style={{ fontWeight: 700, color: 'var(--at-success)' }}>{r.kg.toFixed(1)} kg</span>
                  </div>
                  <div style={{ background: 'var(--at-chip)', borderRadius: '4px', height: '8px' }}>
                    <div style={{ background: 'var(--at-success)', height: '8px', borderRadius: '4px', width: barWidth(r.kg, maxResiduo), transition: 'width 0.3s' }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Residuos por tipo */}
        <div style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700, color: 'var(--at-ink)' }}>🗑️ Residuos por Tipo</h3>
          {tipoEntries.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '20px', fontSize: '13px' }}>Sin datos</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {tipoEntries.map(([tipo, kg]) => (
                <div key={tipo}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--at-ink-3)', marginBottom: '3px' }}>
                    <span>{TIPO_LABELS[tipo]}</span>
                    <span style={{ fontWeight: 700, color: TIPO_RECICLABLE.has(tipo) ? 'var(--at-success)' : 'var(--at-ink-3)' }}>{kg.toFixed(1)} kg</span>
                  </div>
                  <div style={{ background: 'var(--at-chip)', borderRadius: '4px', height: '8px' }}>
                    <div style={{ background: TIPO_RECICLABLE.has(tipo) ? 'var(--at-success)' : 'var(--at-ink-3)', height: '8px', borderRadius: '4px', width: barWidth(kg, maxTipo), transition: 'width 0.3s' }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Panel CO2 */}
        <div style={{ background: 'linear-gradient(135deg, #ecfdf5, var(--at-success-tint))', border: '1.5px solid var(--at-success-border)', borderRadius: '12px', padding: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 700, color: 'var(--at-success-strong)' }}>🌱 Equivalencias CO₂</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {[
              { icon: '💧', label: 'Agua tratada', detail: `${totalM3Agua.toFixed(0)} m³`, co2: co2Agua, desc: 'CO₂ equiv. generado' },
              { icon: '♻️', label: 'Reciclaje',    detail: `${reciclableKg.toFixed(0)} kg`, co2: co2Ahorrado, desc: 'CO₂ equiv. ahorrado', saved: true },
            ].map(item => (
              <div key={item.label} style={{ background: 'var(--at-surface)', borderRadius: '8px', padding: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--at-ink)' }}>{item.icon} {item.label}</div>
                    <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{item.detail}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '16px', fontWeight: 800, color: item.saved ? 'var(--at-success)' : 'var(--at-ink-3)' }}>
                      {item.saved ? '+' : ''}{item.co2.toFixed(0)} kg
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{item.desc}</div>
                  </div>
                </div>
              </div>
            ))}
            <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '4px', fontStyle: 'italic' }}>
              *Factores estimados: agua 0.298 kg CO₂/m³ · reciclaje 1.5 kg CO₂/kg ahorrado (IPCC)
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
