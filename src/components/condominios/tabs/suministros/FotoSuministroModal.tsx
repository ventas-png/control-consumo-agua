import { useRef, useState } from 'react'
import { EditModal } from '../../../shared/EditModal'
import { ImageUploader } from '../../../shared/ImageUploader'
import { SecureImage } from '../../../shared/SecureImage'
import { removeCondominiosMedia } from '../../../../domain/shared/storage'

interface Props {
  nombre: string
  /** La foto con la que se abre la ventana (ruta en `condominios-media`) o null. */
  valor: string | null
  /** Sin permiso de edición la ventana sólo muestra la foto en grande. */
  editable: boolean
  /** Texto del botón que confirma: «Guardar foto» si persiste ya, otro si la recoge un formulario. */
  accion?: string
  /**
   * Recibe la foto elegida (o null si se quitó). Devuelve si quedó aceptada; con
   * `false` la ventana sigue abierta para reintentar. Borrar del bucket la foto
   * que se reemplazó le toca al que llama: sólo él sabe cuándo la fila deja de
   * apuntarle.
   */
  onGuardar: (foto: string | null) => Promise<boolean> | boolean
  onClose: () => void
}

/**
 * Ventana para ver, agregar, cambiar o quitar la foto de un insumo. Quitar no
 * borra nada del bucket mientras no se confirme: la fila todavía apunta a esa
 * foto. Lo que se sube aquí y no se confirma no lo referencia ninguna fila, así
 * que se borra al salir.
 */
export function FotoSuministroModal({ nombre, valor, editable, accion = 'Guardar foto', onGuardar, onClose }: Props) {
  const [foto, setFoto] = useState<string | null>(valor)
  const [subiendo, setSubiendo] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const subidasRef = useRef<Set<string>>(new Set())

  function descartarSubidas(salvo: string | null) {
    const huerfanas = [...subidasRef.current].filter(p => p !== salvo)
    subidasRef.current.clear()
    if (huerfanas.length > 0) void removeCondominiosMedia(huerfanas)
  }

  function cerrar() {
    if (subiendo || guardando) return
    descartarSubidas(null)
    onClose()
  }

  async function confirmar() {
    setGuardando(true)
    let ok = false
    try { ok = await onGuardar(foto) } finally { setGuardando(false) }
    if (!ok) return
    descartarSubidas(foto)
    onClose()
  }

  const ocupado = subiendo || guardando
  const sinCambios = foto === valor
  const btn = { padding: '8px 16px', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 } as const

  return (
    <EditModal
      title="Foto del insumo"
      subtitle={nombre}
      size="sm"
      onClose={cerrar}
      closeOnBackdropClick={!ocupado}
      closeOnEscape={!ocupado}
      footer={editable ? (
        <>
          <button type="button" onClick={cerrar} disabled={ocupado}
            style={{ ...btn, background: 'var(--at-chip)', color: 'var(--at-ink-2)' }}>
            Cancelar
          </button>
          <button type="button" onClick={() => void confirmar()} disabled={ocupado || sinCambios}
            style={{ ...btn, padding: '8px 20px', background: 'var(--at-success)', color: 'var(--at-on-status)', opacity: ocupado || sinCambios ? 0.6 : 1, cursor: ocupado || sinCambios ? 'default' : 'pointer' }}>
            {guardando ? 'Guardando…' : subiendo ? 'Subiendo foto…' : `✅ ${accion}`}
          </button>
        </>
      ) : (
        <button type="button" onClick={onClose} style={{ ...btn, background: 'var(--at-chip)', color: 'var(--at-ink-2)' }}>Cerrar</button>
      )}
    >
      {editable ? (
        <>
          <ImageUploader
            value={foto}
            onChange={p => { if (p) subidasRef.current.add(p); setFoto(p) }}
            folder="suministros"
            label={foto ? 'Para cambiarla, quítala con la ✕ y sube otra' : 'Toma una foto o elige una imagen (máx. 5 MB)'}
            borrarAlQuitar={false}
            onSubiendo={setSubiendo}
          />
          {valor && !foto && (
            <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 8 }}>
              La foto actual se quita al pulsar «{accion}».
            </div>
          )}
        </>
      ) : valor ? (
        <SecureImage src={valor} alt={`Foto de ${nombre}`}
          placeholder={<div style={{ fontSize: 13, color: 'var(--at-ink-3)', textAlign: 'center', padding: 24 }}>Cargando foto…</div>}
          style={{ width: '100%', maxHeight: '65vh', objectFit: 'contain', borderRadius: 10, display: 'block' }} />
      ) : (
        <div style={{ fontSize: 13, color: 'var(--at-ink-3)', textAlign: 'center', padding: 24 }}>Este insumo no tiene foto.</div>
      )}
    </EditModal>
  )
}
