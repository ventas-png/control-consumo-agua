// Piezas compartidas por la lista, el detalle y el asistente de minutas:
// catálogos de categoría/prioridad, estilos de formulario y el avatar con
// iniciales que identifica a cada participante por su tipo.
import type { CSSProperties, ReactNode } from 'react'
import type { CategoriaNota, ParticipanteMinuta, PrioridadNota, TipoParticipanteMinuta } from '../../../../types'
import { TIPO_PARTICIPANTE_INFO, iniciales } from '../../../../domain/condominios/minutas'

export const CATEGORIAS: { value: CategoriaNota; label: string; icon: string; color: string }[] = [
  { value: 'reunion',      label: 'Reunión',      icon: '👥', color: 'var(--at-success)' },
  { value: 'seguimiento',  label: 'Seguimiento',  icon: '🔄', color: 'var(--at-accent)' },
  { value: 'urgente',      label: 'Urgente',      icon: '🚨', color: 'var(--at-danger)' },
  { value: 'recordatorio', label: 'Recordatorio', icon: '⏰', color: 'var(--at-warning)' },
  { value: 'general',      label: 'General',      icon: '📝', color: 'var(--at-ink-3)' },
  { value: 'otro',         label: 'Otro',         icon: '📌', color: 'var(--at-accent-2)' },
]

export const PRIORIDADES: { value: PrioridadNota; label: string; color: string; bg: string }[] = [
  { value: 'normal',  label: 'Normal',  color: 'var(--at-ink-3)',   bg: 'var(--at-chip)' },
  { value: 'alta',    label: 'Alta',    color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
  { value: 'urgente', label: 'Urgente', color: 'var(--at-danger)',  bg: 'var(--at-danger-tint)' },
]

/** Con un valor desconocido (fila vieja, prueba) se cae a «General» / «Normal». */
export const categoriaInfo = (v: string | null | undefined) => CATEGORIAS.find(c => c.value === v) ?? CATEGORIAS[4]
export const prioridadInfo = (v: string | null | undefined) => PRIORIDADES.find(p => p.value === v) ?? PRIORIDADES[0]

/** Campo a todo el ancho de su columna. `minWidth: 0` impide que el ancho intrínseco del control ensanche la cuadrícula. */
export const inp: CSSProperties = {
  width: '100%', minWidth: 0, maxWidth: '100%', padding: '9px 11px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 14,
  background: 'var(--at-surface)', color: 'var(--at-ink)', boxSizing: 'border-box', fontFamily: 'inherit', minHeight: 40,
}
export const lbl: CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--at-ink-2)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em',
}
/** Botón de icono (quitar, cerrar) con área táctil suficiente. */
export const btnIcono: CSSProperties = {
  border: 'none', background: 'transparent', color: 'var(--at-ink-3)', cursor: 'pointer', fontSize: 16, lineHeight: 1,
  minWidth: 36, minHeight: 36, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
}

export const TIPO_COLOR: Record<TipoParticipanteMinuta, { bg: string; fg: string }> = {
  empleado:  { bg: 'var(--at-primary-tint)', fg: 'var(--at-primary)' },
  residente: { bg: 'var(--at-accent-tint)',  fg: 'var(--at-accent)' },
  proveedor: { bg: 'var(--at-info-tint)',    fg: 'var(--at-info)' },
  otro:      { bg: 'var(--at-chip)',         fg: 'var(--at-ink-2)' },
}

export function Avatar({ nombre, tipo, size = 30, title }: { nombre: string; tipo: TipoParticipanteMinuta; size?: number; title?: string }) {
  const c = TIPO_COLOR[tipo] ?? TIPO_COLOR.otro
  return (
    <span aria-hidden="true" title={title ?? nombre} style={{
      width: size, height: size, borderRadius: '50%', background: c.bg, color: c.fg, display: 'inline-flex', alignItems: 'center',
      justifyContent: 'center', fontSize: Math.round(size * 0.38), fontWeight: 800, flexShrink: 0, letterSpacing: '0.02em',
      border: '2px solid var(--at-surface)', boxSizing: 'border-box',
    }}>{iniciales(nombre)}</span>
  )
}

/** Pila de avatares (hasta `max`) con «+N» para los que no caben. */
export function AvataresApilados({ participantes, max = 4 }: { participantes: readonly ParticipanteMinuta[]; max?: number }) {
  const visibles = participantes.slice(0, max)
  const resto = participantes.length - visibles.length
  return (
    <span role="img" style={{ display: 'inline-flex', alignItems: 'center' }} aria-label={`${participantes.length} participante${participantes.length === 1 ? '' : 's'}`}>
      {visibles.map((p, i) => (
        <span key={p.id} style={{ marginLeft: i === 0 ? 0 : -8, display: 'inline-flex' }}>
          <Avatar nombre={p.nombre} tipo={p.tipo} size={26} title={`${p.nombre}${p.detalle ? ` · ${p.detalle}` : ''}`} />
        </span>
      ))}
      {resto > 0 && (
        <span style={{ marginLeft: -8, width: 26, height: 26, borderRadius: '50%', background: 'var(--at-chip)', color: 'var(--at-ink-2)', fontSize: 10, fontWeight: 700,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '2px solid var(--at-surface)', boxSizing: 'border-box' }}>+{resto}</span>
      )}
    </span>
  )
}

export function ChipTipo({ tipo }: { tipo: TipoParticipanteMinuta }) {
  const info = TIPO_PARTICIPANTE_INFO[tipo] ?? TIPO_PARTICIPANTE_INFO.otro
  const c = TIPO_COLOR[tipo] ?? TIPO_COLOR.otro
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: c.bg, color: c.fg, whiteSpace: 'nowrap' }}>
      {info.icon} {info.label}
    </span>
  )
}

/** Tarjeta de participante: avatar, nombre, detalle, tipo y la marca de quien gestiona. */
export function ParticipanteCard({ p, acciones }: { p: ParticipanteMinuta; acciones?: ReactNode }) {
  return (
    <div className="minuta-part" style={{ border: `1px solid ${p.gestiona ? 'var(--at-primary-mint)' : 'var(--at-line)'}` }}>
      <Avatar nombre={p.nombre} tipo={p.tipo} size={34} />
      <div className="minuta-part-cuerpo">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--at-ink)', overflowWrap: 'anywhere' }}>{p.nombre}</span>
          {p.gestiona && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: 'var(--at-primary)', color: '#fff', whiteSpace: 'nowrap' }}>★ Gestiona</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
          <ChipTipo tipo={p.tipo} />
          {p.detalle && <span style={{ fontSize: 12, color: 'var(--at-ink-3)', overflowWrap: 'anywhere' }}>{p.detalle}</span>}
        </div>
      </div>
      {acciones && <div className="minuta-part-acc">{acciones}</div>}
    </div>
  )
}

/** Barra de avance de compromisos cumplidos. */
export function BarraAvance({ cumplidos, total, alto = 6 }: { cumplidos: number; total: number; alto?: number }) {
  if (total === 0) return null
  const pct = Math.round((cumplidos / total) * 100)
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={cumplidos} aria-label={`${cumplidos} de ${total} compromisos cumplidos`}
      style={{ height: alto, borderRadius: 999, background: 'var(--at-chip)', overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? 'var(--at-success)' : 'var(--at-primary-mint-2)', transition: 'width .18s ease' }} />
    </div>
  )
}
