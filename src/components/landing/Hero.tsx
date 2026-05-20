import { type CSSProperties, type ReactNode } from 'react'
import { Icon } from './icons'
import type { Copy } from './i18n'

interface HeroProps {
  t: Copy
  onSignup: () => void
}

export function Hero({ t, onSignup }: HeroProps) {
  return (
    <section className="hero" id="top">
      <div className="hero-bg" aria-hidden="true">
        <div className="hero-mesh" />
        <div className="hero-grid" />
      </div>

      <div className="hero-inner">
        <div className="hero-copy">
          <h1 className="hero-title">
            <span>{t.hero.title_a}</span>
            <span>{t.hero.title_b}</span>
            <span>{t.hero.title_c} <em className="accent-script">{t.hero.title_accent}</em></span>
          </h1>
          <p className="hero-sub">{t.hero.sub}</p>
          <div className="hero-ctas">
            <button className="btn-primary btn-lg" onClick={onSignup}>
              {t.hero.cta_primary}
              <Icon.arrow_right size={16} />
            </button>
            <button className="btn-ghost btn-lg" onClick={() => document.getElementById('product')?.scrollIntoView({ behavior: 'smooth' })}>
              <span className="play-pill"><Icon.play size={10} /></span>
              {t.hero.cta_secondary}
            </button>
          </div>
        </div>

        <div className="hero-visual">
          <HeroVisual />
        </div>
      </div>
    </section>
  )
}

interface Callout {
  id: string
  icon: ReactNode
  label: string
  value: string
  delta: string
  tone: string
}

function HeroVisual() {
  const callouts: Callout[] = [
    { id: 'meter', icon: <Icon.drop size={14} />, label: 'Apt 304', value: '+18 m³', delta: 'vs. 22 m³ Feb', tone: 'primary' },
    { id: 'ticket', icon: <Icon.ticket size={14} />, label: 'Ticket #142', value: 'Resuelto', delta: 'Fuga · 2h 14m', tone: 'ok' },
    { id: 'booking', icon: <Icon.calendar size={14} />, label: 'Reserva', value: 'Salón 7pm', delta: 'Casa 12 · Sáb', tone: 'accent' },
    { id: 'dues', icon: <Icon.check size={14} />, label: 'Cuota Mar.', value: 'Pagada', delta: 'Apt 1102', tone: 'ok' },
  ]

  const heights = [42, 55, 48, 62, 70, 58, 65, 78, 72, 80, 68, 88]
  const monthLetters = ['E', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']

  return (
    <div className="hv-wrap" aria-hidden="true">
      <div className="hv-card hv-main">
        <div className="hv-bar">
          <div className="hv-traffic"><i /><i /><i /></div>
          <div className="hv-tab active">Panel</div>
          <div className="hv-tab">Agua</div>
          <div className="hv-tab">Cuotas</div>
          <div className="hv-tab">Reservas</div>
          <div className="hv-search">administra<span>.todo</span> / Vista Verde</div>
        </div>

        <div className="hv-body">
          <aside className="hv-side">
            <div className="hv-side-item active"><Icon.chart size={14} /><span>Resumen</span></div>
            <div className="hv-side-item"><Icon.drop size={14} /><span>Agua</span></div>
            <div className="hv-side-item"><Icon.building size={14} /><span>Cuotas</span></div>
            <div className="hv-side-item"><Icon.calendar size={14} /><span>Reservas</span></div>
            <div className="hv-side-item"><Icon.ticket size={14} /><span>Tickets</span><i className="dot">4</i></div>
            <div className="hv-side-item"><Icon.message size={14} /><span>Avisos</span></div>
          </aside>

          <div className="hv-main-pane">
            <header className="hv-h">
              <div>
                <h4>Vista Verde · Marzo</h4>
                <p>142 unidades · 4 proyectos activos</p>
              </div>
              <div className="hv-h-actions">
                <span className="hv-pill">Tiempo real</span>
                <span className="hv-pill ghost">Exportar</span>
              </div>
            </header>

            <div className="hv-kpis">
              <KPI label="Consumo hoy" value="2,438" unit="m³" trend="+4.2%" up />
              <KPI label="Cuotas al día" value="94.6" unit="%" trend="+1.1%" up />
              <KPI label="Tickets abiertos" value="7" unit="" trend="-3" />
            </div>

            <div className="hv-chart">
              <div className="hv-chart-h">
                <span>Consumo · últimos 12 meses</span>
                <span className="hv-chart-legend"><i className="lg-1" />Agua &nbsp; <i className="lg-2" />Promedio</span>
              </div>
              <div className="hv-chart-body">
                {heights.map((h, i) => (
                  <div key={i} className="hv-bar-col" style={{ '--h': h + '%', '--d': i * 60 + 'ms' } as CSSProperties}>
                    <div className="hv-bar-fill" />
                    <span className="hv-bar-lbl">{monthLetters[i]}</span>
                  </div>
                ))}
                <svg className="hv-avg-line" viewBox="0 0 600 200" preserveAspectRatio="none">
                  <path d="M0 130 Q 60 120 100 122 T 220 110 T 340 95 T 460 80 T 600 60"
                    fill="none" stroke="var(--c-accent)" strokeWidth="2" strokeDasharray="600" strokeDashoffset="0" />
                </svg>
              </div>
            </div>

            <div className="hv-list">
              <div className="hv-list-h">Actividad reciente</div>
              {[
                { i: <Icon.drop size={14} />, t: 'Lectura registrada · Apt 304', v: '+18 m³', k: 'hace 2 min' },
                { i: <Icon.check size={14} />, t: 'Cuota Marzo · Apt 1102', v: 'Q 850', k: 'hace 8 min' },
                { i: <Icon.calendar size={14} />, t: 'Reserva Salón · Casa 12', v: 'Sáb 7pm', k: 'hace 14 min' },
              ].map((row, i) => (
                <div key={i} className="hv-row" style={{ '--d': (i * 120 + 800) + 'ms' } as CSSProperties}>
                  <span className="hv-row-i">{row.i}</span>
                  <span className="hv-row-t">{row.t}</span>
                  <span className="hv-row-v">{row.v}</span>
                  <span className="hv-row-k">{row.k}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <FloatingCallout pos="top-left" delay={300} items={[callouts[0]]} />
      <FloatingCallout pos="top-right" delay={900} items={[callouts[2]]} />
      <FloatingCallout pos="bottom-left" delay={600} items={[callouts[1]]} />
      <FloatingCallout pos="bottom-right" delay={1200} items={[callouts[3]]} />

      <div className="hv-phone">
        <div className="hv-phone-screen">
          <div className="hv-phone-notch" />
          <div className="hv-phone-h">Tu consumo</div>
          <div className="hv-phone-num">
            <strong>18.2</strong>
            <span>m³</span>
          </div>
          <div className="hv-phone-spark">
            <svg viewBox="0 0 100 30" preserveAspectRatio="none">
              <path d="M0 22 L14 18 L28 20 L42 12 L56 14 L70 8 L84 10 L100 4"
                fill="none" stroke="var(--c-primary)" strokeWidth="1.5" />
            </svg>
          </div>
          <div className="hv-phone-row"><span>Cuota Marzo</span><b>Pagada</b></div>
          <div className="hv-phone-row"><span>Salón · Sáb</span><b>Reservado</b></div>
        </div>
      </div>
    </div>
  )
}

function KPI({ label, value, unit, trend, up }: { label: string; value: string; unit: string; trend: string; up?: boolean }) {
  return (
    <div className="hv-kpi">
      <span className="hv-kpi-l">{label}</span>
      <div className="hv-kpi-v">
        <strong>{value}</strong>
        {unit && <span>{unit}</span>}
      </div>
      <span className={'hv-kpi-d ' + (up ? 'up' : 'down')}>{trend}</span>
    </div>
  )
}

function FloatingCallout({ pos, delay, items }: { pos: string; delay: number; items: Callout[] }) {
  return (
    <div className={'hv-callout pos-' + pos} style={{ '--d': delay + 'ms' } as CSSProperties}>
      {items.map((it) => (
        <div key={it.id} className={'hv-callout-card tone-' + it.tone}>
          <span className="hv-callout-icon">{it.icon}</span>
          <div className="hv-callout-text">
            <span className="hv-callout-label">{it.label}</span>
            <strong className="hv-callout-value">{it.value}</strong>
          </div>
          <span className="hv-callout-delta">{it.delta}</span>
        </div>
      ))}
    </div>
  )
}
