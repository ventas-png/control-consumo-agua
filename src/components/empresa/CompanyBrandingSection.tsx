import { useEffect, useState, type CSSProperties } from 'react'
import { useBrandingQuery } from '../../domain/branding/queries'
import { useGuardarBrandingMutation } from '../../domain/branding/mutations'
import {
  derivarVariablesMarca, derivarVariablesMarcaOscuro, aclararParaTemaOscuro, normalizarColorHex, esColorHex,
  DEFAULT_BRAND_COLOR, DEFAULT_ACCENT_COLOR, DARK_SURFACE,
} from '../../lib/branding'

// plat:P20 — Configuración de marca (white-label) por empresa: color primario y de
// acento con vista previa en vivo. Solo owner/admin edita (canEdit). Los colores se
// aplican en toda la app (BrandingApplier en el shell) al guardar.

interface Props {
  companyId: string
  canEdit: boolean
}

const labelStyle: CSSProperties = { display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '6px' }

function ColorInput({ id, label, value, onChange, disabled }: {
  id: string; label: string; value: string; onChange: (v: string) => void; disabled: boolean
}) {
  return (
    <div>
      <label style={labelStyle} htmlFor={id}>{label}</label>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <input
          id={id} type="color" disabled={disabled}
          value={normalizarColorHex(value) ?? '#000000'}
          onChange={e => onChange(e.target.value)}
          style={{ width: '44px', height: '38px', border: '1px solid var(--at-line)', borderRadius: '8px', background: 'none', cursor: disabled ? 'default' : 'pointer' }}
        />
        <input
          type="text" disabled={disabled} value={value}
          onChange={e => onChange(e.target.value)} placeholder="#1B3B36"
          style={{ width: '110px', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', fontFamily: 'monospace', background: disabled ? 'var(--at-surface-2)' : 'var(--at-surface)', color: 'var(--at-ink)' }}
        />
      </div>
      {!esColorHex(value) && <div style={{ fontSize: '12px', color: 'var(--at-danger)', marginTop: '6px' }}>Hex inválido (ej. #1B3B36).</div>}
    </div>
  )
}

/** Fila de vista previa con fondo FIJO (no sigue el tema): muestra cómo se ve la
 *  marca en el tema claro y en el oscuro, sea cual sea el tema actual. */
function PreviewFila({ etiqueta, fondo, tinta, borde, primary, soft, softInk, accent }: {
  etiqueta: string; fondo: string; tinta: string; borde: string
  primary: string; soft: string; softInk: string; accent: string
}) {
  return (
    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '12px 14px', border: `1px solid ${borde}`, borderRadius: '10px', background: fondo, flexWrap: 'wrap' }}>
      <span style={{ fontSize: '11px', fontWeight: 600, color: tinta, minWidth: '44px' }}>{etiqueta}</span>
      <button type="button" style={{ background: primary, color: 'white', border: 'none', borderRadius: '8px', padding: '8px 16px', fontSize: '13px', fontWeight: 600, cursor: 'default' }}>Botón</button>
      <span style={{ background: soft, color: softInk, borderRadius: '8px', padding: '4px 10px', fontSize: '12px', fontWeight: 700 }}>Suave</span>
      <span style={{ background: accent, color: 'white', borderRadius: '8px', padding: '4px 10px', fontSize: '12px', fontWeight: 700 }}>Acento</span>
    </div>
  )
}

export function CompanyBrandingSection({ companyId, canEdit }: Props) {
  const { data: row, isLoading } = useBrandingQuery(companyId)
  const guardar = useGuardarBrandingMutation()
  const [color, setColor] = useState<string>(DEFAULT_BRAND_COLOR)
  const [accent, setAccent] = useState<string>(DEFAULT_ACCENT_COLOR)

  useEffect(() => {
    setColor(normalizarColorHex(row?.primary_color) ?? DEFAULT_BRAND_COLOR)
    setAccent(normalizarColorHex(row?.accent_color) ?? DEFAULT_ACCENT_COLOR)
  }, [row])

  const validos = esColorHex(color) && esColorHex(accent)
  const vars = derivarVariablesMarca(color)
  const varsOscuro = derivarVariablesMarcaOscuro(color)
  const accentHex = normalizarColorHex(accent) ?? DEFAULT_ACCENT_COLOR
  const personalizado = !!normalizarColorHex(row?.primary_color) || !!normalizarColorHex(row?.accent_color)

  return (
    <div>
      <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--at-ink)', marginBottom: '4px' }}>
        Marca / White-label
      </div>
      <p style={{ fontSize: '13px', color: 'var(--at-ink-2)', marginTop: 0, marginBottom: '18px', lineHeight: 1.5 }}>
        Colores de tu marca (primario y de acento); se usan para botones y acentos de la aplicación.
        {!canEdit && ' Solo un administrador puede cambiarlos.'}
      </p>

      <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <ColorInput id="brand-primary" label="Color primario" value={color} onChange={setColor} disabled={!canEdit} />
        <ColorInput id="brand-accent" label="Color de acento" value={accent} onChange={setAccent} disabled={!canEdit} />

        <div style={{ flex: 1, minWidth: '220px' }}>
          <label style={labelStyle}>Vista previa</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <PreviewFila etiqueta="Claro" fondo="#FFFFFF" tinta="#3E5A4C" borde="#E1DDD0"
              primary={vars.primary} soft={vars.soft} softInk={vars.hover} accent={accentHex} />
            <PreviewFila etiqueta="Oscuro" fondo={DARK_SURFACE} tinta="#B7C4BB" borde="#28352D"
              primary={varsOscuro.primary} soft={varsOscuro.soft} softInk={varsOscuro.primary} accent={aclararParaTemaOscuro(accentHex)} />
          </div>
        </div>
      </div>

      {canEdit && (
        <div style={{ marginTop: '18px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => guardar.mutate({ companyId, primaryColor: normalizarColorHex(color), accentColor: normalizarColorHex(accent) })}
            disabled={!validos || guardar.isPending || isLoading}
            style={{ border: '1px solid var(--at-primary)', background: 'var(--at-primary)', color: 'white', fontWeight: 600, fontSize: '13px', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', opacity: validos ? 1 : 0.6 }}
          >
            {guardar.isPending ? 'Guardando…' : 'Guardar marca'}
          </button>
          {personalizado && (
            <button
              onClick={() => { setColor(DEFAULT_BRAND_COLOR); setAccent(DEFAULT_ACCENT_COLOR); guardar.mutate({ companyId, primaryColor: null, accentColor: null }) }}
              disabled={guardar.isPending}
              style={{ border: '1px solid var(--at-line)', background: 'transparent', color: 'var(--at-ink-2)', fontWeight: 600, fontSize: '13px', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer' }}
            >
              Restablecer
            </button>
          )}
          {guardar.isSuccess && <span style={{ fontSize: '12px', color: '#10b981', fontWeight: 600 }}>Guardado ✓</span>}
          {guardar.isError && <span style={{ fontSize: '12px', color: 'var(--at-danger)' }}>No se pudo guardar.</span>}
        </div>
      )}

      <p style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '14px', marginBottom: 0 }}>
        Los colores se aplican en toda la interfaz al guardar.
      </p>
    </div>
  )
}
