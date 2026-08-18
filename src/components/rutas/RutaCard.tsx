// Card de una ruta en la lista (P1 #3, extraída de RutasSection con el JSX
// intacto). Estado y handlers viven en la sección (vía ctx).
import type { Ruta } from '../../types'
import type { RutasCtx } from './ctx'
import { describirRecurrencia, estadoRuta } from '../../lib/rutasReglas'
import { formatFechaCalendario } from '../../lib/format'

export function RutaCard({ ruta, ctx }: { ruta: Ruta; ctx: RutasCtx }) {
  const {
    clientes, contadores, unidades, proyectos, canEdit, canDelete, hoy,
    recordandoId, onEjecutarRuta, handleRecordarAhora, abrirEditar, handleEliminar,
  } = ctx

  const estado = estadoRuta(ruta, hoy)
  const tipo = ruta.tipo_ruta ?? 'clientes'
  const tipoLabel = tipo === 'contadores' ? 'Por contador' : tipo === 'unidades' ? 'Por unidad' : 'Por cliente'
  const itemCount = tipo === 'contadores'
    ? (ruta.contador_ids ?? []).length
    : tipo === 'unidades'
    ? (ruta.unidad_ids ?? []).length
    : (ruta.cliente_ids ?? []).length
  const itemLabel = tipo === 'contadores' ? 'contador' : tipo === 'unidades' ? 'unidad' : 'cliente'
  const proyectoNombre = ruta.project_id ? proyectos.find(p => p.id === ruta.project_id)?.nombre : null
  const preview = tipo === 'contadores'
    ? (ruta.contador_ids ?? []).slice(0, 4).map(id => contadores.find(c => c.id === id)?.numero_serie ?? '?')
    : tipo === 'unidades'
    ? (ruta.unidad_ids ?? []).slice(0, 4).map(id => unidades.find(u => u.id === id)?.nombre ?? '?')
    : (ruta.cliente_ids ?? []).slice(0, 4).map(id => clientes.find(c => c.id === id)?.nombre ?? '?')

  return (
    <div
      style={{ background: 'var(--at-surface)', borderRadius: '16px', padding: '20px', boxShadow: '0 4px 20px rgba(0,0,0,0.06)', border: '1px solid var(--at-line)' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '16px', marginBottom: '2px' }}>{ruta.nombre}</div>
          <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginBottom: '2px' }}>{tipoLabel}{proyectoNombre ? ` · ${proyectoNombre}` : ''}</div>
          {ruta.descripcion && (
            <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>{ruta.descripcion}</div>
          )}
        </div>
        <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: estado.bg, color: estado.color, whiteSpace: 'nowrap' }}>
          {estado.label}
        </span>
      </div>

      <div style={{ fontSize: '13px', color: 'var(--at-ink-2)', marginBottom: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div>🔁 {describirRecurrencia(ruta)}</div>
        <div>📅 {ruta.fecha_programada ? formatFechaCalendario(ruta.fecha_programada, {}, 'es-GT', '—') : ((ruta.frecuencia ?? 'unica') !== 'unica' ? 'Recurrente' : 'Sin fecha')}</div>
        <div>👤 {ruta.asignado_nombre ?? 'Sin asignar'}</div>
        <div>📍 {itemCount} {itemLabel}{itemCount !== 1 ? 's' : ''}</div>
      </div>

      {preview.length > 0 && (
        <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginBottom: '14px', lineHeight: '1.6' }}>
          {preview.join(' → ')}
          {itemCount > 4 && ` → +${itemCount - 4} más`}
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {!ruta.completada && (
          <button
            onClick={() => onEjecutarRuta(ruta)}
            style={{ padding: '8px 14px', background: 'linear-gradient(135deg, var(--at-success) 0%, var(--at-success-strong) 100%)', color: 'var(--at-on-status)', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}
          >
            ▶ Ejecutar
          </button>
        )}
        {canEdit && (
          <>
            <button
              onClick={() => handleRecordarAhora(ruta)}
              disabled={recordandoId === ruta.id}
              title="Enviar recordatorio al operador y administradores"
              style={{ padding: '8px 14px', background: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', border: '1px solid var(--at-primary-soft-2)', borderRadius: '8px', fontWeight: 600, cursor: recordandoId === ruta.id ? 'wait' : 'pointer', fontSize: '13px' }}
            >
              {recordandoId === ruta.id ? 'Enviando…' : '🔔 Recordar'}
            </button>
            <button
              onClick={() => abrirEditar(ruta)}
              style={{ padding: '8px 14px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}
            >
              Editar
            </button>
          </>
        )}
        {canDelete && (
          <button
            onClick={() => handleEliminar(ruta)}
            style={{ padding: '8px 14px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: '1px solid var(--at-danger-border)', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}
          >
            Eliminar
          </button>
        )}
      </div>
    </div>
  )
}
