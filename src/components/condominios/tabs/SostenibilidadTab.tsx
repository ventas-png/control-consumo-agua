import { useMemo, useState, type CSSProperties } from 'react'
import type { RegistroResiduo, TipoResiduo, EstadoResiduo } from '../../../types'
import { formatNumber, mesLocalISO } from '../../../lib/format'
import { useConsumoMensualPorProyectoQuery } from '../../../domain/agua/queries'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'

interface Props {
  residuos: RegistroResiduo[]
  proyectoId: string
  companyId: string
}

const TIPO_RECICLABLE: Set<TipoResiduo> = new Set(['reciclable', 'electronico'])

const TIPO_LABELS: Record<TipoResiduo, string> = {
  general: '🗑️ General', reciclable: '♻️ Reciclable', organico: '🌿 Orgánico',
  electronico: '💻 Electrónico', peligroso: '⚠️ Peligroso', escombros: '🏗️ Escombros',
}

const ESTADO_LABELS: Record<EstadoResiduo, string> = { pendiente: 'Pendiente', recolectado: 'Recolectado', procesado: 'Procesado' }

function barWidth(val: number, max: number) {
  return max > 0 ? `${Math.round((val / max) * 100)}%` : '0%'
}

function mesLabel(ym: string) {
  const [y, m] = ym.split('-')
  const nombres = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
  return `${nombres[parseInt(m)]} ${y}`
}

/** Los últimos `n` meses ('YYYY-MM', el más antiguo primero), con el actual. */
function ultimosMeses(n: number): string[] {
  const hoy = new Date()
  return Array.from({ length: n }, (_, i) => mesLocalISO(new Date(hoy.getFullYear(), hoy.getMonth() - (n - 1 - i), 1)))
}

/** Número entero con separador de miles y la unidad pegada (no se parte en el teléfono). */
const cifra = (v: number, unidad: string, decimales = 0) => `${formatNumber(v, decimales)}\u00a0${unidad}`

/** Qué registros se ven en la ventana de detalle: los de un mes o los de un tipo. */
type Detalle = { por: 'mes'; mes: string } | { por: 'tipo'; tipo: TipoResiduo }

export function SostenibilidadTab({ residuos, proyectoId, companyId }: Props) {
  // Capa de datos (T7): consumo mensual de agua vía TanStack Query. Reemplaza el
  // useEffect + fetch dependiente (contadores → registros) por un hook que hace
  // los dos pasos y agrega por mes; revalida solo al cambiar proyecto/empresa.
  const { data: aguaMeses = [], isLoading: loadingAgua } = useConsumoMensualPorProyectoQuery(companyId, proyectoId)
  const [detalle, setDetalle] = useState<Detalle | null>(null)

  // Los seis meses de las gráficas, con el actual; también los que no tienen
  // datos, para que «últimos 6 meses» lo sea de verdad.
  const meses = useMemo(() => ultimosMeses(6), [])

  // ── Métricas residuos ──
  const totalKg = residuos.reduce((s, r) => s + (r.cantidad_kg ?? 0), 0)
  const reciclableKg = residuos.filter(r => TIPO_RECICLABLE.has(r.tipo_residuo)).reduce((s, r) => s + (r.cantidad_kg ?? 0), 0)
  const pctReciclaje = totalKg > 0 ? (reciclableKg / totalKg) * 100 : 0

  // kg CO2 equivalentes ahorrados por reciclaje (estimado IPCC)
  const co2Ahorrado = reciclableKg * 1.5

  // Residuos por mes (últimos 6)
  const residuosMeses = meses.map(mes => {
    const delMes = residuos.filter(r => r.fecha.startsWith(mes))
    return { mes, kg: delMes.reduce((s, r) => s + (r.cantidad_kg ?? 0), 0), registros: delMes.length }
  })
  const hayResiduosEnVentana = residuosMeses.some(r => r.registros > 0)

  // ── CO2 agua ──
  const totalM3Agua = aguaMeses.reduce((s, a) => s + a.m3, 0)
  const co2Agua = totalM3Agua * 0.298
  const aguaPorMes = meses.map(mes => ({ mes, m3: aguaMeses.find(a => a.mes === mes)?.m3 ?? 0 }))

  const maxAgua = Math.max(...aguaPorMes.map(a => a.m3), 1)
  const maxResiduo = Math.max(...residuosMeses.map(r => r.kg), 1)

  // ── Residuos por tipo ──
  const porTipo: Partial<Record<TipoResiduo, number>> = {}
  for (const r of residuos) porTipo[r.tipo_residuo] = (porTipo[r.tipo_residuo] ?? 0) + (r.cantidad_kg ?? 0)
  const tipoEntries = Object.entries(porTipo).sort((a, b) => b[1] - a[1]) as [TipoResiduo, number][]
  const maxTipo = Math.max(...tipoEntries.map(([, v]) => v), 1)

  const tarjeta: CSSProperties = { background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '20px', minWidth: 0 }
  const tituloTarjeta: CSSProperties = { margin: '0 0 16px', fontSize: '14px', fontWeight: 700, color: 'var(--at-ink)' }
  const vacio: CSSProperties = { textAlign: 'center', color: 'var(--at-ink-3)', padding: '20px', fontSize: '13px' }

  // Se leen los registros vigentes, no una copia.
  const registrosDetalle = detalle
    ? residuos
      .filter(r => detalle.por === 'mes' ? r.fecha.startsWith(detalle.mes) : r.tipo_residuo === detalle.tipo)
      .sort((a, b) => b.fecha.localeCompare(a.fecha))
    : []

  return (
    <div style={{ padding: '20px 24px' }}>
      <h2 style={{ margin: '0 0 20px', fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>Dashboard de Sostenibilidad</h2>

      {/* KPIs globales: dos por fila en el teléfono */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 150px), 1fr))', gap: '12px', marginBottom: '24px' }}>
        {[
          { label: 'Agua consumida (6m)', value: cifra(totalM3Agua, 'm³'), icon: '💧', color: 'var(--at-primary)' },
          { label: 'CO₂ equiv. agua',     value: cifra(co2Agua, 'kg'),      icon: '🌊', color: 'var(--at-accent-hover)' },
          { label: 'Residuos totales',    value: cifra(totalKg, 'kg'),      icon: '🗑️', color: 'var(--at-ink-3)' },
          { label: '% Reciclaje',         value: `${pctReciclaje.toFixed(0)}%`, icon: '♻️', color: 'var(--at-success)' },
          { label: 'CO₂ ahorrado',        value: cifra(co2Ahorrado, 'kg'),  icon: '🌱', color: 'var(--at-success)' },
        ].map(k => (
          <div key={k.label} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '10px', padding: '12px', textAlign: 'center', minWidth: 0 }}>
            <div style={{ fontSize: '22px', marginBottom: '4px' }}>{k.icon}</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: k.color, overflowWrap: 'anywhere' }}>{k.value}</div>
            <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', fontWeight: 500 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Una columna en el teléfono (antes, 320px fijos se salían en pantallas angostas). */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 320px), 1fr))', gap: '20px' }}>

        {/* Consumo agua por mes */}
        <div style={tarjeta}>
          <h3 style={tituloTarjeta}>💧 Consumo de Agua (últimos 6 meses)</h3>
          {loadingAgua ? (
            <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '20px' }}>Cargando...</div>
          ) : aguaMeses.length === 0 ? (
            <div style={vacio}>Sin datos de consumo de agua</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {aguaPorMes.map(a => (
                <FilaBarra key={a.mes} etiqueta={mesLabel(a.mes)} valor={cifra(a.m3, 'm³', 1)} ancho={barWidth(a.m3, maxAgua)} color="var(--at-primary)" apagada={a.m3 === 0} />
              ))}
            </div>
          )}
        </div>

        {/* Residuos por mes: cada mes con registros abre su detalle */}
        <div style={tarjeta}>
          <h3 style={tituloTarjeta}>♻️ Residuos por Mes (últimos 6 meses)</h3>
          {!hayResiduosEnVentana ? (
            <div style={vacio}>Sin datos de residuos</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {residuosMeses.map(r => (
                <FilaBarra
                  key={r.mes}
                  etiqueta={mesLabel(r.mes)}
                  valor={cifra(r.kg, 'kg', 1)}
                  ancho={barWidth(r.kg, maxResiduo)}
                  color="var(--at-success)"
                  apagada={r.registros === 0}
                  onAbrir={r.registros > 0 ? () => setDetalle({ por: 'mes', mes: r.mes }) : undefined}
                  ariaLabel={`Ver residuos de ${mesLabel(r.mes)}: ${r.registros} registro${r.registros === 1 ? '' : 's'}, ${cifra(r.kg, 'kg', 1)}`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Residuos por tipo: cada tipo abre sus registros */}
        <div style={tarjeta}>
          <h3 style={tituloTarjeta}>🗑️ Residuos por Tipo</h3>
          {tipoEntries.length === 0 ? (
            <div style={vacio}>Sin datos</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {tipoEntries.map(([tipo, kg]) => (
                <FilaBarra
                  key={tipo}
                  etiqueta={TIPO_LABELS[tipo]}
                  valor={cifra(kg, 'kg', 1)}
                  ancho={barWidth(kg, maxTipo)}
                  color={TIPO_RECICLABLE.has(tipo) ? 'var(--at-success)' : 'var(--at-ink-3)'}
                  onAbrir={() => setDetalle({ por: 'tipo', tipo })}
                  ariaLabel={`Ver residuos de tipo ${TIPO_LABELS[tipo].replace(/^\S+\s/, '')}: ${cifra(kg, 'kg', 1)}`}
                />
              ))}
            </div>
          )}
        </div>

        {/* Panel CO2 (fondo del tema: el degradado fijo casi blanco dejaba el
            título claro del modo oscuro sin contraste) */}
        <div style={{ ...tarjeta, background: 'var(--at-success-tint)', border: '1.5px solid var(--at-success-border)' }}>
          <h3 style={{ ...tituloTarjeta, color: 'var(--at-success-strong)' }}>🌱 Equivalencias CO₂</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {[
              { icon: '💧', label: 'Agua tratada', detail: cifra(totalM3Agua, 'm³'), co2: co2Agua, desc: 'CO₂ equiv. generado' },
              { icon: '♻️', label: 'Reciclaje',    detail: cifra(reciclableKg, 'kg'), co2: co2Ahorrado, desc: 'CO₂ equiv. ahorrado', saved: true },
            ].map(item => (
              <div key={item.label} style={{ background: 'var(--at-surface)', borderRadius: '8px', padding: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--at-ink)' }}>{item.icon} {item.label}</div>
                    <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{item.detail}</div>
                  </div>
                  <div style={{ textAlign: 'right', marginLeft: 'auto' }}>
                    <div style={{ fontSize: '16px', fontWeight: 800, color: item.saved ? 'var(--at-success)' : 'var(--at-ink-3)' }}>
                      {item.saved ? '+' : ''}{cifra(item.co2, 'kg')}
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

      {/* Registros de un mes o de un tipo, en ventana (pantalla completa en el teléfono). */}
      {detalle && (
        <EditModal
          title={detalle.por === 'mes' ? `♻️ Residuos de ${mesLabel(detalle.mes)}` : `${TIPO_LABELS[detalle.tipo]}`}
          subtitle={`${registrosDetalle.length} registro${registrosDetalle.length === 1 ? '' : 's'} · ${cifra(registrosDetalle.reduce((s, r) => s + (r.cantidad_kg ?? 0), 0), 'kg', 1)}${detalle.por === 'tipo' ? ' · todo el historial' : ''}`}
          maxWidth="520px"
          fullScreenOnMobile
          onClose={() => setDetalle(null)}
          footer={<Button variant="secondary" onClick={() => setDetalle(null)}>Cerrar</Button>}
        >
          <RegistrosResiduo registros={registrosDetalle} mostrarTipo={detalle.por === 'mes'} />
        </EditModal>
      )}
    </div>
  )
}

/** Fila de una gráfica de barras; si tiene `onAbrir`, es un botón que abre su detalle. */
function FilaBarra({ etiqueta, valor, ancho, color, apagada, onAbrir, ariaLabel }: {
  etiqueta: string; valor: string; ancho: string; color: string; apagada?: boolean
  onAbrir?: () => void; ariaLabel?: string
}) {
  const contenido = (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '12px', color: 'var(--at-ink-3)', marginBottom: '3px' }}>
        <span>{etiqueta}</span>
        <span style={{ fontWeight: 700, color: apagada ? 'var(--at-ink-3)' : color }}>
          {valor}{onAbrir && <span aria-hidden="true" style={{ marginLeft: '6px', color: 'var(--at-ink-3)' }}>›</span>}
        </span>
      </div>
      <div style={{ background: 'var(--at-chip)', borderRadius: '4px', height: '8px' }}>
        <div style={{ background: color, height: '8px', borderRadius: '4px', width: ancho, transition: 'width 0.3s' }} />
      </div>
    </>
  )
  const caja: CSSProperties = { display: 'block', width: '100%', padding: '4px 6px', boxSizing: 'border-box', borderRadius: '6px' }
  return onAbrir ? (
    <button type="button" onClick={onAbrir} aria-label={ariaLabel} className="cond-barra-fila"
      style={{ ...caja, background: 'none', border: 'none', textAlign: 'left', font: 'inherit', cursor: 'pointer' }}>
      {contenido}
    </button>
  ) : (
    <div style={caja}>{contenido}</div>
  )
}

/** Lista de solo lectura de registros de residuos (se lee bien en el teléfono). */
function RegistrosResiduo({ registros, mostrarTipo }: { registros: RegistroResiduo[]; mostrarTipo: boolean }) {
  if (registros.length === 0) return <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '20px', fontSize: '13px' }}>Sin registros</div>
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {registros.map(r => (
        <li key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '9px 0', borderBottom: '1px solid var(--at-chip)', fontSize: '14px' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{mostrarTipo ? TIPO_LABELS[r.tipo_residuo] : r.fecha}</div>
            <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', overflowWrap: 'anywhere' }}>
              {[mostrarTipo ? r.fecha : null, ESTADO_LABELS[r.estado], r.punto_acopio].filter(Boolean).join(' · ')}
            </div>
            {r.incidencia && (
              <div style={{ fontSize: '12px', color: 'var(--at-danger)', fontWeight: 600, marginTop: '2px' }}>
                ⚠ Incidencia{r.descripcion_incidencia ? `: ${r.descripcion_incidencia}` : ''}
              </div>
            )}
          </div>
          <div style={{ fontWeight: 700, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
            {r.cantidad_kg != null ? cifra(r.cantidad_kg, 'kg', 1) : '—'}
          </div>
        </li>
      ))}
    </ul>
  )
}
