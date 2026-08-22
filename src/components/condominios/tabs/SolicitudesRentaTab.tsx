import { useState } from 'react'
import { notify } from '../../shared/Dialog'
import { openPromptDialog } from '../../shared/PromptDialog'
import { updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { aprobarSolicitudRenta } from '../../../domain/condominios/solicitudRenta'
import {
  DatosContratoSolicitud, DocumentosSolicitudRenta, documentosDe, tieneDatosContrato,
  ResponsablesServiciosDetalle, EstadoContratoSolicitud,
} from '../SolicitudRentaDetalle'
import type { SolicitudRentaUnidad, TipoRenta, EstadoSolicitudRenta, Unidad } from '../../../types'

interface Props {
  solicitudes: SolicitudRentaUnidad[]
  unidades: Unidad[]
  proyectoId: string
  companyId: string
  moneda?: string
  autorNombre: string
  canEdit: boolean
  onRefresh: () => void
}

const TIPO_LABEL: Record<TipoRenta, string> = {
  arrendamiento: 'Arrendamiento',
  str:           'STR / Corto Plazo',
  ambas:         'Arrendamiento + STR',
}

const ESTADO_CFG: Record<EstadoSolicitudRenta, { label: string; color: string; bg: string; icon: string }> = {
  // El propietario todavía la está llenando en el portal: `sectionData` no la
  // trae, pero el Record debe cubrir el estado.
  borrador:  { label: 'Borrador',  color: 'var(--at-ink-3)', bg: 'var(--at-surface-2)', icon: '📝' },
  pendiente: { label: 'Pendiente', color: 'var(--at-warning)', bg: 'var(--at-warning-tint)', icon: '⏳' },
  aprobada:  { label: 'Aprobada',  color: 'var(--at-success)', bg: 'var(--at-success-tint)', icon: '✅' },
  rechazada: { label: 'Rechazada', color: 'var(--at-danger)', bg: 'var(--at-danger-tint)', icon: '❌' },
  // El PROPIETARIO retiró su solicitud o dio de baja la autorización (RPC
  // portal_baja_renta, 20260827000000). Neutro: no es una decisión del admin.
  baja:      { label: 'Dada de baja', color: 'var(--at-ink-3)', bg: 'var(--at-surface-2)', icon: '🚫' },
}

export function SolicitudesRentaTab({ solicitudes, unidades, moneda = 'Q', autorNombre, canEdit, onRefresh }: Props) {
  const [filtroEstado, setFiltroEstado] = useState<EstadoSolicitudRenta | 'all'>('pendiente')
  const [expandedId, setExpandedId]     = useState<string | null>(null)
  const [tipoAprobado, setTipoAprobado] = useState<TipoRenta>('arrendamiento')
  const [saving, setSaving]             = useState(false)

  const filtered = solicitudes.filter(s =>
    filtroEstado === 'all' || s.estado === filtroEstado
  )

  const pendientes = solicitudes.filter(s => s.estado === 'pendiente').length
  const aprobadas  = solicitudes.filter(s => s.estado === 'aprobada').length
  const rechazadas = solicitudes.filter(s => s.estado === 'rechazada').length

  function unidadNombre(s: SolicitudRentaUnidad) {
    return s.unidad_nombre || unidades.find(u => u.id === s.unidad_id)?.nombre || s.unidad_id.slice(0, 8)
  }

  async function resolver(s: SolicitudRentaUnidad, nuevoEstado: 'aprobada' | 'rechazada') {
    if (!canEdit) return
    const aprobando = nuevoEstado === 'aprobada'
    const esArrendamiento = tipoAprobado === 'arrendamiento' || tipoAprobado === 'ambas'

    // Con arrendamiento el contrato se crea SIEMPRE: es el punto de la feature.
    // La única excepción son las solicitudes heredadas —las que se enviaron
    // antes de que se pidieran los datos— que no traen con qué crearlo. Ahí, y
    // solo ahí, se puede aprobar sin contrato dejando por escrito el porqué.
    const datosCompletos = tieneDatosContrato(s)
    const contratoObligatorio = aprobando && esArrendamiento && datosCompletos && !s.contrato_id
    const puedeOmitirContrato = aprobando && esArrendamiento && !datosCompletos

    const result = await openPromptDialog({
      title: aprobando ? '¿Aprobar solicitud?' : '¿Rechazar solicitud?',
      description: contratoObligatorio
        ? 'Al aprobar se creará el contrato de arrendamiento con los datos enviados. Si la unidad ya tiene un contrato activo, se dará por terminado.'
        : puedeOmitirContrato
          ? 'Esta solicitud no trae los datos del contrato, así que no se puede generar. Indique por qué se autoriza igualmente.'
          : undefined,
      fields: [
        {
          name: 'comentario',
          label: aprobando ? 'Comentario (opcional)' : 'Motivo del rechazo (recomendado)',
          control: 'textarea',
          rows: 4,
          placeholder: 'Escriba un comentario…',
          autoFocus: true,
        },
        ...(puedeOmitirContrato ? [{
          name: 'motivo_sin_contrato',
          label: 'Justificación para aprobar sin crear el contrato',
          control: 'textarea' as const,
          rows: 3,
          required: true,
          placeholder: 'Ej. solicitud antigua; el contrato se registrará a mano.',
        }] : []),
      ],
      submitText: aprobando ? 'Aprobar' : 'Rechazar',
    })
    if (!result) return
    const comentario = result.comentario

    setSaving(true)

    if (aprobando) {
      // Aprobar va por RPC: crea el contrato, copia los seis responsables y
      // cierra el anterior en una sola transacción, cruzando dos permisos RBAC
      // distintos (20260829000300). La identidad de auditoría la toma el
      // servidor de auth.uid(), no se manda desde aquí.
      const { contratoCreado, contratoAnteriorTerminado, error } = await aprobarSolicitudRenta({
        solicitudId: s.id,
        tipoAprobado,
        comentario: comentario || null,
        crearContrato: !puedeOmitirContrato,
        motivoSinContrato: puedeOmitirContrato ? (result.motivo_sin_contrato || null) : null,
      })
      setSaving(false)
      if (error) { notify({ variant: 'error', title: 'No se pudo aprobar', text: error }); return }
      notify({
        variant: 'success',
        title: 'Solicitud aprobada',
        text: contratoCreado
          ? contratoAnteriorTerminado
            ? 'Se creó el contrato y se dio por terminado el anterior de la unidad.'
            : 'Se creó el contrato de arrendamiento con los datos enviados.'
          : 'Se autorizó sin crear contrato; la justificación quedó registrada.',
        duration: 2800,
      })
    } else {
      const { error } = await updateCondominioRow('solicitud_renta_unidad', s.id, {
        estado: 'rechazada',
        comentario_admin: comentario || null,
        aprobado_por: autorNombre || null,
        fecha_resolucion: new Date().toISOString(),
      })
      setSaving(false)
      if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
      notify({ variant: 'success', title: 'Solicitud rechazada', duration: 1400 })
    }

    setExpandedId(null)
    onRefresh()
  }

  const chipStyle = (active: boolean, color: string): React.CSSProperties => ({
    padding: '5px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: 600,
    cursor: 'pointer', border: 'none',
    background: active ? color : 'var(--at-chip)',
    color: active ? 'white' : 'var(--at-ink-3)',
  })

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '20px' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: '17px', fontWeight: 700, color: 'var(--at-ink)' }}>
          🔑 Autorizaciones de Renta
        </h3>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--at-ink-3)' }}>
          Gestiona las solicitudes de los propietarios para operar sus unidades bajo modelos de renta.
        </p>
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {[
          { label: 'Pendientes', count: pendientes, color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' },
          { label: 'Aprobadas',  count: aprobadas,  color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
          { label: 'Rechazadas', count: rechazadas, color: 'var(--at-danger)', bg: 'var(--at-danger-tint)' },
        ].map(k => (
          <div key={k.label} style={{
            background: k.bg, border: `1px solid ${k.color}30`,
            borderRadius: '10px', padding: '12px 20px', minWidth: '110px',
          }}>
            <div style={{ fontSize: '22px', fontWeight: 700, color: k.color }}>{k.count}</div>
            <div style={{ fontSize: '12px', color: k.color, fontWeight: 600 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <button style={chipStyle(filtroEstado === 'all', 'var(--at-ink-3)')} onClick={() => setFiltroEstado('all')}>Todas</button>
        <button style={chipStyle(filtroEstado === 'pendiente', 'var(--at-warning)')} onClick={() => setFiltroEstado('pendiente')}>⏳ Pendientes</button>
        <button style={chipStyle(filtroEstado === 'aprobada', 'var(--at-success)')} onClick={() => setFiltroEstado('aprobada')}>✅ Aprobadas</button>
        <button style={chipStyle(filtroEstado === 'rechazada', 'var(--at-danger)')} onClick={() => setFiltroEstado('rechazada')}>❌ Rechazadas</button>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '36px', marginBottom: '10px' }}>🔑</div>
          <div style={{ fontSize: '14px' }}>No hay solicitudes{filtroEstado !== 'all' ? ` ${filtroEstado}s` : ''}</div>
        </div>
      ) : filtered.map(s => {
        const cfg       = ESTADO_CFG[s.estado]
        const expanded  = expandedId === s.id
        const fecha     = s.created_at ? new Date(s.created_at).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' }) : ''
        const docs      = documentosDe(s)

        return (
          <div key={s.id} style={{
            border: `1.5px solid ${expanded ? 'var(--at-accent-soft)' : 'var(--at-line)'}`,
            borderRadius: '12px', marginBottom: '10px',
            background: expanded ? 'var(--at-surface-2)' : 'var(--at-surface)',
            transition: 'all 0.15s',
          }}>
            {/* Card header */}
            <div
              style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', cursor: 'pointer', flexWrap: 'wrap' }}
              onClick={() => setExpandedId(expanded ? null : s.id)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>
                  🏠 {unidadNombre(s)}
                </div>
                <div style={{ fontSize: '12.5px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                  {TIPO_LABEL[s.tipo_renta]} · {fecha}
                  {s.arrendatario_nombre && <> · 👤 {s.arrendatario_nombre}</>}
                  {docs.length > 0 && <> · 📎 {docs.length}</>}
                </div>
              </div>
              <span style={{
                padding: '3px 10px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 600,
                background: cfg.bg, color: cfg.color, whiteSpace: 'nowrap',
              }}>
                {cfg.icon} {cfg.label}
              </span>
              <span style={{ color: 'var(--at-ink-3)', fontSize: '16px' }}>{expanded ? '▲' : '▼'}</span>
            </div>

            {/* Expanded detail */}
            {expanded && (
              <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--at-line)' }}>
                {s.motivo && (
                  <div style={{ marginTop: '12px', background: 'var(--at-surface-2)', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', color: 'var(--at-ink-2)' }}>
                    <strong>Motivo del cliente:</strong><br />{s.motivo}
                  </div>
                )}

                <DatosContratoSolicitud solicitud={s} moneda={moneda} />
                <ResponsablesServiciosDetalle fuente={s} />
                <DocumentosSolicitudRenta documentos={docs} />
                <EstadoContratoSolicitud solicitud={s} />

                {s.comentario_admin && (
                  <div style={{ marginTop: '10px', background: cfg.bg, borderRadius: '8px', padding: '10px 12px', fontSize: '13px', color: cfg.color }}>
                    <strong>Resolución:</strong> {s.comentario_admin}
                    {s.aprobado_por && <span style={{ marginLeft: '8px', opacity: 0.8 }}>— {s.aprobado_por}</span>}
                  </div>
                )}

                {s.tipo_aprobado && s.estado === 'aprobada' && (
                  <div style={{ marginTop: '8px', fontSize: '12.5px', color: 'var(--at-success)', fontWeight: 600 }}>
                    ✅ Autorizado para: {TIPO_LABEL[s.tipo_aprobado]}
                  </div>
                )}

                {/* Actions for pending */}
                {s.estado === 'pendiente' && canEdit && (
                  <div style={{ marginTop: '14px', display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div>
                      <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>
                        Autorizar para:
                      </label>
                      <select
                        value={tipoAprobado}
                        onChange={e => setTipoAprobado(e.target.value as TipoRenta)}
                        onClick={e => e.stopPropagation()}
                        style={{
                          padding: '7px 12px', fontSize: '13px', borderRadius: '8px',
                          border: '1.5px solid var(--at-line)', background: 'var(--at-surface)', cursor: 'pointer',
                        }}
                      >
                        <option value="arrendamiento">Arrendamiento</option>
                        <option value="str">STR / Corto Plazo</option>
                        <option value="ambas">Arrendamiento + STR</option>
                      </select>
                    </div>
                    <button
                      disabled={saving}
                      onClick={e => { e.stopPropagation(); resolver(s, 'aprobada') }}
                      style={{
                        padding: '8px 18px', background: 'var(--at-success)', color: 'var(--at-on-status)',
                        border: 'none', borderRadius: '8px', fontWeight: 600,
                        fontSize: '13px', cursor: saving ? 'not-allowed' : 'pointer',
                        opacity: saving ? 0.7 : 1,
                      }}
                    >✅ Aprobar</button>
                    <button
                      disabled={saving}
                      onClick={e => { e.stopPropagation(); resolver(s, 'rechazada') }}
                      style={{
                        padding: '8px 18px', background: 'var(--at-danger)', color: 'var(--at-on-status)',
                        border: 'none', borderRadius: '8px', fontWeight: 600,
                        fontSize: '13px', cursor: saving ? 'not-allowed' : 'pointer',
                        opacity: saving ? 0.7 : 1,
                      }}
                    >❌ Rechazar</button>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
