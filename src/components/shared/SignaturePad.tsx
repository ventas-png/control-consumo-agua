import { useRef, useState, useEffect, type PointerEvent as ReactPointerEvent } from 'react'

interface Props {
  onSave: (file: File) => void
  onCancel?: () => void
  saving?: boolean
  saveLabel?: string
  height?: number
}

// Captura de firma manuscrita sobre un <canvas> (pointer events: mouse, touch y
// lápiz). Exporta un PNG con fondo blanco. Sin dependencias externas.
export function SignaturePad({ onSave, onCancel, saving = false, saveLabel = 'Guardar firma', height = 200 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const [hasDrawn, setHasDrawn] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.max(1, Math.round(rect.width * ratio))
    canvas.height = Math.max(1, Math.round(rect.height * ratio))
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(ratio, ratio)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, rect.height)
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#0f172a'
  }, [])

  function pos(e: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function down(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (saving) return
    e.preventDefault()
    canvasRef.current?.setPointerCapture(e.pointerId)
    drawing.current = true
    last.current = pos(e)
  }

  function move(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    e.preventDefault()
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const p = pos(e)
    const l = last.current ?? p
    ctx.beginPath()
    ctx.moveTo(l.x, l.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    last.current = p
    if (!hasDrawn) setHasDrawn(true)
  }

  function end() {
    drawing.current = false
    last.current = null
  }

  function clear() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const rect = canvas.getBoundingClientRect()
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, rect.height)
    setHasDrawn(false)
  }

  function save() {
    const canvas = canvasRef.current
    if (!canvas || !hasDrawn || saving) return
    canvas.toBlob(blob => {
      if (blob) onSave(new File([blob], 'firma.png', { type: 'image/png' }))
    }, 'image/png')
  }

  const btn = {
    padding: '9px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
    cursor: 'pointer', border: '1.5px solid var(--at-line)',
  } as const

  return (
    <div>
      <canvas
        ref={canvasRef}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
        style={{
          width: '100%', height: `${height}px`, display: 'block',
          border: '2px dashed var(--at-line-strong)', borderRadius: '10px',
          background: '#ffffff', touchAction: 'none', cursor: 'crosshair',
        }}
      />
      <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', margin: '6px 2px 0' }}>
        Firme con el dedo o el mouse dentro del recuadro.
      </div>
      <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
        <button type="button" onClick={save} disabled={!hasDrawn || saving}
          style={{ ...btn, border: 'none', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', opacity: !hasDrawn || saving ? 0.6 : 1 }}>
          {saving ? 'Guardando…' : saveLabel}
        </button>
        <button type="button" onClick={clear} disabled={saving}
          style={{ ...btn, background: 'var(--at-surface)', color: 'var(--at-ink-2)' }}>
          Borrar
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={saving}
            style={{ ...btn, background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none' }}>
            Cancelar
          </button>
        )}
      </div>
    </div>
  )
}
