import { useState } from 'react'
import { Icon } from './icons'
import type { Copy } from './i18n'

// Pricing model:
//   single module (agua OR condos): $10 activation incl. 1 project, $1/unit primary
//   bundle (agua + condos):         $15 activation incl. 1 project, $1/unit primary
//   each additional project:        $10 + $0.80/unit
// Result is a monthly total.
export function PricingSection({ t, onCta }: { t: Copy; onCta: () => void }) {
  const [mod, setMod] = useState('bundle')
  const [projects, setProjects] = useState(2)
  const [primaryUnits, setPrimaryUnits] = useState(48)
  const [extraUnits, setExtraUnits] = useState(36)

  const activation = mod === 'bundle' ? 15 : 10
  const extraProjectsCount = Math.max(0, projects - 1)
  const extraProjectsCost = extraProjectsCount * 10
  const primaryCost = primaryUnits * 1
  const extraUnitsCost = extraUnits * 0.8
  const total = activation + primaryCost + extraProjectsCost + extraUnitsCost
  const totalStr = total.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const activeLabel = t.pricing.modules.find((m) => m.id === mod)?.label ?? ''

  return (
    <section className="pricing" id="pricing">
      <div className="container">
        <header className="section-h">
          <span className="eyebrow">{t.pricing.eyebrow}</span>
          <h2 className="display-h">{t.pricing.title}</h2>
          <p className="section-sub">{t.pricing.sub}</p>
        </header>

        <div className="pricing-grid">
          <div className="pricing-config">
            <div className="pr-block">
              <span className="pr-label">{t.pricing.module}</span>
              <div className="pr-mods">
                {t.pricing.modules.map((m) => (
                  <button key={m.id} className={'pr-mod ' + (mod === m.id ? 'active' : '')} onClick={() => setMod(m.id)}>
                    {m.badge && <span className="pr-mod-badge">{m.badge}</span>}
                    <span className="pr-mod-icon">
                      {m.id === 'agua' ? <Icon.drop size={18} /> :
                        m.id === 'condos' ? <Icon.building size={18} /> :
                          <span className="pr-stack"><Icon.drop size={14} /><Icon.building size={14} /></span>}
                    </span>
                    <strong>{m.label}</strong>
                    <span className="pr-mod-desc">{m.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="pr-block">
              <PrLine label={t.pricing.projects_label} value={projects} min={1} max={20} unit={t.pricing.proyectos_unit}
                onChange={(v) => {
                  setProjects(v)
                  if (v === 1) setExtraUnits(0)
                }} />
              <PrLine label={t.pricing.units_primary} value={primaryUnits} min={1} max={500} step={1} unit={t.pricing.unidades_unit}
                onChange={setPrimaryUnits} />
              {projects > 1 && (
                <PrLine label={t.pricing.units_extra} value={extraUnits} min={0} max={1000} step={1} unit={t.pricing.unidades_unit}
                  onChange={setExtraUnits} />
              )}
            </div>

            <div className="pr-includes">
              <span className="pr-label">{t.pricing.includes}</span>
              <ul>
                {t.pricing.includes_items.map((it) => (
                  <li key={it}><Icon.check size={14} /><span>{it}</span></li>
                ))}
              </ul>
            </div>
          </div>

          {/*
            Era <aside>, pero axe lo flagea con "Aside should not be contained
            in another landmark" porque vive dentro de <main>. Cambiamos a
            <div role="complementary"> + aria-label que comunica el rol al AT
            sin promover un landmark a nivel pagina.
          */}
          <div className="pricing-card" role="complementary" aria-label={t.pricing.eyebrow}>
            <header className="pc-h">
              <span className="pc-eyebrow">{activeLabel}</span>
              <h3 className="pc-total">
                <span className="pc-cur">$</span>
                <strong>{totalStr}</strong>
                <span className="pc-suf">{t.pricing.per_month}</span>
              </h3>
              <span className="pc-curr">{t.pricing.currency}</span>
            </header>

            <div className="pc-table">
              <PrRow label={t.pricing.activation} note={t.pricing.activation_note} value={'$' + activation.toFixed(2)} />
              <PrRow label={t.pricing.primary_row(primaryUnits)} value={'$' + primaryCost.toFixed(2)} />
              {extraProjectsCount > 0 && (
                <PrRow label={t.pricing.extra_projects_row(extraProjectsCount)} value={'$' + extraProjectsCost.toFixed(2)} />
              )}
              {extraUnits > 0 && (
                <PrRow label={t.pricing.extra_units_row(extraUnits)} value={'$' + extraUnitsCost.toFixed(2)} />
              )}
              <div className="pc-divider" />
              <PrRow label={t.pricing.monthly_total} value={'$' + totalStr} bold />
            </div>

            <button className="btn-primary btn-block btn-lg" onClick={onCta}>
              {t.pricing.cta}
              <Icon.arrow_right size={16} />
            </button>
            <p className="pc-foot">{t.pricing.foot}</p>
          </div>
        </div>
      </div>
    </section>
  )
}

// uid global counter para asociar label↔input sin colision en SSR ni dev HMR.
let prLineUidCounter = 0
function nextPrLineUid() { return `pr-line-${++prLineUidCounter}` }

function PrLine({ label, value, min, max, step = 1, unit, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (v: number) => void
}) {
  const dec = () => onChange(Math.max(min, value - step))
  const inc = () => onChange(Math.min(max, value + step))
  // Memoizamos el uid para que sea estable entre renders pero unico por
  // instancia (a11y requiere htmlFor↔id matchings; sin esto axe flag los inputs).
  const [uid] = useState(nextPrLineUid)
  const numId = `${uid}-num`
  const sliderId = `${uid}-slider`
  return (
    <div className="pr-line">
      <div className="pr-line-h">
        <label className="pr-line-l" htmlFor={numId}>{label}</label>
        <div className="pr-stepper">
          <button onClick={dec} aria-label={`Reducir ${label}`} type="button"><Icon.minus size={12} /></button>
          <input id={numId} type="number" value={value} min={min} max={max} step={step}
            aria-label={`${label} (${unit})`}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)))
            }} />
          <button onClick={inc} aria-label={`Aumentar ${label}`} type="button"><Icon.plus size={12} /></button>
        </div>
      </div>
      <input id={sliderId} type="range" className="pr-slider" min={min} max={max} step={step}
        aria-label={`${label} (${unit}, slider)`}
        value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <div className="pr-line-foot">
        <span>{min}</span>
        <span className="pr-line-unit">{unit}</span>
        <span>{max}</span>
      </div>
    </div>
  )
}

function PrRow({ label, value, note, bold }: { label: string; value: string; note?: string; bold?: boolean }) {
  return (
    <div className={'pc-row ' + (bold ? 'bold' : '')}>
      <div className="pc-row-l">
        <span>{label}</span>
        {note && <em>{note}</em>}
      </div>
      <span className="pc-row-v">{value}</span>
    </div>
  )
}
