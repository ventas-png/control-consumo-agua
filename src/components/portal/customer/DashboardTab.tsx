// Vista extraída de CustomerPortal (refactor P1 #3): JSX idéntico al original.
import type { CSSProperties } from 'react'
import type { PortalCtx } from './ctx'
import type { ContadorInfo, LecturaInfo, UnidadInfo } from '../../../lib/portalDashboard'
import { RegistroFotoThumb } from './RegistroFotoThumb'
import { EmptyState } from '../../shared/EmptyState'
import { Icon } from '../../shared/Icon'
import { parseFecha } from '../../../lib/format'
import { TIPO_AGUA_LABELS } from '../../../lib/portalDashboard'

export function DashboardTab({ ctx }: { ctx: PortalCtx }) {
  const { loading, projects, unidades, contadores, lecturas, selectedProjectId, setSelectedProjectId, setPhotoModal, chartMonthsBack, setChartMonthsBack, chartCustomStart, setChartCustomStart, chartCustomEnd, setChartCustomEnd, chartRangeMode, setChartRangeMode, chartMetric, setChartMetric, selectedUnidadId, setSelectedUnidadId, selectedTipoAgua, setSelectedTipoAgua, chartRef, dashboardData } = ctx
    const {
      consumoMesActual, consumoPromedio, montoPendiente, contadoresActivos,
      consumoPrevMes, consumoSameLastYear, vsAnterior, vsAnioAnterior,
      chartDatasets, availableTiposAgua, tipoAguaMap, unidadBreakdown,
      lecturasTotal, filteredLecturasCount,
    } = dashboardData

    const moneda = selectedProjectId
      ? (projects.find(p => p.id === selectedProjectId)?.moneda ?? projects[0]?.moneda ?? 'Q')
      : (projects[0]?.moneda ?? 'Q')

    const clienteProjects = projects.filter(p =>
      unidades.some(u => u.project_id === p.id) || contadores.some(c => c.project_id === p.id)
    )

    function PctCard({ label, pct, base, baseLabel }: { label: string; pct: number | null; base: number; baseLabel: string }) {
      const isNull = pct === null
      const positive = !isNull && pct! >= 0
      return (
        <div style={{ background: 'var(--at-surface)', borderRadius: '14px', padding: '18px 20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
          <div style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '8px' }}>{label}</div>
          {isNull ? (
            <span style={{ fontSize: '14px', color: 'var(--at-ink-3)' }}>Sin datos</span>
          ) : (
            <span style={{ fontSize: '20px', fontWeight: 700, color: positive ? 'var(--at-danger)' : 'var(--at-success)' }}>
              {positive ? '▲' : '▼'} {Math.abs(pct!).toFixed(1)}%
            </span>
          )}
          <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '5px' }}>{baseLabel}: {base.toFixed(2)} m³</div>
        </div>
      )
    }

    return (
      <div>
        {/* Filtro de proyecto */}
        {clienteProjects.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '20px', background: 'var(--at-surface)', borderRadius: '12px', padding: '12px 16px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)' }}>🏗️ Proyecto:</span>
            <select
              value={selectedProjectId ?? ''}
              onChange={e => { setSelectedProjectId(e.target.value || null); setSelectedUnidadId(null); setSelectedTipoAgua(null) }}
              style={{ flex: 1, padding: '7px 12px', fontSize: '13.5px', border: '1.5px solid var(--at-line)', borderRadius: '8px', background: 'var(--at-surface-2)', color: 'var(--at-ink)', cursor: 'pointer' }}
            >
              <option value="">Todos los proyectos</option>
              {clienteProjects.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
        )}

        {/* Filtro de unidad */}
        {(() => {
          const visibleUnidades4Filter = (selectedProjectId
            ? unidades.filter(u => u.project_id === selectedProjectId)
            : unidades
          ).filter(u => contadores.some(c => c.unidad_id === u.id && c.activo))
          if (visibleUnidades4Filter.length < 2) return null
          return (
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '20px', background: 'var(--at-surface)', borderRadius: '12px', padding: '12px 16px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)' }}>🏠 Unidad:</span>
              <select
                value={selectedUnidadId ?? ''}
                onChange={e => { setSelectedUnidadId(e.target.value || null); setSelectedTipoAgua(null) }}
                style={{ flex: 1, padding: '7px 12px', fontSize: '13.5px', border: '1.5px solid var(--at-line)', borderRadius: '8px', background: 'var(--at-surface-2)', color: 'var(--at-ink)', cursor: 'pointer' }}
              >
                <option value="">Todas las unidades</option>
                {visibleUnidades4Filter.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
          )
        })()}

        {/* KPI Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: '14px', marginBottom: '18px' }}>
          {[
            { label: 'Consumo Mes Actual', value: `${consumoMesActual.toFixed(2)} m³`, icon: '💧', bg: 'linear-gradient(135deg, var(--at-primary), var(--at-primary-hover))' },
            { label: 'Promedio Mensual', value: `${consumoPromedio.toFixed(2)} m³`, icon: '📊', bg: 'linear-gradient(135deg, var(--at-accent-2), #0f766e)' },
            { label: 'Monto Pendiente', value: `${moneda} ${montoPendiente.toFixed(2)}`, icon: '💳', bg: montoPendiente > 0 ? 'linear-gradient(135deg, var(--at-warning), var(--at-warning))' : 'linear-gradient(135deg, var(--at-success), var(--at-success-strong))' },
            { label: 'Contadores Activos', value: String(contadoresActivos), icon: '🔢', bg: 'linear-gradient(135deg, var(--at-accent), var(--at-accent-hover))' },
          ].map(card => (
            <div key={card.label} style={{ background: card.bg, borderRadius: '16px', padding: '20px', color: 'white', boxShadow: '0 6px 20px rgba(0,0,0,0.12)' }}>
              <div style={{ fontSize: '22px', marginBottom: '10px', opacity: loading ? 0.4 : 1 }}>{card.icon}</div>
              {loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '4px' }}>
                  <div className="kpi-skeleton" style={{ height: '22px', width: '70%' }} />
                  <div className="kpi-skeleton" style={{ height: '11px', width: '50%' }} />
                </div>
              ) : (
                <>
                  <div style={{ fontSize: '22px', fontWeight: 700, lineHeight: 1, marginBottom: '4px' }}>{card.value}</div>
                  <div style={{ fontSize: '11.5px', opacity: 0.88 }}>{card.label}</div>
                </>
              )}
            </div>
          ))}
        </div>

        {/* Comparaciones */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '14px', marginBottom: '18px' }}>
          <PctCard label="vs Mes Anterior" pct={vsAnterior} base={consumoPrevMes} baseLabel="Mes ant." />
          <PctCard label="vs Mismo Mes Año Anterior" pct={vsAnioAnterior} base={consumoSameLastYear} baseLabel="Año ant." />
        </div>

        {/* Historial de Consumo */}
        <div style={{ background: 'var(--at-surface)', borderRadius: '16px', padding: '22px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: '18px' }}>
          {/* Título + filtro tipo de agua */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--at-ink)' }}>Historial de Consumo</div>
            <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
              {chartRangeMode === 'custom' && chartCustomStart && chartCustomEnd
                ? `${chartCustomStart} — ${chartCustomEnd} · ${chartMetric === 'm3' ? 'm³' : moneda}`
                : `Últimos ${chartMonthsBack} meses · ${chartMetric === 'm3' ? 'm³' : moneda}`}
            </div>
            </div>
            {availableTiposAgua.length > 1 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                <button
                  onClick={() => setSelectedTipoAgua(null)}
                  style={{
                    padding: '4px 12px', fontSize: '11.5px', fontWeight: 600, borderRadius: '20px', cursor: 'pointer',
                    border: '1.5px solid', transition: 'all 0.15s',
                    background: selectedTipoAgua === null ? 'var(--at-primary)' : 'transparent',
                    borderColor: selectedTipoAgua === null ? 'var(--at-primary)' : 'var(--at-line-strong)',
                    color: selectedTipoAgua === null ? 'white' : 'var(--at-ink-2)',
                  }}
                >Todos</button>
                {availableTiposAgua.map(tipo => (
                  <button
                    key={tipo}
                    onClick={() => setSelectedTipoAgua(tipo)}
                    style={{
                      padding: '4px 12px', fontSize: '11.5px', fontWeight: 600, borderRadius: '20px', cursor: 'pointer',
                      border: '1.5px solid', transition: 'all 0.15s',
                      background: selectedTipoAgua === tipo ? 'var(--at-primary)' : 'transparent',
                      borderColor: selectedTipoAgua === tipo ? 'var(--at-primary)' : 'var(--at-line-strong)',
                      color: selectedTipoAgua === tipo ? 'white' : 'var(--at-ink-2)',
                    }}
                  >{TIPO_AGUA_LABELS[tipo] ?? tipo}</button>
                ))}
              </div>
            )}
          </div>
          {/* Controles: Período y Métrica */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', color: 'var(--at-ink-3)', fontWeight: 500, whiteSpace: 'nowrap' }}>Período:</span>
            <div style={{ display: 'flex', borderRadius: '8px', border: '1.5px solid var(--at-line)', overflow: 'hidden' }}>
              {([6, 12, 24] as const).map(n => (
                <button
                  key={n}
                  onClick={() => { setChartMonthsBack(n); setChartRangeMode('preset') }}
                  style={{
                    padding: '6px 14px', fontSize: '12.5px', fontWeight: 600,
                    border: 'none', borderRight: '1px solid var(--at-line)', cursor: 'pointer', transition: 'all 0.15s',
                    background: chartRangeMode === 'preset' && chartMonthsBack === n ? 'var(--at-primary)' : 'var(--at-surface-2)',
                    color: chartRangeMode === 'preset' && chartMonthsBack === n ? 'white' : 'var(--at-ink-2)',
                  }}
                >{n}M</button>
              ))}
              <button
                onClick={() => {
                  setChartRangeMode('custom')
                  if (!chartCustomStart || !chartCustomEnd) {
                    const now = new Date()
                    const endStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
                    const startYear = lecturas.length > 0
                      ? parseFecha(lecturas[lecturas.length - 1].fecha).getFullYear()
                      : now.getFullYear() - 2
                    const startStr = `${startYear}-01`
                    setChartCustomStart(startStr)
                    setChartCustomEnd(endStr)
                  }
                }}
                style={{
                  padding: '6px 14px', fontSize: '12.5px', fontWeight: 600,
                  border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                  background: chartRangeMode === 'custom' ? 'var(--at-primary)' : 'var(--at-surface-2)',
                  color: chartRangeMode === 'custom' ? 'white' : 'var(--at-ink-2)',
                }}
              >📅 Rango</button>
            </div>
            <span style={{ fontSize: '12px', color: 'var(--at-ink-3)', fontWeight: 500, whiteSpace: 'nowrap', marginLeft: '6px' }}>Métrica:</span>
            <div style={{ display: 'flex', borderRadius: '8px', border: '1.5px solid var(--at-line)', overflow: 'hidden' }}>
              <button
                onClick={() => setChartMetric('m3')}
                style={{
                  padding: '6px 14px', fontSize: '12.5px', fontWeight: 600,
                  border: 'none', borderRight: '1px solid var(--at-line)', cursor: 'pointer', transition: 'all 0.15s',
                  background: chartMetric === 'm3' ? 'var(--at-primary)' : 'var(--at-surface-2)',
                  color: chartMetric === 'm3' ? 'white' : 'var(--at-ink-2)',
                }}
              >m³</button>
              <button
                onClick={() => setChartMetric('moneda')}
                style={{
                  padding: '6px 14px', fontSize: '12.5px', fontWeight: 600,
                  border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                  background: chartMetric === 'moneda' ? 'var(--at-primary)' : 'var(--at-surface-2)',
                  color: chartMetric === 'moneda' ? 'white' : 'var(--at-ink-2)',
                }}
              >{moneda}</button>
            </div>
            {chartDatasets.length === 1 && (
              <div style={{ display: 'flex', gap: '10px', fontSize: '11px', color: 'var(--at-ink-3)', alignItems: 'center', marginLeft: 'auto' }}>
                <span><span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', background: 'var(--at-primary)', marginRight: '4px' }} />Mes actual</span>
                <span><span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', background: 'rgba(27, 59, 54,0.45)', marginRight: '4px' }} />Anteriores</span>
                <span><span style={{ display: 'inline-block', width: '18px', height: '0px', borderTop: '2px dashed var(--at-warning)', marginRight: '4px', verticalAlign: 'middle' }} />Tendencia</span>
              </div>
            )}
          </div>
          {/* Inputs de rango personalizado — selectores Mes/Año */}
          {chartRangeMode === 'custom' && (() => {
            const now = new Date()
            const curYear = now.getFullYear()
            const years = Array.from({ length: curYear - 2018 + 2 }, (_, i) => 2018 + i)
            const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
            const selStyle: CSSProperties = { padding: '5px 8px', borderRadius: '8px', border: '1.5px solid var(--at-primary-mint)', fontSize: '12.5px', color: 'var(--at-ink)', background: 'var(--at-surface)', cursor: 'pointer' }

            function parseParts(val: string) {
              const [y, m] = (val || '').split('-')
              return { y: y || '', m: m || '' }
            }
            function buildVal(y: string, m: string) { return y && m ? `${y}-${m}` : '' }

            const startParts = parseParts(chartCustomStart)
            const endParts = parseParts(chartCustomEnd)

            return (
              <div style={{ display: 'flex', gap: '20px', marginBottom: '14px', alignItems: 'center', flexWrap: 'wrap', background: 'var(--at-primary-tint)', borderRadius: '10px', padding: '10px 14px', border: '1px solid var(--at-primary-soft-2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: 'var(--at-ink-2)' }}>
                  <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>Desde:</span>
                  <select value={startParts.m} onChange={e => setChartCustomStart(buildVal(startParts.y, e.target.value))} style={selStyle}>
                    <option value="">Mes</option>
                    {meses.map((m, i) => <option key={i} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
                  </select>
                  <select value={startParts.y} onChange={e => setChartCustomStart(buildVal(e.target.value, startParts.m))} style={selStyle}>
                    <option value="">Año</option>
                    {years.map(y => <option key={y} value={String(y)}>{y}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: 'var(--at-ink-2)' }}>
                  <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>Hasta:</span>
                  <select value={endParts.m} onChange={e => setChartCustomEnd(buildVal(endParts.y, e.target.value))} style={selStyle}>
                    <option value="">Mes</option>
                    {meses.map((m, i) => <option key={i} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
                  </select>
                  <select value={endParts.y} onChange={e => setChartCustomEnd(buildVal(e.target.value, endParts.m))} style={selStyle}>
                    <option value="">Año</option>
                    {years.map(y => <option key={y} value={String(y)}>{y}</option>)}
                  </select>
                </div>
              </div>
            )
          })()}
          {/* Gráfico o estado vacío */}
          {lecturasTotal === 0 ? (
            <div style={{ background: 'var(--at-surface-2)', borderRadius: '10px' }}>
              <EmptyState
                audience="resident"
                icon={<Icon name="gauge" size={28} />}
                title="Sin lecturas registradas aún"
                description="Aquí verás la evolución de tu consumo en cuanto se registren las primeras lecturas de tu medidor."
              />
            </div>
          ) : filteredLecturasCount === 0 ? (
            <div style={{ background: 'var(--at-surface-2)', borderRadius: '10px' }}>
              <EmptyState
                audience="resident"
                icon={<Icon name="search" size={26} />}
                title="Sin lecturas para los contadores activos"
                description={`Hay ${lecturasTotal} lectura${lecturasTotal !== 1 ? 's' : ''} en el sistema, pero no coinciden con los contadores vinculados.`}
              />
            </div>
          ) : (
            <div style={{ height: chartDatasets.length > 1 ? '300px' : '260px' }}><canvas ref={chartRef} /></div>
          )}
        </div>

        {/* Desglose por tipo de agua */}
        {Object.keys(tipoAguaMap).length > 0 && (
          <div style={{ background: 'var(--at-surface)', borderRadius: '16px', padding: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: '18px' }}>
            <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--at-ink)', marginBottom: '14px' }}>Desglose por Tipo de Agua</div>
            <div className="table-scroll-wrapper">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: 'var(--at-surface-2)' }}>
                    {['Tipo de Agua', 'Contadores', 'Consumo Mes (m³)', 'Consumo 12 meses (m³)'].map(h => (
                      <th scope="col" key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: '11.5px', fontWeight: 600, color: 'var(--at-ink-3)', borderBottom: '1px solid var(--at-line)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(Object.entries(tipoAguaMap) as [string, { label: string; count: number; consumoMes: number; consumo12m: number }][]).map(([tipo, info]) => (
                    <tr key={tipo} style={{ borderBottom: '1px solid var(--at-chip)' }}>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '3px 10px', borderRadius: '20px', background: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', fontSize: '12px', fontWeight: 600 }}>
                          💧 {info.label}
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px', color: 'var(--at-ink-2)', textAlign: 'center' }}>{info.count}</td>
                      <td style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--at-primary)', textAlign: 'right' }}>{info.consumoMes.toFixed(2)}</td>
                      <td style={{ padding: '10px 14px', color: 'var(--at-ink-2)', textAlign: 'right' }}>{info.consumo12m.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Desglose por unidad */}
        {unidadBreakdown.length > 0 && (
          <div>
            <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--at-ink)', marginBottom: '12px' }}>Desglose por Unidad</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(290px, 100%), 1fr))', gap: '14px' }}>
              {(unidadBreakdown as { unidad: UnidadInfo; meters: { contador: ContadorInfo; consumoMes: number; consumo12m: number; consumoMesDisplay: number; consumoMesLabel: string; ultimaLectura: LecturaInfo | null; fotoActual: LecturaInfo | null; fotoAnterior: LecturaInfo | null }[] }[]).map(({ unidad, meters }) => {
                const project = projects.find(p => p.id === unidad.project_id)
                return (
                  <div key={unidad.id} style={{ background: 'var(--at-surface)', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                    {/* Header unidad */}
                    <div style={{ background: 'linear-gradient(135deg, var(--at-accent-2), var(--at-primary))', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px' }}>🏠</div>
                      <div>
                        <div style={{ color: 'white', fontWeight: 700, fontSize: '14px' }}>{unidad.nombre}</div>
                        <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: '11px' }}>{unidad.tipo.replace(/_/g, ' ')}{project && ` · ${project.nombre}`}</div>
                      </div>
                    </div>
                    {/* Contadores */}
                    <div style={{ padding: '14px 16px' }}>
                      {meters.length === 0 ? (
                        <div style={{ color: 'var(--at-ink-3)', fontSize: '12.5px', textAlign: 'center', padding: '8px 0' }}>Sin contadores asignados</div>
                      ) : meters.map(({ contador, consumo12m, consumoMesDisplay, consumoMesLabel, ultimaLectura, fotoActual, fotoAnterior }) => (
                        <div key={contador.id} style={{ borderRadius: '10px', background: 'var(--at-surface-2)', padding: '11px', border: '1px solid var(--at-line)', marginBottom: '10px' }}>
                          {/* Info medidor */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                            <div style={{ width: '26px', height: '26px', borderRadius: '7px', background: 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', flexShrink: 0 }}>💧</div>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: '12.5px', color: 'var(--at-ink)' }}>#{contador.numero_serie}</div>
                              <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{TIPO_AGUA_LABELS[contador.tipo_agua] ?? contador.tipo_agua}</div>
                              {ultimaLectura && (
                                <div style={{ fontSize: '10px', color: 'var(--at-ink-3)', marginTop: '1px' }}>
                                  Última lectura: {parseFecha(ultimaLectura.fecha).toLocaleDateString('es-GT')}
                                </div>
                              )}
                            </div>
                          </div>
                          {/* Stats */}
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px', marginBottom: '12px' }}>
                            {[
                              { lbl: consumoMesLabel, val: consumoMesDisplay.toFixed(2), color: 'var(--at-primary)' },
                              { lbl: 'Últimos 12m', val: consumo12m.toFixed(2), color: 'var(--at-accent-2)' },
                            ].map(s => (
                              <div key={s.lbl} style={{ background: 'var(--at-surface)', borderRadius: '7px', padding: '7px 9px', border: '1px solid var(--at-line)' }}>
                                <div style={{ fontSize: '10px', color: 'var(--at-ink-3)', marginBottom: '2px' }}>{s.lbl}</div>
                                <div style={{ fontSize: '15px', fontWeight: 700, color: s.color }}>{s.val}</div>
                                <div style={{ fontSize: '9.5px', color: 'var(--at-ink-3)' }}>m³</div>
                              </div>
                            ))}
                          </div>
                          {/* Fotos — always shown */}
                          <div>
                            <div style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '7px' }}>📷 Fotografías del Medidor</div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              {[
                                { lectura: fotoAnterior, label: 'Foto Anterior' },
                                { lectura: fotoActual, label: 'Foto Actual' },
                              ].map(({ lectura, label }) => (
                                <div key={label} style={{ flex: 1 }}>
                                  <div style={{ fontSize: '9.5px', color: 'var(--at-ink-3)', marginBottom: '3px', textAlign: 'center' }}>{label}</div>
                                  {lectura ? (
                                    <RegistroFotoThumb
                                      registroId={lectura.id}
                                      label={label}
                                      onClick={() => setPhotoModal({ registroId: lectura.id, label: `${label} — #${contador.numero_serie} — ${parseFecha(lectura.fecha).toLocaleDateString('es-GT')}` })}
                                    />
                                  ) : (
                                    <div style={{ width: '100%', aspectRatio: '1', background: 'var(--at-chip)', borderRadius: '7px', border: '1.5px dashed var(--at-line-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '3px', color: 'var(--at-ink-3)', fontSize: '10px' }}>
                                      <span style={{ fontSize: '18px' }}>📷</span>
                                      <span>Sin foto</span>
                                    </div>
                                  )}
                                  {lectura && (
                                    <div style={{ fontSize: '9px', color: 'var(--at-ink-3)', textAlign: 'center', marginTop: '2px' }}>
                                      {parseFecha(lectura.fecha).toLocaleDateString('es-GT')}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
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

