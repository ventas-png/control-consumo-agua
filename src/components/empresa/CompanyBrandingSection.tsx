import { useEffect, useState, type CSSProperties } from 'react'
import { useBrandingQuery } from '../../domain/branding/queries'
import { useGuardarBrandingMutation } from '../../domain/branding/mutations'
import { derivarVariablesMarca, normalizarColorHex, esColorHex, DEFAULT_BRAND_COLOR } from '../../lib/branding'

// plat:P20 — Configuración de marca (white-label) por empresa: color primario con
// vista previa en vivo. Solo owner/admin edita (canEdit). La aplicación del color
// en toda la app es un follow-up; aquí se almacena + previsualiza.

interface Props {
  companyId: string
  canEdit: boolean
}

const labelStyle: CSSProperties = { display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '6px' }

export function CompanyBrandingSection({ companyId, canEdit }: Props) {
  const { data: row, isLoading } = useBrandingQuery(companyId)
  const guardar = useGuardarBrandingMutation()
  const [color, setColor] = useState<string>(DEFAULT_BRAND_COLOR)

  useEffect(() => {
    setColor(normalizarColorHex(row?.primary_color) ?? DEFAULT_BRAND_COLOR)
  }, [row])

  const valido = esColorHex(color)
  const vars = derivarVariablesMarca(color)
  const personalizado = !!normalizarColorHex(row?.primary_color)

  return (
    <div>
      <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--at-ink)', marginBottom: '4px' }}>
        Marca / White-label
      </div>
      <p style={{ fontSize: '13px', color: 'var(--at-ink-2)', marginTop: 0, marginBottom: '18px', lineHeight: 1.5 }}>
        Color primario de tu marca; se usará para botones y acentos de la aplicación.
        {!canEdit && ' Solo un administrador puede cambiarlo.'}
      </p>

      <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <label style={labelStyle} htmlFor="brand-color">Color</label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              id="brand-color" type="color" disabled={!canEdit}
              value={normalizarColorHex(color) ?? DEFAULT_BRAND_COLOR}
              onChange={e => setColor(e.target.value)}
              style={{ width: '44px', height: '38px', border: '1px solid var(--at-line)', borderRadius: '8px', background: 'none', cursor: canEdit ? 'pointer' : 'default' }}
            />
            <input
              type="text" disabled={!canEdit} value={color}
              onChange={e => setColor(e.target.value)} placeholder="#1B3B36"
              style={{ width: '120px', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', fontFamily: 'monospace', background: canEdit ? 'var(--at-surface)' : 'var(--at-surface-2)', color: 'var(--at-ink)' }}
            />
          </div>
          {!valido && <div style={{ fontSize: '12px', color: 'var(--at-danger)', marginTop: '6px' }}>Color hex inválido (ej. #1B3B36).</div>}
        </div>

        <div style={{ flex: 1, minWidth: '220px' }}>
          <label style={labelStyle}>Vista previa</label>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '12px 14px', border: '1px solid var(--at-line)', borderRadius: '10px', background: 'var(--at-surface)' }}>
            <button type="button" style={{ background: vars.primary, color: 'white', border: 'none', borderRadius: '8px', padding: '8px 16px', fontSize: '13px', fontWeight: 600, cursor: 'default' }}>Botón</button>
            <span style={{ background: vars.soft, color: vars.hover, borderRadius: '8px', padding: '4px 10px', fontSize: '12px', fontWeight: 700 }}>Acento</span>
          </div>
        </div>
      </div>

      {canEdit && (
        <div style={{ marginTop: '18px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => guardar.mutate({ companyId, primaryColor: normalizarColorHex(color) })}
            disabled={!valido || guardar.isPending || isLoading}
            style={{ border: '1px solid var(--at-primary)', background: 'var(--at-primary)', color: 'white', fontWeight: 600, fontSize: '13px', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', opacity: valido ? 1 : 0.6 }}
          >
            {guardar.isPending ? 'Guardando…' : 'Guardar marca'}
          </button>
          {personalizado && (
            <button
              onClick={() => { setColor(DEFAULT_BRAND_COLOR); guardar.mutate({ companyId, primaryColor: null }) }}
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
        La aplicación del color en toda la interfaz se completa en una actualización siguiente; aquí ya queda guardado y previsualizado.
      </p>
    </div>
  )
}
