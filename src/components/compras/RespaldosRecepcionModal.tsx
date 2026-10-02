// Evidencia de una recepción: entrega (bienes) o conformidad (servicio).
//
// El bucket es privado: cada archivo se abre con un enlace firmado y corto. Es SOLO-AÑADIR en
// cuanto la recepción sale de borrador: no se edita ni se retira una evidencia de una recepción
// registrada (se añade otra), y cambiar un adjunto nunca altera la recepción ni su asiento. Lo
// que se ve aquí lo decide el servidor (permiso, empresa y proyecto); la pantalla no lo adivina.
import { useRef, useState } from 'react'
import { EditModal } from '../shared'
import { StatusBadge } from '../shared/StatusBadge'
import { confirm, notify } from '../shared/Dialog'
import { useRespaldosRecepcionQuery } from '../../domain/compras/queries'
import {
  MAX_BYTES_RESPALDO,
  MIME_RESPALDO,
  urlRespaldoRecepcion,
  useAdjuntarRespaldoMutation,
  useRetirarRespaldoMutation,
  validarArchivoRespaldo,
} from '../../domain/compras/respaldos'
import type { RecepcionRespaldo, TipoRespaldoRecepcion } from '../../types/compras'
import { Campo, btnLink, btnPrimario, btnSecundario, input } from '../contabilidad/ui'

const TIPO_LABEL: Record<TipoRespaldoRecepcion, string> = {
  entrega: 'Entrega', conformidad: 'Conformidad de servicio', otro: 'Otro',
}

export function tamanoLegible(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

interface Props {
  companyId: string
  projectId: string | null
  recepcion: { id: string; numero: string | null; tipo: 'bienes' | 'servicio'; estado: 'borrador' | 'registrada' | 'anulada' }
  /** Puede capturar (subir): el servidor lo vuelve a comprobar. */
  puedeAdjuntar: boolean
  onClose: () => void
}

export function RespaldosRecepcionModal({ companyId, projectId, recepcion, puedeAdjuntar, onClose }: Props) {
  const { data: respaldos = [], isLoading, isError, error } = useRespaldosRecepcionQuery(recepcion.id)
  const adjuntar = useAdjuntarRespaldoMutation()
  const retirar = useRetirarRespaldoMutation()
  const [tipo, setTipo] = useState<TipoRespaldoRecepcion>(recepcion.tipo === 'servicio' ? 'conformidad' : 'entrega')
  const [notas, setNotas] = useState('')
  const [archivo, setArchivo] = useState<File | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const borrador = recepcion.estado === 'borrador'

  async function ver(r: RecepcionRespaldo) {
    try {
      window.open(await urlRespaldoRecepcion(r.ruta), '_blank', 'noopener,noreferrer')
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo abrir', text: e instanceof Error ? e.message : 'Error inesperado.' })
    }
  }

  async function subir() {
    if (!archivo) return
    const problema = validarArchivoRespaldo(archivo)
    if (problema) {
      notify({ variant: 'warning', title: 'Atención', text: problema })
      return
    }
    try {
      const r = await adjuntar.mutateAsync({ companyId, projectId, recepcionId: recepcion.id, archivo, tipo, notas: notas.trim() || null })
      notify({ variant: 'success', title: 'Listo', text: r.reutilizado ? 'Ese archivo ya estaba adjunto.' : 'Archivo adjuntado.' })
      setArchivo(null)
      setNotas('')
      if (inputRef.current) inputRef.current.value = ''
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo adjuntar', text: e instanceof Error ? e.message : 'Error inesperado.' })
    }
  }

  async function quitar(r: RecepcionRespaldo) {
    const ok = await confirm({
      title: 'Retirar archivo',
      text: `«${r.nombre}» se quita de la recepción (sigue en borrador). Una vez registrada, la evidencia ya no se puede retirar.`,
      confirmText: 'Retirar',
    })
    if (!ok) return
    try {
      await retirar.mutateAsync(r)
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo retirar', text: e instanceof Error ? e.message : 'Error inesperado.' })
    }
  }

  return (
    <EditModal
      title={`Respaldos de ${recepcion.numero ?? 'la recepción'}`}
      onClose={onClose}
      size="md"
      footer={<div style={{ display: 'flex', justifyContent: 'flex-end' }}><button onClick={onClose} style={btnSecundario}>Cerrar</button></div>}
    >
      <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--at-ink-soft)' }}>
        {recepcion.tipo === 'servicio'
          ? 'Acta o soporte de la conformidad del servicio.'
          : 'Remisión, foto o documento que acredita lo que llegó.'}{' '}
        {borrador
          ? 'Mientras la recepción es borrador puedes retirar un archivo subido por error.'
          : 'La recepción ya salió de borrador: la evidencia no se edita ni se retira; si falta algo, añade otro archivo. Adjuntar no cambia la recepción ni su asiento.'}
      </p>

      {isLoading && <p style={{ fontSize: 12 }}>Cargando…</p>}
      {isError && <p role="alert" style={{ fontSize: 12, color: 'var(--at-danger)' }}>{error instanceof Error ? error.message : 'No se pudo consultar la evidencia.'}</p>}
      {!isLoading && !isError && respaldos.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--at-ink-soft)' }} data-testid="sin-respaldos">Todavía no hay archivos adjuntos.</p>
      )}
      {respaldos.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }} aria-label="Archivos adjuntos">
          {respaldos.map((r) => (
            <li key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '6px 8px', border: '1px solid var(--at-border)', borderRadius: 8, fontSize: 12 }}>
              <strong style={{ flex: '1 1 160px', overflowWrap: 'anywhere' }}>{r.nombre}</strong>
              <StatusBadge tone="info">{TIPO_LABEL[r.tipo]}</StatusBadge>
              <span style={{ color: 'var(--at-ink-soft)' }}>{tamanoLegible(r.bytes)} · {new Date(r.created_at).toLocaleString('es-GT')}</span>
              <span title={r.sha256} style={{ color: 'var(--at-ink-soft)', fontFamily: 'monospace' }}>SHA-256 {r.sha256.slice(0, 8)}…</span>
              {r.notas && <span style={{ flexBasis: '100%', color: 'var(--at-ink-soft)' }}>{r.notas}</span>}
              <button style={btnLink} onClick={() => void ver(r)}>Ver</button>
              {borrador && puedeAdjuntar && <button style={btnLink} onClick={() => void quitar(r)}>Retirar</button>}
            </li>
          ))}
        </ul>
      )}

      {puedeAdjuntar && recepcion.estado !== 'anulada' && (
        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          <Campo label="Tipo de evidencia">
            <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoRespaldoRecepcion)} style={input} aria-label="Tipo de evidencia">
              {recepcion.tipo === 'servicio'
                ? <option value="conformidad">Conformidad de servicio</option>
                : <option value="entrega">Entrega</option>}
              <option value="otro">Otro</option>
            </select>
          </Campo>
          <Campo label={`Archivo (PDF, JPG, PNG o WEBP, hasta ${MAX_BYTES_RESPALDO / 1024 / 1024} MB)`}>
            <input ref={inputRef} type="file" accept={MIME_RESPALDO.join(',')} aria-label="Archivo de evidencia"
                   onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} style={input} />
          </Campo>
          <div style={{ gridColumn: '1 / -1' }}>
            <Campo label="Notas (opcional)">
              <input value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={500} style={{ ...input, width: '100%' }} aria-label="Notas de la evidencia" />
            </Campo>
          </div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={() => void subir()} disabled={!archivo || adjuntar.isPending} style={btnPrimario}>
              {adjuntar.isPending ? 'Adjuntando…' : 'Adjuntar'}
            </button>
          </div>
        </div>
      )}
    </EditModal>
  )
}
