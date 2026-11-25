import { useState, type ChangeEvent, type CSSProperties } from 'react'
import { ModalPortal } from '../shared/ModalPortal'
import { isNative } from '../../lib/platform'
import {
  MOTIVOS_OMISION,
  fotoObligatoria,
  validarOmision,
  type MotivoOmision,
} from '../../domain/agua/lecturasOmitidas'

export interface DatosSalto {
  motivo: MotivoOmision
  detalle: string
  foto: File | null
}

interface Props {
  /** Qué se está saltando, para que el lecturista confirme que es la parada correcta. */
  unidadNombre: string
  /** Contadores que quedan sin leer (texto ya armado), o null si la unidad no tiene. */
  contadoresTexto: string | null
  onCancelar: () => void
  /** Devuelve true si se guardó: entonces el modal se cierra desde fuera. */
  onConfirmar: (datos: DatosSalto) => Promise<boolean>
}

/**
 * «No se pudo leer esta parada»: motivo de una lista, detalle y foto de
 * evidencia. La foto es obligatoria salvo cuando acercarse ES el riesgo.
 */
export function SaltarParadaModal({ unidadNombre, contadoresTexto, onCancelar, onConfirmar }: Props) {
  const [motivo, setMotivo] = useState<MotivoOmision | ''>('')
  const [detalle, setDetalle] = useState('')
  const [foto, setFoto] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [intentado, setIntentado] = useState(false)

  const error = validarOmision({ motivo, detalle, tieneFoto: !!foto })

  function aplicarFoto(f: File) {
    setFoto(f)
    const reader = new FileReader()
    reader.onload = ev => setPreview(ev.target?.result as string)
    reader.readAsDataURL(f)
  }

  function handleFoto(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) aplicarFoto(f)
  }

  async function handleFotoNativa() {
    const { takeNativePhoto } = await import('../../lib/nativeCamera')
    const f = await takeNativePhoto(true)
    if (f) aplicarFoto(f)
  }

  async function confirmar() {
    setIntentado(true)
    if (error || !motivo || guardando) return
    setGuardando(true)
    try {
      await onConfirmar({ motivo, detalle: detalle.trim(), foto })
    } finally {
      setGuardando(false)
    }
  }

  const label: CSSProperties = { fontSize: '14px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '6px', display: 'block' }
  const fotoBox: CSSProperties = {
    border: `3px dashed ${intentado && fotoObligatoria(motivo) && !foto ? 'var(--at-danger)' : 'var(--at-line-strong)'}`,
    borderRadius: '12px', padding: '16px', textAlign: 'center', cursor: 'pointer',
    background: 'var(--at-surface-2)', display: 'block', width: '100%', color: 'inherit', font: 'inherit',
    boxSizing: 'border-box',
  }
  const contenidoFoto = preview
    ? <img src={preview} style={{ maxWidth: '100%', maxHeight: '160px', borderRadius: '8px' }} alt="Evidencia" />
    : <span>📷 Tomar foto de evidencia{fotoObligatoria(motivo) ? '' : ' (opcional)'}</span>

  return (
    <ModalPortal>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="saltar-parada-titulo"
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
      >
        <div style={{ background: 'var(--at-surface)', borderRadius: '16px', width: '100%', maxWidth: '520px', maxHeight: '92vh', overflowY: 'auto', padding: '24px', boxShadow: '0 20px 60px rgba(0,0,0,0.25)', boxSizing: 'border-box' }}>
          <h2 id="saltar-parada-titulo" style={{ margin: '0 0 4px', fontSize: '19px' }}>⏭️ No se pudo leer esta parada</h2>
          <p style={{ margin: '0 0 18px', fontSize: '13px', color: 'var(--at-ink-3)' }}>
            <strong style={{ color: 'var(--at-ink-2)' }}>{unidadNombre}</strong>
            {contadoresTexto ? ` · ${contadoresTexto}` : ' · sin contadores activos'}
            <br />Quedará en «Lecturas pendientes» para tomarla después.
          </p>

          <fieldset style={{ border: 'none', padding: 0, margin: '0 0 16px' }}>
            <legend style={label}>Motivo *</legend>
            <div style={{ display: 'grid', gap: '8px' }}>
              {MOTIVOS_OMISION.map(m => (
                <label
                  key={m.value}
                  style={{
                    display: 'flex', gap: '10px', alignItems: 'flex-start', cursor: 'pointer',
                    padding: '10px 12px', borderRadius: '10px',
                    border: `2px solid ${motivo === m.value ? 'var(--at-primary)' : 'var(--at-line)'}`,
                    background: motivo === m.value ? 'var(--at-primary-tint)' : 'var(--at-surface)',
                  }}
                >
                  <input
                    type="radio"
                    name="motivo-omision"
                    value={m.value}
                    checked={motivo === m.value}
                    onChange={() => setMotivo(m.value)}
                    style={{ marginTop: '3px' }}
                  />
                  <span>
                    <span style={{ fontWeight: 600, fontSize: '14px' }}>{m.label}</span>
                    <span style={{ display: 'block', fontSize: '12px', color: 'var(--at-ink-3)' }}>{m.ayuda}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div style={{ marginBottom: '16px' }}>
            <label htmlFor="omision-detalle" style={label}>Detalle{motivo === 'otro' ? ' *' : ''}</label>
            <textarea
              id="omision-detalle"
              value={detalle}
              onChange={e => setDetalle(e.target.value)}
              maxLength={1000}
              rows={2}
              placeholder="Ej.: pick-up gris estacionado sobre la caja del contador"
              style={{ padding: '10px 14px', border: '2px solid var(--at-line)', borderRadius: '10px', fontSize: '15px', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical' }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <span style={label}>Evidencia{fotoObligatoria(motivo) ? ' *' : ''}</span>
            {isNative() ? (
              <button type="button" onClick={handleFotoNativa} style={fotoBox}>{contenidoFoto}</button>
            ) : (
              <label style={fotoBox}>
                <input type="file" accept="image/*" capture="environment" hidden onChange={handleFoto} aria-label="Foto de evidencia" />
                {contenidoFoto}
              </label>
            )}
          </div>

          {intentado && error && (
            <div role="alert" style={{ background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', color: 'var(--at-danger)', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', marginBottom: '14px' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={onCancelar}
              disabled={guardando}
              style={{ padding: '12px 20px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
            >
              Volver
            </button>
            <button
              type="button"
              onClick={() => void confirmar()}
              disabled={guardando}
              style={{ padding: '12px 20px', background: guardando ? 'var(--at-ink-3)' : 'var(--at-warning-strong)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 700, cursor: guardando ? 'wait' : 'pointer' }}
            >
              {guardando ? 'Guardando…' : '⏭️ Saltar y continuar'}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
