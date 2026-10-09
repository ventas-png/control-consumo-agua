// Evidencia de un servicio de housekeeping: cómo se encontró la unidad, cómo
// quedó, quién lo hizo, e informe PDF para compartir. Las fotos se depuran a los
// 90 días; el texto no (ver docs/PURGA_FOTOS_SCHEDULE.md).
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { ModalPortal } from '../../shared/ModalPortal'
import { SecureImage } from '../../shared/SecureImage'
import { notify } from '../../shared/Dialog'
import { useUsuariosMap } from '../../../domain/usuarios/queries'
import { updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { BUCKET_HOUSEKEEPING } from '../../../domain/shared/buckets'
import { isNative } from '../../../lib/platform'
import {
  MAX_FOTOS_POR_FASE, cupoDisponible, eliminarFotoServicio, listarFotosServicio, subirFotoServicio,
} from '../../../domain/condominios/housekeepingEvidencias'
import { compartirOdescargarPdf, generarInformeHousekeepingPdf } from './housekeepingPdf'
import type { FaseFotoHousekeeping, FotoHousekeeping, ServicioHousekeeping } from '../../../types'

interface Props {
  servicio: ServicioHousekeeping
  projectId: string
  companyId: string
  tipoLabel: string
  estadoLabel: string
  canEdit: boolean
  onClose: () => void
  onRefresh: () => void
}

const area: CSSProperties = { width: '100%', minHeight: 80, padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 13, color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical' }
const btn: CSSProperties = { padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: '1.5px solid var(--at-line)', background: 'var(--at-surface)', color: 'var(--at-ink)' }

function FaseFotos({ titulo, ayuda, fase, fotos, canEdit, subiendo, onAgregar, onEliminar, onVer }: {
  titulo: string; ayuda: string; fase: FaseFotoHousekeeping; fotos: FotoHousekeeping[]; canEdit: boolean
  subiendo: FaseFotoHousekeeping | null
  onAgregar: (fase: FaseFotoHousekeeping, files: File[]) => void
  onEliminar: (f: FotoHousekeeping) => void
  onVer: (path: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const lista = fotos.filter(f => f.fase === fase)
  const lleno = lista.length >= MAX_FOTOS_POR_FASE

  async function abrirSelector() {
    if (!isNative()) { inputRef.current?.click(); return }
    const { takeNativePhoto } = await import('../../../lib/nativeCamera')
    const file = await takeNativePhoto(true)
    if (file) onAgregar(fase, [file])
  }

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--at-ink-2)', margin: '10px 0 6px' }}>
        {titulo} <span style={{ fontWeight: 400, color: 'var(--at-ink-3)' }}>({lista.length}/{MAX_FOTOS_POR_FASE}) · {ayuda}</span>
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
          <button type="button" onClick={abrirSelector} disabled={subiendo !== null}
            style={{ paddingBottom: '75%', position: 'relative', border: '2px dashed var(--at-line-strong)', borderRadius: 8, cursor: 'pointer', background: 'var(--at-surface-2)' }}>
            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', fontSize: 11, color: 'var(--at-ink-3)' }}>
              {subiendo === fase ? 'Subiendo…' : <><span style={{ fontSize: 20 }}>📷</span>Agregar</>}
            </span>
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
        onChange={e => { const fs = Array.from(e.target.files ?? []); if (fs.length) onAgregar(fase, fs); e.target.value = '' }} />
    </div>
  )
}

export function HousekeepingEvidencias({ servicio, projectId, tipoLabel, estadoLabel, canEdit, onClose, onRefresh }: Props) {
  const { mapa } = useUsuariosMap()
  const [fotos, setFotos] = useState<FotoHousekeeping[]>([])
  const [hallazgos, setHallazgos] = useState(servicio.hallazgos_ingreso ?? '')
  const [cierre, setCierre] = useState(servicio.observaciones_cierre ?? '')
  const [guardando, setGuardando] = useState(false)
  const [subiendo, setSubiendo] = useState<FaseFotoHousekeeping | null>(null)
  const [generando, setGenerando] = useState(false)
  const [visor, setVisor] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const { data, error } = await listarFotosServicio(servicio.id)
    if (error) notify({ variant: 'error', title: 'No se pudieron cargar las fotos', text: error })
    else setFotos(data)
  }, [servicio.id])
  useEffect(() => { void cargar() }, [cargar])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (visor) setVisor(null); else onClose() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, visor])

  const nombre = (id?: string | null) => (id ? (mapa.get(id)?.full_name?.trim() || `Usuario ${id.slice(0, 8)}`) : undefined)
  const sucio = hallazgos !== (servicio.hallazgos_ingreso ?? '') || cierre !== (servicio.observaciones_cierre ?? '')

  async function guardarTexto(): Promise<boolean> {
    if (!sucio) return true
    setGuardando(true)
    const { error } = await updateCondominioRow('servicios_housekeeping', servicio.id, {
      hallazgos_ingreso: hallazgos.trim() || null, observaciones_cierre: cierre.trim() || null,
    })
    setGuardando(false)
    if (error) { notify({ variant: 'error', title: 'Error al guardar', text: error.message }); return false }
    onRefresh()
    return true
  }

  async function agregar(fase: FaseFotoHousekeeping, files: File[]) {
    const actuales = fotos.filter(f => f.fase === fase).length
    const caben = cupoDisponible(actuales, files.length)
    if (caben < files.length) notify({ variant: 'warning', title: 'Límite de fotos', text: `Máximo ${MAX_FOTOS_POR_FASE} por fase; se subirán ${caben}.` })
    setSubiendo(fase)
    for (const file of files.slice(0, caben)) {
      const { data, error } = await subirFotoServicio({ projectId, servicioId: servicio.id, fase, file })
      if (error || !data) { notify({ variant: 'error', title: 'No se pudo subir la foto', text: error ?? '' }); break }
      setFotos(prev => [...prev, data])
    }
    setSubiendo(null)
  }

  async function eliminar(f: FotoHousekeeping) {
    const { error } = await eliminarFotoServicio(f)
    if (error) return notify({ variant: 'error', title: 'No se pudo eliminar', text: error })
    setFotos(prev => prev.filter(x => x.id !== f.id))
  }

  async function compartir() {
    setGenerando(true)
    try {
      if (canEdit && !(await guardarTexto())) return
      const blob = await generarInformeHousekeepingPdf({
        servicio: { ...servicio, hallazgos_ingreso: hallazgos, observaciones_cierre: cierre },
        fotos, tipoLabel, estadoLabel,
        iniciadoPor: nombre(servicio.iniciado_por), completadoPor: nombre(servicio.completado_por),
      })
      const compartido = await compartirOdescargarPdf(blob, `housekeeping-${servicio.unidad_nombre ?? 'servicio'}-${servicio.fecha}.pdf`.replace(/\s+/g, '_'))
      if (!compartido) notify({ variant: 'info', title: 'PDF descargado', text: 'Adjúntalo en WhatsApp desde tus descargas.' })
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo generar el PDF', text: e instanceof Error ? e.message : '' })
    } finally { setGenerando(false) }
  }

  const fecha = (iso?: string | null) => iso ? new Date(iso).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' }) : null

  return (
    <ModalPortal>
      <div role="dialog" aria-modal="true" aria-label="Evidencia del servicio" onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: 16 }}>
        <div onClick={e => e.stopPropagation()}
          style={{ background: 'var(--at-surface)', borderRadius: 12, padding: 20, width: '100%', maxWidth: 760, margin: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 15 }}>📋 Evidencia · {tipoLabel}</h3>
              <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 4, lineHeight: 1.6 }}>
                {servicio.unidad_nombre ?? 'Sin unidad específica'} · {servicio.fecha} · {estadoLabel}<br />
                {servicio.responsable && <>Responsable: {servicio.responsable}<br /></>}
                {servicio.iniciado_por && <>Iniciado por <b>{nombre(servicio.iniciado_por)}</b> ({fecha(servicio.iniciado_en)})<br /></>}
                {servicio.completado_por && <>Completado por <b>{nombre(servicio.completado_por)}</b> ({fecha(servicio.completado_en)})</>}
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Cerrar" style={{ ...btn, alignSelf: 'flex-start' }}>✕</button>
          </div>

          <h4 style={{ margin: '14px 0 4px', fontSize: 13 }}>1 · Estado al ingresar y eventualidades</h4>
          <textarea style={area} value={hallazgos} readOnly={!canEdit} onChange={e => setHallazgos(e.target.value)}
            placeholder="Ej.: vaso roto en cocina, mancha en sofá, aire acondicionado sin control…" />
          <FaseFotos titulo="Fotos al ingresar" ayuda="de 15 a 20 recomendadas" fase="ingreso" fotos={fotos} canEdit={canEdit}
            subiendo={subiendo} onAgregar={agregar} onEliminar={eliminar} onVer={setVisor} />

          <h4 style={{ margin: '18px 0 4px', fontSize: 13 }}>2 · Resultado de la limpieza</h4>
          <textarea style={area} value={cierre} readOnly={!canEdit} onChange={e => setCierre(e.target.value)}
            placeholder="Cómo quedó la unidad, pendientes, faltantes…" />
          <FaseFotos titulo="Fotos al terminar" ayuda="de 15 a 20 recomendadas" fase="cierre" fotos={fotos} canEdit={canEdit}
            subiendo={subiendo} onAgregar={agregar} onEliminar={eliminar} onVer={setVisor} />

          <p style={{ fontSize: 11, color: 'var(--at-ink-3)', margin: '14px 0 0' }}>
            Las fotos se eliminan automáticamente a los 90 días para no saturar el servidor; las observaciones y quién realizó el servicio se conservan.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14, flexWrap: 'wrap' }}>
            <button type="button" style={btn} onClick={compartir} disabled={generando}>
              {generando ? 'Generando PDF…' : '📄 PDF / WhatsApp'}
            </button>
            {canEdit && (
              <button type="button" onClick={guardarTexto} disabled={guardando || !sucio}
                style={{ ...btn, background: 'var(--at-primary)', color: 'white', border: 'none', opacity: guardando || !sucio ? 0.6 : 1 }}>
                {guardando ? 'Guardando…' : 'Guardar observaciones'}
              </button>
            )}
          </div>
        </div>
      </div>

      {visor && (
        <div role="dialog" aria-modal="true" aria-label="Foto" onClick={() => setVisor(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, cursor: 'zoom-out' }}>
          <SecureImage src={visor} bucket={BUCKET_HOUSEKEEPING} alt="" style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 8 }} />
        </div>
      )}
    </ModalPortal>
  )
}
