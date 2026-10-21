// Vista extraída de CustomerPortal (refactor P1 #3).
import type { PortalCtx } from './ctx'
import { parseFecha } from '../../../lib/format'
import { TIPO_AGUA_LABELS } from '../../../lib/portalDashboard'
import { tint } from '../../shared/statusTone'
import { ContadorDetalleModal } from './ContadorDetalleModal'

export function ServiciosTab({ ctx }: { ctx: PortalCtx }) {
  const { companies, companyActivoMap, projects, unidades, contadores, lecturas, expandedContador, setExpandedContador } = ctx
  // `expandedContador` ya no despliega la tarjeta: es el contador cuya ventana está abierta.
  const abierto = expandedContador ? contadores.find(c => c.id === expandedContador) ?? null : null
  const unidadAbierta = abierto ? unidades.find(u => u.id === abierto.unidad_id) : undefined
  const proyectoAbierto = abierto ? projects.find(p => p.id === (unidadAbierta?.project_id ?? abierto.project_id)) : undefined
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
                    background: tint(s.color, 9),
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

                  {/* Contadores: cada tarjeta abre su historial en ventana emergente
                      (ContadorDetalleModal); antes se desplegaba una tabla ancha. */}
                  {companyContadores.map(contador => {
                    const unidad = unidades.find(u => u.id === contador.unidad_id)
                    const project = companyProjects.find(p => p.id === (unidad?.project_id ?? contador.project_id))
                    const ultima = lecturas.find(l => l.contador_id === contador.id)
                    return (
                      <button
                        key={contador.id}
                        type="button"
                        className="portal-card contador-row"
                        onClick={() => setExpandedContador(contador.id)}
                        style={{
                          width: '100%', textAlign: 'left', cursor: 'pointer', color: 'var(--at-ink)',
                          background: 'var(--at-surface)', borderRadius: '14px', border: 'none',
                          marginBottom: '12px', padding: '16px 18px',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                          display: 'flex', alignItems: 'center', gap: '12px',
                          transition: 'all 0.2s',
                        }}
                      >
                        <span aria-hidden="true" style={{
                          width: '40px', height: '40px', borderRadius: '12px', flexShrink: 0,
                          background: 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '18px', color: 'white',
                        }}>💧</span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: 'block', fontWeight: 700, fontSize: '14.5px' }}>
                            Contador #{contador.numero_serie}
                          </span>
                          <span style={{ display: 'block', fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                            {TIPO_AGUA_LABELS[contador.tipo_agua] ?? contador.tipo_agua}
                            {unidad && ` · ${unidad.nombre}`}
                            {project && ` · ${project.nombre}`}
                          </span>
                          <span style={{ display: 'block', fontSize: '12.5px', color: 'var(--at-ink-2)', marginTop: '4px' }}>
                            {ultima
                              ? <>Última lectura: <strong style={{ color: 'var(--at-primary)' }}>{ultima.consumo.toFixed(2)} m³</strong> · {parseFecha(ultima.fecha).toLocaleDateString('es-GT', { day: 'numeric', month: 'short' })}</>
                              : 'Sin lecturas todavía'}
                          </span>
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                          <span style={{
                            padding: '3px 10px', borderRadius: '20px',
                            background: 'var(--at-success-tint)', color: 'var(--at-success-strong)',
                            fontSize: '11px', fontWeight: 600,
                          }}>Activo</span>
                          <svg width="16" height="16" fill="none" stroke="var(--at-ink-3)" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </span>
                      </button>
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

            {abierto && (
              <ContadorDetalleModal
                contador={abierto}
                unidadNombre={unidadAbierta?.nombre}
                proyectoNombre={proyectoAbierto?.nombre}
                moneda={proyectoAbierto?.moneda ?? 'Q'}
                lecturas={lecturas.filter(l => l.contador_id === abierto.id).slice(0, 12)}
                onClose={() => setExpandedContador(null)}
              />
            )}
          </div>
  )
}
