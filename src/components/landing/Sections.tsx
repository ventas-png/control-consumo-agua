import { useState, type CSSProperties } from 'react'
import { Icon } from './icons'
import type { Copy } from './i18n'

export function TrustStrip({ t }: { t: Copy }) {
  return (
    <section className="trust-strip" aria-label={t.trust.label}>
      <div className="trust-inner">
        <span className="trust-label">{t.trust.label}</span>
        <ul className="trust-items">
          {t.trust.items.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export function ModulesShowcase({ t }: { t: Copy }) {
  const [active, setActive] = useState(0)
  const tab = t.modules.tabs[active]

  return (
    <section className="modules" id="product">
      <div className="container">
        <header className="section-h">
          <span className="eyebrow">{t.modules.eyebrow}</span>
          <h2 className="display-h">{t.modules.title}</h2>
          <p className="section-sub">{t.modules.sub}</p>
        </header>

        <div className="modules-tabs" role="tablist">
          {t.modules.tabs.map((m, i) => (
            <button key={m.id} role="tab" aria-selected={i === active}
              className={'mod-tab ' + (i === active ? 'active' : '')}
              onClick={() => setActive(i)}>
              {m.id === 'agua' ? <Icon.drop size={16} /> : <Icon.building size={16} />}
              <span>{m.label}</span>
            </button>
          ))}
        </div>

        <div className="modules-stage">
          <div className="modules-info">
            <h3 className="modules-headline">{tab.headline}</h3>
            <ul className="modules-bullets">
              {tab.bullets.map((b, i) => (
                <li key={i}>
                  <span className="mb-i"><Icon.check size={13} /></span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="modules-visual">
            {tab.id === 'agua' ? <WaterVisual /> : <CondoVisual />}
          </div>
        </div>
      </div>
    </section>
  )
}

interface Unit {
  id: string
  floor: string
  residents: number
  status: 'ok' | 'alert'
  data: number[]
  anomaly: { idx: number; label: string; reason: string } | null
}

function WaterVisual() {
  const [activeUnit, setActiveUnit] = useState(0)

  const units: Unit[] = [
    { id: 'Apt 304', floor: 'Piso 3', residents: 3, status: 'ok', data: [16.1, 14.8, 15.2, 17.3, 18.0, 19.4, 21.2, 20.5, 18.9, 17.6, 16.8, 18.2], anomaly: null },
    { id: 'Apt 1102', floor: 'Piso 11', residents: 4, status: 'alert', data: [22.4, 21.8, 23.1, 22.9, 24.2, 25.0, 26.1, 25.5, 24.8, 26.3, 27.1, 44.1], anomaly: { idx: 11, label: 'Posible fuga', reason: '+62% vs. histórico' } },
    { id: 'Casa 12', floor: 'Casa', residents: 5, status: 'ok', data: [28.5, 27.0, 29.1, 30.2, 31.5, 32.4, 33.1, 32.8, 31.0, 30.5, 30.8, 31.8], anomaly: null },
    { id: 'Local 02', floor: 'Comercial', residents: 0, status: 'ok', data: [7.5, 7.8, 8.0, 7.9, 8.2, 8.5, 8.7, 8.6, 8.3, 8.1, 8.0, 8.4], anomaly: null },
    { id: 'Apt 408', floor: 'Piso 4', residents: 2, status: 'ok', data: [19.5, 20.1, 19.8, 21.0, 22.3, 23.1, 22.8, 22.5, 21.9, 21.4, 21.8, 22.7], anomaly: null },
  ]

  const months = ['Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic', 'Ene', 'Feb', 'Mar']
  const u = units[activeUnit]
  const current = u.data[u.data.length - 1]
  const prev = u.data[u.data.length - 2]
  const avg = u.data.reduce((a, b) => a + b, 0) / u.data.length
  const delta = ((current - prev) / prev) * 100
  const max = Math.max(...u.data) * 1.15

  const W = 100, H = 100
  const xFor = (i: number) => (i / (u.data.length - 1)) * W
  const yFor = (v: number) => H - (v / max) * H
  const linePath = u.data.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i).toFixed(2)} ${yFor(v).toFixed(2)}`).join(' ')
  const areaPath = `${linePath} L ${W} ${H} L 0 ${H} Z`

  return (
    <div className="modviz modviz-water">
      <div className="modviz-card water-card">
        <div className="water-h">
          <div className="water-h-l">
            <span className="water-eyebrow">Historial de consumo</span>
            <div className="water-unit-h">
              <span className="water-unit-i"><Icon.drop size={18} /></span>
              <div>
                <h4>{u.id}</h4>
                <p>{u.floor} · {u.residents > 0 ? `${u.residents} residentes` : 'Comercial'}</p>
              </div>
              {u.status === 'alert' && <span className="water-flag">!</span>}
            </div>
          </div>
          <div className="water-range">
            <button className="wr-btn">6M</button>
            <button className="wr-btn active">12M</button>
            <button className="wr-btn">24M</button>
          </div>
        </div>

        <div className="water-metrics">
          <div className="water-metric primary">
            <span className="wm-l">Marzo</span>
            <div className="wm-v">
              <strong>{current.toFixed(1)}</strong>
              <span>m³</span>
            </div>
            <span className={'wm-d ' + (delta > 0 ? 'up' : 'down')}>
              {delta > 0 ? '↑' : '↓'} {Math.abs(delta).toFixed(1)}% vs. feb
            </span>
          </div>
          <div className="water-metric">
            <span className="wm-l">Promedio 12m</span>
            <div className="wm-v"><strong>{avg.toFixed(1)}</strong><span>m³</span></div>
            <span className="wm-d neutral">{(((current - avg) / avg) * 100).toFixed(0)}% sobre promedio</span>
          </div>
          <div className="water-metric">
            <span className="wm-l">Total año</span>
            <div className="wm-v"><strong>{u.data.reduce((a, b) => a + b, 0).toFixed(0)}</strong><span>m³</span></div>
            <span className="wm-d neutral">$ {(u.data.reduce((a, b) => a + b, 0) * 0.85).toFixed(0)} facturado</span>
          </div>
        </div>

        <div className="water-chart">
          <div className="water-chart-y">
            <span>{Math.round(max)}</span>
            <span>{Math.round(max * 0.66)}</span>
            <span>{Math.round(max * 0.33)}</span>
            <span>0</span>
          </div>
          <div className="water-chart-stage">
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="water-svg">
              <defs>
                <linearGradient id="waterArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--c-primary)" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="var(--c-primary)" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="waterAreaAlert" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--c-accent)" stopOpacity="0.32" />
                  <stop offset="100%" stopColor="var(--c-accent)" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[0.33, 0.66].map((g) => (
                <line key={g} x1="0" x2={W} y1={H * g} y2={H * g} stroke="var(--c-line)" strokeDasharray="0.6 1" strokeWidth="0.3" />
              ))}
              <path d={areaPath} fill={u.anomaly ? 'url(#waterAreaAlert)' : 'url(#waterArea)'} className="water-area" />
              <path d={linePath} fill="none" stroke={u.anomaly ? 'var(--c-accent)' : 'var(--c-primary)'} strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round" className="water-line" />
              <line x1="0" x2={W} y1={yFor(avg)} y2={yFor(avg)} stroke="var(--c-ink_3)" strokeDasharray="0.6 0.8" strokeWidth="0.3" />
            </svg>

            <div className="water-pts">
              {u.data.map((v, i) => {
                const isAnomaly = !!u.anomaly && u.anomaly.idx === i
                const isLast = i === u.data.length - 1
                return (
                  <div key={i} className={'water-pt ' + (isAnomaly ? 'anomaly' : '') + (isLast ? ' last' : '')}
                    style={{ left: `${xFor(i)}%`, top: `${yFor(v)}%`, '--d': (i * 80 + 400) + 'ms' } as CSSProperties}>
                    {(isLast || isAnomaly) && (
                      <div className={'water-tip ' + (isAnomaly ? 'alert' : '')}>
                        <strong>{v.toFixed(1)} m³</strong>
                        <span>{months[i]}</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="water-chart-x">
              {months.map((m, i) => (
                <span key={i} className={i === months.length - 1 ? 'current' : ''}>{m}</span>
              ))}
            </div>
          </div>
        </div>

        <div className="water-foot">
          {u.anomaly ? (
            <div className="water-alert">
              <span className="water-alert-i">!</span>
              <div className="water-alert-t">
                <strong>{u.anomaly.label} · {u.id}</strong>
                <span>{u.anomaly.reason} · revisión recomendada</span>
              </div>
              <button className="water-alert-cta">Crear ticket →</button>
            </div>
          ) : (
            <div className="water-alert ok">
              <span className="water-alert-i ok"><Icon.check size={14} /></span>
              <div className="water-alert-t">
                <strong>Consumo dentro de rango histórico</strong>
                <span>Sin anomalías detectadas en los últimos 12 meses</span>
              </div>
            </div>
          )}

          <div className="water-units">
            <span className="water-units-h">Otras unidades</span>
            <div className="water-units-list">
              {units.map((unit, i) => {
                if (i === activeUnit) return null
                const max2 = Math.max(...unit.data)
                return (
                  <button key={unit.id} className={'water-unit-row tone-' + unit.status} onClick={() => setActiveUnit(i)}>
                    <span className="wur-name">{unit.id}</span>
                    <svg viewBox="0 0 60 16" className="wur-spark">
                      <path
                        d={unit.data.map((v, j) => `${j === 0 ? 'M' : 'L'} ${(j / 11) * 60} ${16 - (v / max2) * 14}`).join(' ')}
                        fill="none"
                        stroke={unit.status === 'alert' ? 'var(--c-accent)' : 'var(--c-primary)'}
                        strokeWidth="1.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="wur-v">{unit.data[unit.data.length - 1].toFixed(1)}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

interface CalEvent { day: number; start: number; end: number; title: string; area: string; unit: string; tone: string }

function CondoVisual() {
  const events: CalEvent[] = [
    { day: 0, start: 18, end: 21, title: 'Yoga grupal', area: 'Salón social', unit: 'Apt 1102', tone: 'primary' },
    { day: 1, start: 9, end: 11, title: 'Mantenimiento', area: 'Piscina', unit: 'Staff', tone: 'neutral' },
    { day: 2, start: 16, end: 18, title: 'Cumpleaños', area: 'Asador', unit: 'Casa 12', tone: 'accent' },
    { day: 3, start: 19, end: 21, title: 'Torneo padel', area: 'Cancha', unit: 'Apt 408', tone: 'primary' },
    { day: 4, start: 20, end: 22, title: 'Cena privada', area: 'Salón social', unit: 'Apt 304', tone: 'primary' },
    { day: 5, start: 11, end: 14, title: 'Brunch familiar', area: 'Asador', unit: 'Casa 07', tone: 'accent' },
    { day: 5, start: 15, end: 18, title: 'Cumpleaños 5', area: 'Piscina', unit: 'Apt 1102', tone: 'accent' },
    { day: 6, start: 9, end: 11, title: 'Reunión junta', area: 'Salón social', unit: 'Junta', tone: 'neutral' },
    { day: 6, start: 17, end: 19, title: 'Clase natación', area: 'Piscina', unit: 'Apt 408', tone: 'primary' },
  ]
  const days = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
  const dateNums = [11, 12, 13, 14, 15, 16, 17]
  const today = 3
  const startHour = 8, endHour = 22
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i)

  return (
    <div className="modviz modviz-condo">
      <div className="modviz-card">
        <div className="modviz-h">
          <div className="condo-cal-h">
            <span className="condo-cal-month">Marzo · 2026</span>
            <span className="condo-cal-week">Semana 11</span>
          </div>
          <div className="condo-cal-legend">
            <span className="cleg cleg-primary"><i />Reserva</span>
            <span className="cleg cleg-accent"><i />Evento</span>
            <span className="cleg cleg-neutral"><i />Mantenimiento</span>
          </div>
        </div>

        <div className="condo-cal">
          <div className="cc-head">
            <div className="cc-corner" />
            {days.map((d, i) => (
              <div key={d} className={'cc-day-h ' + (i === today ? 'today' : '')}>
                <span className="cc-day-l">{d}</span>
                <span className="cc-day-n">{dateNums[i]}</span>
                {i === today && <i className="cc-today-dot" />}
              </div>
            ))}
          </div>

          <div className="cc-body">
            <div className="cc-hours">
              {hours.slice(0, -1).map((h) => (
                <div key={h} className="cc-hour">{h}:00</div>
              ))}
            </div>
            <div className="cc-grid">
              {hours.slice(0, -1).map((h, i) => (
                <div key={'line' + h} className="cc-hline" style={{ top: ((i + 1) / (hours.length - 1) * 100) + '%' }} />
              ))}
              {days.map((_, di) => (
                <div key={di} className={'cc-col ' + (di === today ? 'today-col' : '')}>
                  {events
                    .filter((e) => e.day === di)
                    .map((e, ei) => {
                      const top = ((e.start - startHour) / (endHour - startHour)) * 100
                      const height = ((e.end - e.start) / (endHour - startHour)) * 100
                      return (
                        <div
                          key={ei}
                          className={'cc-evt tone-' + e.tone}
                          style={{ '--top': top + '%', '--h': height + '%', '--d': ei * 120 + 'ms' } as CSSProperties}
                        >
                          <span className="cc-evt-time">{e.start}:00 – {e.end}:00</span>
                          <strong className="cc-evt-title">{e.title}</strong>
                          <span className="cc-evt-meta">{e.area} · {e.unit}</span>
                        </div>
                      )
                    })}
                </div>
              ))}
              <div className="cc-now" style={{ left: `calc(${(today / 7) * 100}% + 1px)`, top: '55%' }}>
                <span>14:32</span>
              </div>
            </div>
          </div>
        </div>

        <div className="condo-cal-foot">
          <div className="ccf-stat">
            <span className="ccf-stat-l">Reservas esta semana</span>
            <strong>9</strong>
          </div>
          <div className="ccf-stat">
            <span className="ccf-stat-l">Depósitos cobrados</span>
            <strong>$1,240</strong>
          </div>
          <div className="ccf-stat">
            <span className="ccf-stat-l">Conflictos</span>
            <strong className="ok">0</strong>
          </div>
          <span className="ccf-cta">Ver agenda completa →</span>
        </div>
      </div>
    </div>
  )
}

export function FeaturesGrid({ t }: { t: Copy }) {
  const icons = [Icon.phone, Icon.drop, Icon.chart, Icon.calendar, Icon.message, Icon.building]
  return (
    <section className="features" id="features">
      <div className="container">
        <header className="section-h">
          <span className="eyebrow">{t.features.eyebrow}</span>
          <h2 className="display-h">{t.features.title}</h2>
        </header>
        <div className="features-grid">
          {t.features.items.map((it, i) => {
            const I = icons[i]
            return (
              <article key={it.t} className="feature-card">
                <span className="feature-icon"><I size={20} /></span>
                <h3>{it.t}</h3>
                <p>{it.d}</p>
              </article>
            )
          })}
        </div>
      </div>
    </section>
  )
}
