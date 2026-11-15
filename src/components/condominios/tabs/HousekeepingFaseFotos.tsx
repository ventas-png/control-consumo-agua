// Cuadrícula de fotos de UNA fase de un servicio de housekeeping (ingreso, inconvenientes o
// cierre): miniaturas seguras, botón de agregar (cámara nativa o selector) y eliminar. El tope
// por fase lo impone también la base (hk_fotos_preparar). Extraído de HousekeepingEvidencias
// para que el flujo por pasos lo reutilice tres veces.
//
// Con `inconvenienteId` pinta sólo las fotos de ESE inconveniente (fase «inconvenientes», una
// cuadrícula por ítem) y sube las nuevas con su id; el tope de 20 sigue siendo el de la fase
// entera, compartido entre los inconvenientes del servicio.
import { useRef } from 'react'
import { SecureImage } from '../../shared/SecureImage'
import { BUCKET_HOUSEKEEPING } from '../../../domain/shared/buckets'
import { isNative } from '../../../lib/platform'
import { MAX_FOTOS_POR_FASE } from '../../../domain/condominios/housekeepingEvidencias'
import type { FaseFotoHousekeeping, FotoHousekeeping } from '../../../types'

export interface FaseFotosProps {
  titulo: string
  ayuda: string
  fase: FaseFotoHousekeeping
  fotos: FotoHousekeeping[]
  canEdit: boolean
  /** Clave de lo que se está subiendo (ver `claveSubida`); null = nada. */
  subiendo: string | null
  onAgregar: (fase: FaseFotoHousekeeping, files: File[], inconvenienteId?: string | null) => void
  onEliminar: (f: FotoHousekeeping) => void
  onVer: (path: string) => void
  /**
   * Sólo las fotos de este inconveniente (`null` = las de la fase que no tienen ninguno,
   * anteriores a 20261124000000). Sin la prop, todas las de la fase.
   */
  inconvenienteId?: string | null
}

/** Qué se está subiendo: la fase, o la fase y el inconveniente. */
export function claveSubida(fase: FaseFotoHousekeeping, inconvenienteId?: string | null): string {
  return inconvenienteId === undefined ? fase : `${fase}:${inconvenienteId ?? 'sueltas'}`
}

export function HousekeepingFaseFotos({ titulo, ayuda, fase, fotos, canEdit, subiendo, onAgregar, onEliminar, onVer, inconvenienteId }: FaseFotosProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const porItem = inconvenienteId !== undefined
  const delaFase = fotos.filter(f => f.fase === fase)
  const lista = porItem ? delaFase.filter(f => (f.inconveniente_id ?? null) === inconvenienteId) : delaFase
  // El cupo es de la fase entera, aunque se pinte un inconveniente a la vez.
  const lleno = delaFase.length >= MAX_FOTOS_POR_FASE
  const clave = claveSubida(fase, inconvenienteId)
  const sufijo = porItem ? `-item-${inconvenienteId ?? 'sueltas'}` : ''

  async function abrirSelector() {
    if (!isNative()) { inputRef.current?.click(); return }
    const { takeNativePhoto } = await import('../../../lib/nativeCamera')
    const file = await takeNativePhoto(true)
    if (file) onAgregar(fase, [file], inconvenienteId)
  }

  return (
    <div data-testid={`fase-${fase}${sufijo}`}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--at-ink-2)', margin: '10px 0 6px' }}>
        {titulo}{' '}
        <span style={{ fontWeight: 400, color: 'var(--at-ink-3)' }}>
          ({porItem ? lista.length : `${lista.length}/${MAX_FOTOS_POR_FASE}`}) · {ayuda}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))', gap: 8 }}>
        {lista.map(f => (
          <div key={f.id} style={{ position: 'relative', paddingBottom: '75%' }}>
            {f.path ? (
              <button type="button" onClick={() => onVer(f.path!)} aria-label="Ver foto"
                style={{ position: 'absolute', inset: 0, padding: 0, border: 'none', background: 'none', cursor: 'zoom-in' }}>
                <SecureImage src={f.path} bucket={BUCKET_HOUSEKEEPING} alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8, border: '1.5px solid var(--at-line)', display: 'block' }} />
              </button>
            ) : (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontSize: 10, color: 'var(--at-ink-3)', border: '1.5px dashed var(--at-line)', borderRadius: 8, padding: 4 }}>
                Foto depurada (90 d)
              </div>
            )}
            {canEdit && (
              <button type="button" onClick={() => onEliminar(f)} aria-label="Eliminar foto"
                style={{ position: 'absolute', top: -7, right: -7, zIndex: 1, width: 20, height: 20, borderRadius: '50%', background: 'var(--at-danger)', color: 'var(--at-on-status)', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>×</button>
            )}
          </div>
        ))}
        {canEdit && !lleno && (
          <button type="button" onClick={abrirSelector} disabled={subiendo !== null} aria-label={`Agregar fotos: ${titulo}`}
            style={{ paddingBottom: '75%', position: 'relative', border: '2px dashed var(--at-line-strong)', borderRadius: 8, cursor: 'pointer', background: 'var(--at-surface-2)' }}>
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', fontSize: 11, color: 'var(--at-ink-3)' }}>
              {subiendo === clave ? 'Subiendo…' : <><span style={{ fontSize: 20 }}>📷</span>Agregar</>}
            </span>
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" multiple style={{ display: 'none' }} data-testid={`input-fotos-${fase}${sufijo}`}
        onChange={e => { const fs = Array.from(e.target.files ?? []); if (fs.length) onAgregar(fase, fs, inconvenienteId); e.target.value = '' }} />
    </div>
  )
}
