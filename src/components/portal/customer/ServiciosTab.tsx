// Vista extraída de CustomerPortal (refactor P1 #3): JSX idéntico al original.
import type { PortalCtx } from './ctx'
import { EmptyState } from '../../shared/EmptyState'
import { Icon } from '../../shared/Icon'
import { parseFecha } from '../../../lib/format'
import { TIPO_AGUA_LABELS } from '../../../lib/portalDashboard'
import { ESTADO_COLORS } from './ui'

export function ServiciosTab({ ctx }: { ctx: PortalCtx }) {
  const { companies, companyActivoMap, projects, unidades, contadores, lecturas, expandedContador, setExpandedContador } = ctx
  return (
          <div>
            {/* Summary cards */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              gap: '14px',
              marginBottom: '28px',
            }}>
              {[
                { icon: '🏢', label: 'Empresas', value: companies.length, color: 'var(--at-accent)' },
                { icon: '🏠', label: 'Unidades activas', value: unidades.length, color: 'var(--at-primary)' },
                { icon: '💧', label: 'Contadores activos', value: contadores.length, color: 'var(--at-accent-2)' },
                { icon: '📋', label: 'Registros de lectura', value: lecturas.length, color: 'var(--at-warning)' },
              ].map(s => (
                <div
                  key={s.label}
                  className="portal-card"
                  style={{
                    background: 'var(--at-surface)', borderRadius: '14px', padding: '18px',
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
                    <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>{s.label}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Companies & meters tree */}
            {companies.map(company => {
              const companyProjects = projects.filter(p => p.company_id === company.id)
              const companyContadores = contadores.filter(c => c.company_id === company.id)
              const companyUnidades = unidades.filter(u => u.company_id === company.id)
              const isActivo = companyActivoMap[company.id] !== false

              // Company header (shared between active and inactive views)
              const companyHeader = (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                  <div style={{
                    width: '32px', height: '32px', borderRadius: '8px',
                    background: isActivo ? 'linear-gradient(135deg, var(--at-accent), var(--at-accent-hover))' : 'var(--at-line)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '15px', color: 'white',
                  }}>🏢</div>
                  <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: isActivo ? 'var(--at-ink)' : 'var(--at-ink-3)' }}>
                    {company.nombre}
                  </h2>
                </div>
              )

              if (!isActivo) {
                return (
                  <div key={company.id} style={{ marginBottom: '24px' }}>
                    {companyHeader}
                    <div style={{
                      padding: '20px 24px',
                      background: 'var(--at-surface-2)',
                      border: '1.5px dashed var(--at-line-strong)',
                      borderRadius: '12px',
                      color: 'var(--at-ink-3)',
                      fontSize: '14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                    }}>
                      <span style={{ fontSize: '20px' }}>ℹ️</span>
                      <span>
                        Sin datos disponibles de <strong>{company.nombre}</strong>. Si desea más información, contáctenos directamente con la empresa.
                      </span>
                    </div>
                  </div>
                )
              }

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
                      background: 'linear-gradient(135deg, var(--at-accent), var(--at-accent-hover))',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '15px', color: 'white',
                    }}>🏢</div>
                    <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: 'var(--at-ink)' }}>
                      {company.nombre}
                    </h2>
                  </div>

                  {/* Contadores for this company */}
                  {companyContadores.map(contador => {
                    const unidad = unidades.find(u => u.id === contador.unidad_id)
                    const project = companyProjects.find(p => p.id === (unidad?.project_id ?? contador.project_id))
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
                          background: 'var(--at-surface)', borderRadius: '14px',
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
                              background: 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: '16px', color: 'white',
                            }}>💧</div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600, color: 'var(--at-ink)', fontSize: '14.5px' }}>
                                Contador #{contador.numero_serie}
                              </div>
                              <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                                {TIPO_AGUA_LABELS[contador.tipo_agua] ?? contador.tipo_agua}
                                {unidad && ` · ${unidad.nombre}`}
                                {project && ` · ${project.nombre}`}
                              </div>
                            </div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                            <span style={{
                              padding: '3px 10px', borderRadius: '20px',
                              background: 'var(--at-success-tint)', color: 'var(--at-success-strong)',
                              fontSize: '11px', fontWeight: 600,
                            }}>Activo</span>
                            <span style={{ color: 'var(--at-ink-3)', fontSize: '16px', transition: 'transform 0.2s', display: 'inline-block', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)' }}>▼</span>
                          </div>
                        </div>

                        {/* Reading history */}
                        {isExpanded && (
                          <div style={{ borderTop: '1px solid var(--at-chip)' }}>
                            {contLecturas.length === 0 ? (
                              <EmptyState
                                compact
                                audience="resident"
                                icon={<Icon name="gauge" size={24} />}
                                title="No hay lecturas registradas para este contador."
                              />
                            ) : (
                              <div className="table-scroll-wrapper">
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                  <thead>
                                    <tr style={{ background: 'var(--at-surface-2)' }}>
                                      {['Fecha', 'Período', 'Lect. anterior', 'Lect. actual', 'Consumo (m³)', `Monto (${moneda})`, 'Estado'].map(h => (
                                        <th scope="col" key={h} style={{
                                          padding: '10px 14px', textAlign: 'left',
                                          fontSize: '11.5px', fontWeight: 600,
                                          color: 'var(--at-ink-3)', whiteSpace: 'nowrap',
                                          borderBottom: '1px solid var(--at-line)',
                                        }}>{h}</th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {contLecturas.map(lectura => {
                                      const est = ESTADO_COLORS[lectura.estado] ?? ESTADO_COLORS.pendiente
                                      return (
                                        <tr key={lectura.id} className="lectura-row">
                                          <td style={{ padding: '10px 14px', color: 'var(--at-ink-2)', whiteSpace: 'nowrap' }}>
                                            {parseFecha(lectura.fecha).toLocaleDateString('es-GT')}
                                          </td>
                                          <td style={{ padding: '10px 14px', color: 'var(--at-ink-3)' }}>
                                            {lectura.dias_servicio != null ? `${lectura.dias_servicio} días` : lectura.mes ? `Mes ${lectura.mes}` : '—'}
                                          </td>
                                          <td style={{ padding: '10px 14px', color: 'var(--at-ink-2)', textAlign: 'right' }}>
                                            {lectura.lectura_anterior.toFixed(2)}
                                          </td>
                                          <td style={{ padding: '10px 14px', color: 'var(--at-ink-2)', textAlign: 'right' }}>
                                            {lectura.lectura_actual.toFixed(2)}
                                          </td>
                                          <td style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--at-primary)', textAlign: 'right' }}>
                                            {lectura.consumo.toFixed(2)}
                                          </td>
                                          <td style={{ padding: '10px 14px', fontWeight: 600, color: 'var(--at-ink)', textAlign: 'right', whiteSpace: 'nowrap' }}>
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
                          background: 'var(--at-surface)', borderRadius: '14px', padding: '16px 20px',
                          marginBottom: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                          display: 'flex', alignItems: 'center', gap: '12px',
                          transition: 'all 0.2s',
                        }}
                      >
                        <div style={{
                          width: '36px', height: '36px', borderRadius: '9px', flexShrink: 0,
                          background: 'linear-gradient(135deg, var(--at-primary), var(--at-accent))',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '16px', color: 'white',
                        }}>🏠</div>
                        <div>
                          <div style={{ fontWeight: 600, color: 'var(--at-ink)', fontSize: '14.5px' }}>
                            {unidad.nombre}
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
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
  )
}
