import { useEffect, useState, type CSSProperties } from 'react'
import { useMisPreferenciasQuery } from '../../domain/preferencias/queries'
import { useGuardarPreferenciasMutation } from '../../domain/preferencias/mutations'
import {
  normalizarPreferencias, formatFechaHora, formatMoneda,
  TIMEZONES_DISPONIBLES, CURRENCIES_DISPONIBLES,
  type LocalePref, type CurrencyPref, type PreferenciasRegionales,
} from '../../lib/formatoRegional'

// plat:P18 — Preferencias regionales del usuario (idioma, zona horaria, moneda)
// con vista previa en vivo. Se monta dentro de una <Card> en PerfilSection.
// Lógica de formateo en src/lib/formatoRegional (pura); datos en src/domain.

const labelStyle: CSSProperties = { display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '6px' }
const selectStyle: CSSProperties = { width: '100%', padding: '10px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface)', color: 'var(--at-ink)', boxSizing: 'border-box' }

export function PreferenciasRegionales({ userId }: { userId: string }) {
  const { data: row, isLoading } = useMisPreferenciasQuery(userId)
  const guardar = useGuardarPreferenciasMutation()
  const [prefs, setPrefs] = useState<PreferenciasRegionales>(() => normalizarPreferencias())

  // Sincroniza el formulario cuando llega/cambia la fila guardada.
  useEffect(() => {
    setPrefs(normalizarPreferencias(row ?? undefined))
  }, [row])

  function set<K extends keyof PreferenciasRegionales>(k: K, v: PreferenciasRegionales[K]) {
    setPrefs(p => ({ ...p, [k]: v }))
  }

  if (isLoading) {
    return <div style={{ fontSize: '13px', color: 'var(--at-ink-3)', padding: '8px 0' }}>Cargando preferencias…</div>
  }

  const ahora = new Date().toISOString()

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
        <div>
          <label style={labelStyle} htmlFor="pref-locale">Idioma</label>
          <select id="pref-locale" style={selectStyle} value={prefs.locale} onChange={e => set('locale', e.target.value as LocalePref)}>
            <option value="es">Español</option>
            <option value="en">English</option>
          </select>
        </div>
        <div>
          <label style={labelStyle} htmlFor="pref-currency">Moneda</label>
          <select id="pref-currency" style={selectStyle} value={prefs.currency} onChange={e => set('currency', e.target.value as CurrencyPref)}>
            {CURRENCIES_DISPONIBLES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
      </div>

      <div style={{ marginTop: '14px' }}>
        <label style={labelStyle} htmlFor="pref-tz">Zona horaria</label>
        <select id="pref-tz" style={selectStyle} value={prefs.timezone} onChange={e => set('timezone', e.target.value)}>
          {TIMEZONES_DISPONIBLES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          {!TIMEZONES_DISPONIBLES.some(t => t.value === prefs.timezone) && (
            <option value={prefs.timezone}>{prefs.timezone}</option>
          )}
        </select>
      </div>

      <div style={{ marginTop: '16px', padding: '12px 14px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '10px' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '4px' }}>Vista previa</div>
        <div style={{ fontSize: '13px', color: 'var(--at-ink)' }}>
          {formatFechaHora(ahora, prefs)} · {formatMoneda(1234.5, prefs)}
        </div>
      </div>

      <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center' }}>
        <button
          onClick={() => guardar.mutate({ userId, locale: prefs.locale, timezone: prefs.timezone, currency: prefs.currency })}
          disabled={guardar.isPending}
          style={{ border: '1px solid var(--at-primary)', background: 'var(--at-primary)', color: 'white', fontWeight: 600, fontSize: '13px', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer' }}
        >
          {guardar.isPending ? 'Guardando…' : 'Guardar preferencias'}
        </button>
        {guardar.isSuccess && <span style={{ marginLeft: '12px', fontSize: '12px', color: '#10b981', fontWeight: 600 }}>Guardado ✓</span>}
        {guardar.isError && <span style={{ marginLeft: '12px', fontSize: '12px', color: 'var(--at-danger)' }}>No se pudo guardar.</span>}
      </div>
    </div>
  )
}
