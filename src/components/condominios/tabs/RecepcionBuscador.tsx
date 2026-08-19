import { useMemo, useState } from 'react'
import {
  construirBandejaRecepcion, buscarEnRecepcion, duplicadosPorGuia,
  type ItemRecepcion, type OrigenRecepcion,
} from '../../../domain/condominios/recepcion'
import type { PiezaRecepcion } from '../../../types'

interface Props {
  /** Todas las piezas en custodia: la tabla es una sola, la bandeja también. */
  piezas: PiezaRecepcion[]
  /** Permiso de ver cada clase: sin él, sus filas no entran a la bandeja. */
  puedeVerPaqueteria: boolean
  puedeVerCorrespondencia: boolean
  /** Módulo desde el que se abrió la bandeja (no se ofrece "ir" hacia sí mismo). */
  origenActual: OrigenRecepcion
  onIrATab?: (tab: 'paqueteria' | 'correspondencia') => void
}

const ORIGEN_LABEL: Record<OrigenRecepcion, string> = {
  paquete: 'Paquetería',
  correspondencia: 'Correspondencia',
}

function fechaCorta(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('es', { day: '2-digit', month: 'short', year: '2-digit' })
}

const chipBase = {
  padding: '6px 12px', borderRadius: '20px', fontSize: '12.5px', fontWeight: 600,
  cursor: 'pointer', border: '1.5px solid',
} as const

function Chip({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      ...chipBase,
      borderColor: activo ? 'var(--at-primary)' : 'var(--at-line)',
      background: activo ? 'var(--at-primary-tint)' : 'var(--at-surface)',
      color: activo ? 'var(--at-primary)' : 'var(--at-ink-3)',
    }}>{children}</button>
  )
}

/**
 * Bandeja unificada de recepción: busca a la vez en Paquetería y en
 * Correspondencia.
 *
 * POR QUÉ existe: las dos pestañas guardan el mismo tipo de pieza en tablas
 * distintas, así que "¿llegó la guía #A1234?" obligaba a buscar dos veces y
 * adivinar dónde la registró el turno anterior. Aquí se busca una sola vez, y
 * además se avisa cuando la misma guía aparece en los dos módulos (registro
 * duplicado, que antes nadie detectaba).
 *
 * Es de solo lectura a propósito: cada módulo conserva su flujo de entrega,
 * firma y estados. Esta vista busca y manda al lugar correcto.
 */
export function RecepcionBuscador({
  piezas, puedeVerPaqueteria, puedeVerCorrespondencia, origenActual, onIrATab,
}: Props) {
  const [consulta, setConsulta] = useState('')
  const [filtroOrigen, setFiltroOrigen] = useState<'todos' | OrigenRecepcion>('todos')
  const [soloPendientes, setSoloPendientes] = useState(false)

  const bandeja = useMemo(() => construirBandejaRecepcion({
    piezas,
    incluirPaqueteria: puedeVerPaqueteria,
    incluirCorrespondencia: puedeVerCorrespondencia,
  }), [piezas, puedeVerPaqueteria, puedeVerCorrespondencia])

  const duplicados = useMemo(() => duplicadosPorGuia(bandeja), [bandeja])

  const resultados = useMemo(() => {
    let items = buscarEnRecepcion(bandeja, consulta)
    if (filtroOrigen !== 'todos') items = items.filter(i => i.origen === filtroOrigen)
    if (soloPendientes) items = items.filter(i => !i.cerrado)
    return items
  }, [bandeja, consulta, filtroOrigen, soloPendientes])

  const pendientes = bandeja.filter(i => !i.cerrado).length
  const ambosVisibles = puedeVerPaqueteria && puedeVerCorrespondencia

  return (
    <div>
      <p style={{ margin: '0 0 14px', color: 'var(--at-ink-3)', fontSize: '13.5px' }}>
        {bandeja.length} piezas en recepción · <span style={{ color: 'var(--at-primary)', fontWeight: 600 }}>{pendientes} pendientes</span>
        {ambosVisibles && ' · busca a la vez en Paquetería y Correspondencia'}
      </p>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
        <input
          value={consulta}
          onChange={e => setConsulta(e.target.value)}
          placeholder="Buscar por guía, remitente, destinatario, unidad, asunto..."
          style={{ flex: 1, minWidth: '220px', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '13.5px', background: 'var(--at-surface-2)' }}
        />
        {ambosVisibles && (
          <>
            <Chip activo={filtroOrigen === 'todos'} onClick={() => setFiltroOrigen('todos')}>Todo</Chip>
            <Chip activo={filtroOrigen === 'paquete'} onClick={() => setFiltroOrigen('paquete')}>📦 Paquetería</Chip>
            <Chip activo={filtroOrigen === 'correspondencia'} onClick={() => setFiltroOrigen('correspondencia')}>📬 Correspondencia</Chip>
          </>
        )}
        <Chip activo={soloPendientes} onClick={() => setSoloPendientes(v => !v)}>Solo pendientes</Chip>
      </div>

      {duplicados.length > 0 && (
        <div style={{ background: 'var(--at-warning-tint)', border: '1.5px solid var(--at-warning-border)', borderRadius: '10px', padding: '12px 14px', marginBottom: '14px' }}>
          <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--at-warning-strong)' }}>
            ⚠ {duplicados.length} {duplicados.length === 1 ? 'guía registrada' : 'guías registradas'} en los dos módulos
          </div>
          <div style={{ fontSize: '12px', color: 'var(--at-ink-2)', marginTop: '4px' }}>
            {duplicados.slice(0, 4).map(g => `#${g[0].guia}`).join(', ')}
            {duplicados.length > 4 && ` y ${duplicados.length - 4} más`}
            {' — la misma pieza quedó anotada en Paquetería y en Correspondencia.'}
          </div>
        </div>
      )}

      {resultados.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '44px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '38px', marginBottom: '10px' }}>🔎</div>
          <p style={{ fontWeight: 600 }}>{consulta ? 'Sin coincidencias' : 'No hay piezas registradas'}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {resultados.map(item => <Fila key={`${item.origen}:${item.id}`} item={item} origenActual={origenActual} onIrATab={onIrATab} />)}
        </div>
      )}
    </div>
  )
}

function Fila({ item, origenActual, onIrATab }: { item: ItemRecepcion; origenActual: OrigenRecepcion; onIrATab?: (tab: 'paqueteria' | 'correspondencia') => void }) {
  return (
    <div style={{
      background: 'var(--at-surface)',
      border: `1.5px solid ${item.cerrado ? 'var(--at-line)' : 'var(--at-primary-soft-2)'}`,
      borderRadius: '12px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '14px',
    }}>
      <div style={{ fontSize: '24px', flexShrink: 0 }}>{item.icono}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>{item.titulo}</span>
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)', background: 'var(--at-chip)', borderRadius: '20px', padding: '2px 9px' }}>
            {item.clase}
          </span>
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)' }}>
            {item.direccion === 'entrada' ? '📥 Entrada' : '📤 Salida'}
          </span>
          {item.urgente && <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--at-danger)' }}>URGENTE</span>}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '3px' }}>
          {item.unidadNombre && <span>📍 {item.unidadNombre}</span>}
          {item.remitente && <span>· De: {item.remitente}</span>}
          {item.destinatario && <span>· Para: {item.destinatario}</span>}
          {item.mensajeria && <span>· {item.mensajeria}</span>}
          {item.guia && <span>· #{item.guia}</span>}
        </div>
        <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', marginTop: '3px' }}>
          {fechaCorta(item.fecha)}
          {item.fechaEntrega && ` · Entregado ${fechaCorta(item.fechaEntrega)}`}
          {item.conFirma && ' · ✍ con firma'}
          {item.fotos > 0 && ` · 📷 ${item.fotos}`}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', flexShrink: 0 }}>
        <span style={{
          padding: '3px 10px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 700,
          background: item.cerrado ? 'var(--at-success-tint)' : 'var(--at-primary-tint)',
          color: item.cerrado ? 'var(--at-success)' : 'var(--at-primary)',
        }}>{item.estadoLabel}</span>
        <span style={{ fontSize: '11px', color: 'var(--at-ink-3)', fontWeight: 600 }}>{ORIGEN_LABEL[item.origen]}</span>
        {onIrATab && item.origen !== origenActual && (
          <button onClick={() => onIrATab(item.tabId)}
            style={{ padding: '4px 10px', background: 'var(--at-surface-2)', color: 'var(--at-ink-2)', border: '1px solid var(--at-line)', borderRadius: '8px', cursor: 'pointer', fontSize: '11.5px', fontWeight: 600 }}>
            Abrir {ORIGEN_LABEL[item.origen]} →
          </button>
        )}
      </div>
    </div>
  )
}
