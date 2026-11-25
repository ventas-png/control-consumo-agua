import { useRef, useState } from 'react'
import { EditModal } from '../../../shared/EditModal'
import { MultiImageUploader } from '../../../shared/ImageUploader'
import { ImageGallery } from '../../../shared/ImageGallery'
import { removeCondominiosMedia } from '../../../../domain/shared/storage'
import { MAX_FOTOS_SUMINISTRO } from '../../../../lib/suministros'

interface Props {
  nombre: string
  /** Las fotos con las que se abre la ventana (rutas en `condominios-media`). */
  valores: string[]
  /** Sin permiso de edición la ventana sólo muestra las fotos. */
  editable: boolean
  /** Texto del botón que confirma: «Guardar fotos» si persiste ya, otro si las recoge un formulario. */
  accion?: string
  /**
   * Recibe la lista elegida. Devuelve si quedó aceptada; con `false` la
   * ventana sigue abierta para reintentar. Borrar del bucket las fotos que la
   * fila deja de nombrar le toca al que llama: sólo él sabe cuándo la fila deja
   * de apuntarles.
   */
  onGuardar: (fotos: string[]) => Promise<boolean> | boolean
  onClose: () => void
}

/**
 * Ventana para ver, agregar o quitar las fotos de un insumo (hasta 6). Quitar
 * no borra nada del bucket mientras no se confirme: la fila todavía apunta a
 * esas fotos. Lo que se sube aquí y no queda en la lista confirmada no lo
 * referencia ninguna fila, así que se borra al salir.
 *
 * Es la versión de varias fotos de FotoSuministroModal, que Equipos sigue
 * usando para su única foto.
 */
export function FotosSuministroModal({ nombre, valores, editable, accion = 'Guardar fotos', onGuardar, onClose }: Props) {
  const [fotos, setFotos] = useState<string[]>(valores)
  /** Subidas en curso: cuenta, no booleano, para que la primera que termina no habilite Guardar. */
  const [subiendo, setSubiendo] = useState(0)
  const [guardando, setGuardando] = useState(false)
  /** Lo que se subió en ESTA ventana (no estaba al abrirla). */
  const subidasRef = useRef<Set<string>>(new Set())

  function descartarSubidas(salvo: readonly string[]) {
    const huerfanas = [...subidasRef.current].filter(p => !salvo.includes(p))
    subidasRef.current.clear()
    if (huerfanas.length > 0) void removeCondominiosMedia(huerfanas)
  }

  function cambiar(rutas: string[]) {
    for (const r of rutas) if (!valores.includes(r)) subidasRef.current.add(r)
    setFotos(rutas)
  }

  const ocupado = subiendo > 0 || guardando

  function cerrar() {
    if (ocupado) return
    descartarSubidas([])
    onClose()
  }

  async function confirmar() {
    setGuardando(true)
    let ok = false
    try { ok = await onGuardar(fotos) } finally { setGuardando(false) }
    if (!ok) return
    descartarSubidas(fotos)
    onClose()
  }

  const sinCambios = fotos.length === valores.length && fotos.every((f, i) => f === valores[i])
  const quitadas = valores.filter(v => !fotos.includes(v)).length
  const btn = { padding: '8px 16px', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 } as const

  return (
    <EditModal
      title="Fotos del insumo"
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
            {guardando ? 'Guardando…' : subiendo > 0 ? 'Subiendo foto…' : `✅ ${accion}`}
          </button>
        </>
      ) : (
        <button type="button" onClick={onClose} style={{ ...btn, background: 'var(--at-chip)', color: 'var(--at-ink-2)' }}>Cerrar</button>
      )}
    >
      {editable ? (
        <>
          <MultiImageUploader
            values={fotos}
            onChange={cambiar}
            folder="suministros"
            label="Fotos"
            maxFiles={MAX_FOTOS_SUMINISTRO}
            borrarAlQuitar={false}
            onSubiendo={s => setSubiendo(n => Math.max(0, n + (s ? 1 : -1)))}
          />
          <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 8 }}>
            Toma fotos o elige imágenes (máx. 5 MB cada una): el envase, la etiqueta, la ficha de seguridad…
          </div>
          {quitadas > 0 && (
            <div style={{ fontSize: 12, color: 'var(--at-ink-3)', marginTop: 4 }}>
              {quitadas === 1 ? 'La foto quitada se borra' : `Las ${quitadas} fotos quitadas se borran`} al pulsar «{accion}».
            </div>
          )}
        </>
      ) : valores.length > 0 ? (
        <ImageGallery urls={valores} maxVisible={MAX_FOTOS_SUMINISTRO} />
      ) : (
        <div style={{ fontSize: 13, color: 'var(--at-ink-3)', textAlign: 'center', padding: 24 }}>Este insumo no tiene fotos.</div>
      )}
    </EditModal>
  )
}
