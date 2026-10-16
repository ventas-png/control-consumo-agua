// Cola de autorización de mascotas y vehículos que los residentes registran
// desde el portal (20261101000000). Vive DENTRO de los tabs Mascotas y
// Vehículos del panel admin (vista "Solicitudes"), con el mismo permiso que el
// padrón: quien administra el padrón es quien lo autoriza.
//
// Calcado de SolicitudesRentaTab: KPIs, filtro por estado, tarjeta expandible
// con todo lo que el residente envió, y aprobar / rechazar (con motivo) por RPC.
import { useState, type ReactNode } from 'react'
import { notify } from '../../shared/Dialog'
import { openPromptDialog } from '../../shared/PromptDialog'
import { SecureImage } from '../../shared/SecureImage'
import { hoyLocalISO } from '../../../lib/format'
import { resolverMascota, resolverVehiculo } from '../../../domain/condominios/padronAutorizacion'
import {
  DocumentosPadron, ESPECIE_PADRON, ESTADO_PADRON_CFG, EstadoPadronBadge, FichaMascotaDetalle,
  ResolucionPadron, TAG_TIPO_LABEL, VacunasDetalle, estadoDe, fechaCorta,
} from '../PadronComun'
import type { EstadoPadron, Mascota, TipoTagVehiculo, Unidad, VehiculoResidente } from '../../../types'

type Filtro = EstadoPadron | 'all'

interface FilaPadron {
  id: string
  unidad_id: string
  estado?: EstadoPadron
  fecha_solicitud?: string | null
  created_at: string
  cliente_id?: string | null
}

/** Solo lo que pasó por el circuito del portal: lo cargado por el staff no es "solicitud". */
export function esSolicitudPortal(f: FilaPadron): boolean {
  return !!f.cliente_id && estadoDe(f) !== 'borrador'
}

function Cola<T extends FilaPadron>({ filas, unidades, icono, vacio, resumen, detalle, acciones }: {
  filas: T[]
  unidades: Unidad[]
  icono: string
  vacio: string
  resumen: (f: T) => ReactNode
  detalle: (f: T) => ReactNode
  acciones: (f: T, cerrar: () => void) => ReactNode
}) {
  const [filtro, setFiltro] = useState<Filtro>('pendiente')
  const [abierta, setAbierta] = useState<string | null>(null)

  const solicitudes = filas.filter(esSolicitudPortal)
  const cuenta = (e: EstadoPadron) => solicitudes.filter(f => estadoDe(f) === e).length
  const visibles = solicitudes
    .filter(f => filtro === 'all' || estadoDe(f) === filtro)
    .sort((a, b) => (b.fecha_solicitud ?? b.created_at).localeCompare(a.fecha_solicitud ?? a.created_at))

  const unidadNombre = (f: T) => unidades.find(u => u.id === f.unidad_id)?.nombre ?? f.unidad_id.slice(0, 8)

  const chip = (activo: boolean, color: string): React.CSSProperties => ({
    padding: '5px 14px', borderRadius: '20px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', border: 'none',
    background: activo ? color : 'var(--at-chip)', color: activo ? 'white' : 'var(--at-ink-3)',
  })

  return (
    <div>
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {(['pendiente', 'aprobada', 'rechazada', 'baja'] as EstadoPadron[]).map(e => {
          const cfg = ESTADO_PADRON_CFG[e]
          return (
            <div key={e} style={{ background: cfg.bg, borderRadius: '10px', padding: '10px 18px', minWidth: '100px' }}>
              <div style={{ fontSize: '20px', fontWeight: 700, color: cfg.color }}>{cuenta(e)}</div>
              <div style={{ fontSize: '12px', color: cfg.color, fontWeight: 600 }}>{cfg.label}</div>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }} role="group" aria-label="Filtrar por estado">
        <button style={chip(filtro === 'pendiente', 'var(--at-warning)')} onClick={() => setFiltro('pendiente')}>⏳ En revisión</button>
        <button style={chip(filtro === 'aprobada', 'var(--at-success)')} onClick={() => setFiltro('aprobada')}>✅ Autorizadas</button>
        <button style={chip(filtro === 'rechazada', 'var(--at-danger)')} onClick={() => setFiltro('rechazada')}>❌ Rechazadas</button>
        <button style={chip(filtro === 'baja', 'var(--at-ink-3)')} onClick={() => setFiltro('baja')}>🚫 De baja</button>
        <button style={chip(filtro === 'all', 'var(--at-ink-3)')} onClick={() => setFiltro('all')}>Todas</button>
      </div>

      {visibles.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '34px', marginBottom: '8px' }}>{icono}</div>
          <div style={{ fontSize: '14px' }}>{vacio}</div>
        </div>
      ) : visibles.map(f => {
        const expandida = abierta === f.id
        return (
          <div key={f.id} style={{
            border: `1.5px solid ${expandida ? 'var(--at-accent-soft)' : 'var(--at-line)'}`, borderRadius: '12px',
            marginBottom: '10px', background: expandida ? 'var(--at-surface-2)' : 'var(--at-surface)',
          }}>
            <button
              type="button"
              onClick={() => setAbierta(expandida ? null : f.id)}
              aria-expanded={expandida}
              style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', flexWrap: 'wrap' }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                {resumen(f)}
                <span style={{ display: 'block', fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                  🏠 {unidadNombre(f)}{f.fecha_solicitud ? ` · enviada ${fechaCorta(f.fecha_solicitud)}` : ''}
                </span>
              </span>
              <EstadoPadronBadge estado={estadoDe(f)} />
              <span aria-hidden style={{ color: 'var(--at-ink-3)' }}>{expandida ? '▲' : '▼'}</span>
            </button>
            {expandida && (
              <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--at-line)' }}>
                {detalle(f)}
                {estadoDe(f) === 'pendiente' && acciones(f, () => setAbierta(null))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

const btn = (bg: string, saving: boolean): React.CSSProperties => ({
  padding: '8px 18px', background: bg, color: 'var(--at-on-status)', border: 'none', borderRadius: '8px',
  fontWeight: 600, fontSize: '13px', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1,
})

async function pedirMotivoRechazo(nombre: string): Promise<string | null> {
  const r = await openPromptDialog({
    title: `¿Rechazar ${nombre}?`,
    description: 'El residente verá el motivo en su portal y podrá enviar un registro nuevo.',
    fields: [{ name: 'comentario', label: 'Motivo del rechazo', control: 'textarea', rows: 4, required: true, autoFocus: true, placeholder: 'Ej. falta el carnet de vacunación vigente.' }],
    submitText: 'Rechazar',
    validate: d => (d.comentario ?? '').trim() ? null : 'Indique el motivo del rechazo.',
  })
  return r ? r.comentario.trim() : null
}

// ── Mascotas ────────────────────────────────────────────────────────────────

export function SolicitudesMascotasPanel({ mascotas, unidades, canEdit, onRefresh }: {
  mascotas: Mascota[]
  unidades: Unidad[]
  canEdit: boolean
  onRefresh: () => void
}) {
  const [saving, setSaving] = useState(false)
  const hoy = hoyLocalISO()

  async function resolver(m: Mascota, aprobar: boolean, cerrar: () => void) {
    let comentario: string | null = null
    if (aprobar) {
      const r = await openPromptDialog({
        title: `¿Autorizar a ${m.nombre}?`,
        description: 'La mascota pasará al padrón del condominio como autorizada y se avisará al residente.',
        fields: [{ name: 'comentario', label: 'Comentario (opcional)', control: 'textarea', rows: 3, placeholder: 'Ej. recuerde usar correa en áreas comunes.' }],
        submitText: 'Autorizar',
      })
      if (!r) return
      comentario = r.comentario?.trim() || null
    } else {
      comentario = await pedirMotivoRechazo(m.nombre)
      if (!comentario) return
    }
    setSaving(true)
    const { error } = await resolverMascota(m.id, aprobar, comentario)
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'No se pudo resolver', text: error }); return }
    notify({ variant: 'success', title: aprobar ? 'Mascota autorizada' : 'Solicitud rechazada', duration: 1600 })
    cerrar()
    onRefresh()
  }

  return (
    <Cola
      filas={mascotas}
      unidades={unidades}
      icono="🐾"
      vacio="No hay solicitudes de mascotas en este estado."
      resumen={m => (
        <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {m.foto_url
            ? <SecureImage src={m.foto_url} alt={m.nombre} style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover' }} />
            : <span aria-hidden style={{ fontSize: '22px' }}>{ESPECIE_PADRON[m.especie]?.icon ?? '🐾'}</span>}
          <span>
            <span style={{ display: 'block', fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>{m.nombre}</span>
            <span style={{ display: 'block', fontSize: '12.5px', color: 'var(--at-ink-3)' }}>
              {ESPECIE_PADRON[m.especie]?.label ?? m.especie}{m.raza ? ` · ${m.raza}` : ''} · 💉 {Array.isArray(m.vacunas) ? m.vacunas.length : 0} · 📎 {Array.isArray(m.documentos) ? m.documentos.length : 0}
            </span>
          </span>
        </span>
      )}
      detalle={m => (
        <>
          <ResolucionPadron fila={m} />
          <FichaMascotaDetalle mascota={m} />
          <VacunasDetalle vacunas={m.vacunas} hoy={hoy} />
          <DocumentosPadron documentos={m.documentos} />
        </>
      )}
      acciones={(m, cerrar) => canEdit ? (
        <div style={{ marginTop: '14px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button disabled={saving} onClick={() => resolver(m, true, cerrar)} style={btn('var(--at-success)', saving)}>✅ Autorizar</button>
          <button disabled={saving} onClick={() => resolver(m, false, cerrar)} style={btn('var(--at-danger)', saving)}>❌ Rechazar</button>
        </div>
      ) : null}
    />
  )
}

// ── Vehículos ───────────────────────────────────────────────────────────────

export const OPCIONES_TAG = (Object.keys(TAG_TIPO_LABEL) as TipoTagVehiculo[]).map(v => ({ value: v, label: TAG_TIPO_LABEL[v] }))

export function SolicitudesVehiculosPanel({ vehiculos, unidades, canEdit, onRefresh }: {
  vehiculos: VehiculoResidente[]
  unidades: Unidad[]
  canEdit: boolean
  onRefresh: () => void
}) {
  const [saving, setSaving] = useState(false)

  async function resolver(v: VehiculoResidente, aprobar: boolean, cerrar: () => void) {
    let comentario: string | null = null
    let tagCodigo: string | null = null
    let tagTipo: TipoTagVehiculo | null = null
    if (aprobar) {
      const r = await openPromptDialog({
        title: `¿Autorizar el vehículo ${v.placa}?`,
        description: 'Asigne el TAG de ingreso que se le entrega al residente. Si todavía no lo tiene, déjelo vacío y asígnelo después desde el padrón.',
        fields: [
          { name: 'tag_codigo', label: 'Código del TAG de ingreso', placeholder: 'Ej. TG-0153', autoFocus: true },
          { name: 'tag_tipo', label: 'Tipo de TAG', control: 'select', options: OPCIONES_TAG, initialValue: 'sticker' },
          { name: 'comentario', label: 'Comentario (opcional)', control: 'textarea', rows: 3 },
        ],
        submitText: 'Autorizar',
      })
      if (!r) return
      comentario = r.comentario?.trim() || null
      tagCodigo = r.tag_codigo?.trim() || null
      tagTipo = tagCodigo ? (r.tag_tipo as TipoTagVehiculo) || 'sticker' : null
    } else {
      comentario = await pedirMotivoRechazo(`el vehículo ${v.placa}`)
      if (!comentario) return
    }
    setSaving(true)
    const { error } = await resolverVehiculo({ id: v.id, aprobar, comentario, tagCodigo, tagTipo })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'No se pudo resolver', text: error }); return }
    notify({
      variant: 'success',
      title: aprobar ? 'Vehículo autorizado' : 'Solicitud rechazada',
      text: aprobar ? (tagCodigo ? `TAG ${tagCodigo} asignado.` : 'Recuerde asignarle el TAG de ingreso.') : undefined,
      duration: 2000,
    })
    cerrar()
    onRefresh()
  }

  return (
    <Cola
      filas={vehiculos}
      unidades={unidades}
      icono="🚗"
      vacio="No hay solicitudes de vehículos en este estado."
      resumen={v => (
        <span>
          <span style={{ display: 'block', fontWeight: 800, fontSize: '15px', letterSpacing: '1px', color: 'var(--at-ink)' }}>{v.placa}</span>
          <span style={{ display: 'block', fontSize: '12.5px', color: 'var(--at-ink-3)' }}>
            {[v.marca, v.modelo, v.anio, v.color].filter(Boolean).join(' · ') || v.tipo}
            {v.tag_codigo && estadoDe(v) === 'aprobada' ? ` · 🏷️ ${v.tag_codigo}` : ''}
            {` · 📎 ${Array.isArray(v.documentos) ? v.documentos.length : 0}`}
          </span>
        </span>
      )}
      detalle={v => (
        <>
          <ResolucionPadron fila={v} />
          {v.notas && (
            <div style={{ marginTop: '12px', background: 'var(--at-surface-2)', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', color: 'var(--at-ink-2)', whiteSpace: 'pre-line' }}>
              <strong>Notas del residente:</strong><br />{v.notas}
            </div>
          )}
          {estadoDe(v) === 'aprobada' && (
            <div style={{ marginTop: '10px', fontSize: '13px', color: v.tag_codigo ? 'var(--at-success)' : 'var(--at-warning-strong)' }}>
              🏷️ {v.tag_codigo ? `TAG ${v.tag_codigo}${v.tag_tipo ? ` (${TAG_TIPO_LABEL[v.tag_tipo]})` : ''}` : 'Sin TAG asignado todavía'}
            </div>
          )}
          <DocumentosPadron documentos={v.documentos} />
        </>
      )}
      acciones={(v, cerrar) => canEdit ? (
        <div style={{ marginTop: '14px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button disabled={saving} onClick={() => resolver(v, true, cerrar)} style={btn('var(--at-success)', saving)}>✅ Autorizar y asignar TAG</button>
          <button disabled={saving} onClick={() => resolver(v, false, cerrar)} style={btn('var(--at-danger)', saving)}>❌ Rechazar</button>
        </div>
      ) : null}
    />
  )
}

/** Conmutador Padrón / Solicitudes para la cabecera de los tabs admin. */
export function VistaPadronToggle({ vista, onChange, pendientes }: {
  vista: 'padron' | 'solicitudes'
  onChange: (v: 'padron' | 'solicitudes') => void
  pendientes: number
}) {
  const estilo = (activo: boolean): React.CSSProperties => ({
    padding: '7px 16px', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
    background: activo ? 'var(--at-surface)' : 'transparent', color: activo ? 'var(--at-ink)' : 'var(--at-ink-3)',
    boxShadow: activo ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
  })
  return (
    <div role="tablist" style={{ display: 'inline-flex', gap: '4px', background: 'var(--at-chip)', borderRadius: '10px', padding: '4px', marginBottom: '16px' }}>
      <button role="tab" aria-selected={vista === 'padron'} style={estilo(vista === 'padron')} onClick={() => onChange('padron')}>📋 Padrón</button>
      <button role="tab" aria-selected={vista === 'solicitudes'} style={estilo(vista === 'solicitudes')} onClick={() => onChange('solicitudes')}>
        📥 Solicitudes del portal
        {pendientes > 0 && (
          <span style={{ marginLeft: '6px', background: 'var(--at-warning)', color: 'white', borderRadius: '10px', padding: '1px 7px', fontSize: '11px' }}>{pendientes}</span>
        )}
      </button>
    </div>
  )
}
