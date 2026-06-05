import { useEffect, useState } from 'react'
import { Icon } from './icons'
import type { Copy } from './i18n'
import { openCookieSettings } from '../../lib/cookieConsentChannel'

export function DemoVideo({ t }: { t: Copy }) {
  const [scene, setScene] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setScene((n) => (n + 1) % 3), 3600)
    return () => clearInterval(id)
  }, [])

  const scenes = t.demo.scenes

  return (
    <section className="demo-video" aria-label="Product demo">
      <div className="container">
        <div className="dv-frame">
          <div className="dv-meta">
            <span className="dv-chip"><span className="dv-dot" />{t.demo.live}</span>
            <span className="dv-time">2:14</span>
          </div>
          <div className="dv-stage">
            {scenes.map((s, i) => (
              <div key={i} className={'dv-scene ' + (i === scene ? 'active' : '')}>
                <span className="dv-scene-label">{s.label}</span>
                <div className="dv-scene-mock">
                  <div className="dv-scene-row">
                    {i === 0 && <Icon.drop size={48} />}
                    {i === 1 && <Icon.check size={48} />}
                    {i === 2 && <Icon.calendar size={48} />}
                  </div>
                  <strong className="dv-scene-t">{s.t}</strong>
                  <span className="dv-scene-k">{s.k}</span>
                </div>
              </div>
            ))}
            <div className="dv-placeholder">
              <pre className="dv-placeholder-tag">{t.demo.placeholder}</pre>
            </div>
          </div>
          <div className="dv-controls">
            {scenes.map((s, i) => (
              <button key={i} className={'dv-dot-btn ' + (i === scene ? 'on' : '')}
                onClick={() => setScene(i)} aria-label={s.label} />
            ))}
            <span className="dv-controls-info">{t.demo.cycle}</span>
            <button className="dv-play"><Icon.play size={11} /> {t.demo.play}</button>
          </div>
        </div>
      </div>
    </section>
  )
}

export function Testimonials({ t }: { t: Copy }) {
  return (
    <section className="testimonials" id="customers">
      <div className="container">
        <header className="section-h">
          <span className="eyebrow">{t.testimonials.eyebrow}</span>
          <h2 className="display-h">{t.testimonials.title}</h2>
        </header>
        <div className="testi-grid">
          {t.testimonials.items.map((it, i) => (
            <article key={i} className="testi-card">
              <span className="testi-quote">“</span>
              <blockquote>{it.q}</blockquote>
              <footer>
                <div className="testi-avatar" aria-hidden="true">{it.n.split(' ').map((s) => s[0]).slice(0, 2).join('')}</div>
                <div>
                  <strong>{it.n}</strong>
                  <span>{it.r}</span>
                </div>
              </footer>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

export function FAQ({ t }: { t: Copy }) {
  const [open, setOpen] = useState(0)
  return (
    <section className="faq" id="faq">
      <div className="container">
        <header className="section-h">
          <span className="eyebrow">{t.faq.eyebrow}</span>
          <h2 className="display-h">{t.faq.title}</h2>
        </header>
        <div className="faq-list">
          {t.faq.items.map((it, i) => {
            const isOpen = open === i
            return (
              <details key={i} open={isOpen} onClick={(e) => {
                e.preventDefault()
                setOpen(isOpen ? -1 : i)
              }}>
                <summary>
                  <span>{it.q}</span>
                  <span className="faq-toggle">{isOpen ? <Icon.minus size={16} /> : <Icon.plus size={16} />}</span>
                </summary>
                <p>{it.a}</p>
              </details>
            )
          })}
        </div>
      </div>
    </section>
  )
}

export function FinalCTA({ t, onSignup }: { t: Copy; onSignup: () => void }) {
  return (
    <section className="final-cta">
      <div className="container">
        <div className="fc-card">
          <div className="fc-deco" aria-hidden="true">
            <span className="fc-deco-1" />
            <span className="fc-deco-2" />
            <span className="fc-deco-3" />
          </div>
          <div className="fc-text">
            <h2>{t.final_cta.title}</h2>
            <p>{t.final_cta.sub}</p>
          </div>
          <div className="fc-actions">
            <button className="btn-primary btn-lg" onClick={onSignup}>
              {t.final_cta.primary}
              <Icon.arrow_right size={16} />
            </button>
            <button className="btn-ghost-light btn-lg" onClick={() => document.getElementById('faq')?.scrollIntoView({ behavior: 'smooth' })}>{t.final_cta.secondary}</button>
          </div>
        </div>
      </div>
    </section>
  )
}

export function Footer({ t }: { t: Copy }) {
  // Cada item lleva href + external. Las columnas no-legales conservan el ancla #top;
  // la columna Legal apunta a las páginas legales públicas reales (rutas independientes),
  // abriéndolas en pestaña nueva con rel="noopener noreferrer".
  const placeholder = (labels: readonly string[]) => labels.map((label) => ({ label, href: '#top', external: false }))
  const cols = [
    { h: t.footer.product, items: placeholder(t.footer.product_links) },
    { h: t.footer.company, items: placeholder(t.footer.company_links) },
    { h: t.footer.resources, items: placeholder(t.footer.resources_links) },
    { h: t.footer.legal, items: t.footer.legal_doc_links.map((l) => ({ label: l.label, href: l.href, external: true })) },
  ]
  return (
    <footer className="site-foot">
      <div className="container">
        <div className="foot-top">
          <div className="foot-brand">
            <div className="brand"><Icon.logo size={32} /><span>AdministraTodo</span></div>
            <p className="foot-tag">{t.footer.tagline}</p>
            <div className="foot-locale">
              <span className="foot-pill">USD</span>
              <span className="foot-pill">v 2.1</span>
              <span className="foot-pill">Latam</span>
            </div>
          </div>
          <div className="foot-cols">
            {cols.map((c) => (
              <div key={c.h} className="foot-col">
                {/* h3 (no h4) para no romper la jerarquia: el contexto no tiene h3 previo. */}
                <h3>{c.h}</h3>
                <ul>{c.items.map((it) => (
                  <li key={it.label}>
                    {it.external
                      ? <a href={it.href} target="_blank" rel="noopener noreferrer">{it.label}</a>
                      : <a href={it.href}>{it.label}</a>}
                  </li>
                ))}</ul>
              </div>
            ))}
          </div>
        </div>

        <div className="foot-seo">
          <h3>{t.footer.seo_title}</h3>
          <p>{t.footer.seo_body}</p>
          <div className="foot-keywords">
            {t.footer.keywords.map((k) => (
              <span key={k} className="foot-kw">{k}</span>
            ))}
          </div>
        </div>

        <div className="foot-bottom">
          <span>{t.footer.copyright}</span>
          <button
            type="button"
            className="foot-cookie-btn"
            onClick={() => openCookieSettings()}
            style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer', color: 'var(--c-ink_2)', textDecoration: 'underline' }}
          >
            {t.footer.cookies_settings}
          </button>
          <span className="foot-status"><i />{t.footer.status}</span>
        </div>
      </div>
    </footer>
  )
}
