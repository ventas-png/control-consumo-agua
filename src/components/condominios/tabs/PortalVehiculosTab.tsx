// Portal del residente · Vehículos (20261101000000).
//
// El residente registra sus vehículos para que la administración los autorice y
// le asigne el TAG de ingreso. Mismo circuito que la solicitud de renta:
// borrador → enviar (pendiente) → aprobado (con o sin TAG todavía) / rechazado,
// y después puede retirarlo o darlo de baja. Toda escritura va por RPC
// (domain/portal/padron); la tabla no se toca directo.
import { useCallback, useEffect, useState } from 'react'
import { confirm, notify } from '../../shared/Dialog'
import {
  carpetaPadron, darDeBajaPadron, descartarPadron, enviarVehiculo, fetchVehiculosUnidad, reservarPadron,
} from '../../../domain/portal/padron'
import { removePadronDocs } from '../../../domain/shared/storage'
import { normalizarPlaca, placaValida } from '../../../lib/padronMascotas'
import {
  AdjuntosBorrador, DocumentosPadron, EstadoPadronBadge, ResolucionPadron, TAG_TIPO_LABEL,
  estadoDe, fechaCorta,
} from '../PadronComun'
import type { DocumentoPadron, TipoVehiculo, VehiculoResidente } from '../../../types'

interface Props {
  unidadId: string
  unidadNombre: string
  clienteId: string
  /** El propietario puede retirar o dar de baja lo que registró su inquilino. */
  esPropietario: boolean
}

const TIPO_VEHICULO: Record<TipoVehiculo, { icon: string; label: string }> = {
  auto:   { icon: '🚗', label: 'Automóvil' },
  moto:   { icon: '🏍️', label: 'Motocicleta' },
  camion: { icon: '🚚', label: 'Camión / pick-up' },
  otro:   { icon: '🚙', label: 'Otro' },
}

const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', fontSize: '13.5px',
  border: '1.5px solid var(--at-line)', borderRadius: '8px', outline: 'none',
  boxSizing: 'border-box', background: 'var(--at-surface)',
}
const labelStyle: React.CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '4px', display: 'block' }
const gridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }

const BLANK = { placa: '', tipo: 'auto' as TipoVehiculo, marca: '', modelo: '', color: '', anio: '', notas: '' }

function VehiculoForm({ unidadId, borradorId, onCerrar, onEnviado }: {
  unidadId: string
  borradorId: string | null
  onCerrar: () => void
  onEnviado: () => void
}) {
  const [id, setId]             = useState<string | null>(borradorId)
  const [errorReserva, setErrorReserva] = useState<string | null>(null)
  const [form, setForm]         = useState({ ...BLANK })
  const [docs, setDocs]         = useState<DocumentoPadron[]>([])
  const [subiendo, setSubiendo] = useState(false)
  const [saving, setSaving]     = useState(false)
  const anioMax = new Date().getFullYear() + 1

  useEffect(() => {
    let vigente = true
    if (id) return
    reservarPadron('vehiculo', unidadId).then(({ id: nuevo, error }) => {
      if (!vigente) return
      if (error) { setErrorReserva(error); return }
      setId(nuevo)
    })
    return () => { vigente = false }
  }, [unidadId, id])

  function setF<K extends keyof typeof form>(k: K, v: (typeof form)[K]) { setForm(p => ({ ...p, [k]: v })) }

  async function enviar() {
    if (!id) { notify({ variant: 'error', title: 'Error', text: 'El registro no está listo todavía.' }); return }
    if (!form.placa.trim()) { notify({ variant: 'error', title: 'Falta un dato', text: 'La placa es requerida.' }); return }
    if (!placaValida(form.placa)) { notify({ variant: 'error', title: 'Placa inválida', text: 'Usa solo letras, números, espacios o guiones (ej. P-123ABC).' }); return }
    const anio = form.anio ? Number(form.anio) : null
    if (anio != null && (!Number.isInteger(anio) || anio < 1950 || anio > anioMax)) {
      notify({ variant: 'error', title: 'Año inválido', text: `Ingresa un año entre 1950 y ${anioMax}.` }); return
    }

    setSaving(true)
    const { error } = await enviarVehiculo(id, {
      placa: normalizarPlaca(form.placa),
      tipo: form.tipo,
      marca: form.marca.trim() || null,
      modelo: form.modelo.trim() || null,
      color: form.color.trim() || null,
      anio,
      notas: form.notas.trim() || null,
    }, docs.map(({ path, nombre, etiqueta, mime, size }) => ({ path, nombre, etiqueta: etiqueta?.trim() || null, mime, size })))
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'No se pudo enviar', text: error }); return }
    notify({ variant: 'success', title: '¡Solicitud enviada!', text: 'La administración revisará el registro y te asignará el TAG de ingreso.', duration: 2400 })
    onEnviado()
  }

  async function descartar() {
    const r = await confirm({ title: '¿Descartar este registro?', text: 'Se borrarán los datos y documentos que cargaste.', icon: 'warning', variant: 'danger', confirmText: 'Descartar' })
    if (!r.isConfirmed) return
    if (docs.length > 0) await removePadronDocs(docs.map(d => d.path))
    if (id) {
      const { error } = await descartarPadron('vehiculo', id)
      if (error) { notify({ variant: 'error', title: 'Error', text: error }); return }
    }
    onEnviado()
  }

  const bloqueado = saving || subiendo || !id

  return (
    <div style={{ maxWidth: '680px' }}>
      <div style={{ marginBottom: '16px' }}>
        <h3 style={{ margin: '0 0 6px', fontSize: '17px', fontWeight: 700, color: 'var(--at-ink)' }}>🚗 Registrar vehículo</h3>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--at-ink-3)' }}>
          Registra tu vehículo para que la administración lo autorice y te asigne el TAG de ingreso al condominio.
        </p>
      </div>

      {errorReserva && (
        <div role="alert" style={{ background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', fontSize: '13px', color: 'var(--at-danger)' }}>
          No se pudo preparar el registro: {errorReserva}
        </div>
      )}

      <div style={{ border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '16px', marginBottom: '18px', background: 'var(--at-surface-2)' }}>
        <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)', marginBottom: '12px' }}>📋 Datos del vehículo</div>
        <div style={gridStyle}>
          <div>
            <label style={labelStyle} htmlFor="pv-placa">Placa *</label>
            <input id="pv-placa" style={{ ...fieldStyle, textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 700 }} value={form.placa}
              onChange={e => setF('placa', e.target.value)} placeholder="P-123ABC" maxLength={15} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="pv-tipo">Tipo *</label>
            <select id="pv-tipo" style={{ ...fieldStyle, cursor: 'pointer' }} value={form.tipo} onChange={e => setF('tipo', e.target.value as TipoVehiculo)}>
              {(Object.keys(TIPO_VEHICULO) as TipoVehiculo[]).map(t => <option key={t} value={t}>{TIPO_VEHICULO[t].icon} {TIPO_VEHICULO[t].label}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle} htmlFor="pv-marca">Marca</label>
            <input id="pv-marca" style={fieldStyle} value={form.marca} onChange={e => setF('marca', e.target.value)} placeholder="Toyota, Honda…" />
          </div>
          <div>
            <label style={labelStyle} htmlFor="pv-modelo">Modelo</label>
            <input id="pv-modelo" style={fieldStyle} value={form.modelo} onChange={e => setF('modelo', e.target.value)} placeholder="Corolla, Civic…" />
          </div>
          <div>
            <label style={labelStyle} htmlFor="pv-color">Color</label>
            <input id="pv-color" style={fieldStyle} value={form.color} onChange={e => setF('color', e.target.value)} placeholder="Blanco, negro…" />
          </div>
          <div>
            <label style={labelStyle} htmlFor="pv-anio">Año</label>
            <input id="pv-anio" style={fieldStyle} type="number" min={1950} max={anioMax} value={form.anio} onChange={e => setF('anio', e.target.value)} placeholder={String(anioMax - 1)} />
          </div>
        </div>
        <div style={{ marginTop: '12px' }}>
          <label style={labelStyle} htmlFor="pv-notas">Notas para la administración</label>
          <textarea id="pv-notas" style={{ ...fieldStyle, minHeight: '64px', resize: 'vertical' }} value={form.notas} onChange={e => setF('notas', e.target.value)}
            placeholder="Conductor habitual, parqueo asignado, si es vehículo de empresa…" />
        </div>
      </div>

      <AdjuntosBorrador
        carpeta={id ? carpetaPadron('vehiculo', unidadId, id) : null}
        docs={docs}
        onChange={setDocs}
        onSubiendo={setSubiendo}
        ayuda="Anexa la tarjeta de circulación y, si la administración lo pide, la licencia del conductor o la carta del propietario del vehículo."
        placeholderEtiqueta="Etiqueta (ej. Tarjeta de circulación)"
      />

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <button onClick={enviar} disabled={bloqueado} style={{
          padding: '10px 24px', background: 'var(--at-accent-hover)', color: 'white', border: 'none', borderRadius: '9px',
          fontWeight: 600, fontSize: '14px', cursor: bloqueado ? 'not-allowed' : 'pointer', opacity: bloqueado ? 0.7 : 1,
        }}>{saving ? 'Enviando…' : 'Enviar solicitud'}</button>
        <button onClick={onCerrar} disabled={saving} style={{ padding: '10px 18px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '9px', fontSize: '13.5px', cursor: 'pointer' }}>
          Cerrar
        </button>
        {id && (
          <button onClick={descartar} disabled={saving} style={{ padding: '10px 18px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: '9px', fontSize: '13.5px', fontWeight: 600, cursor: 'pointer' }}>
            Descartar registro
          </button>
        )}
      </div>
    </div>
  )
}

/** El TAG del vehículo autorizado, o el aviso de que aún no se entrega. */
function TagVehiculo({ v }: { v: VehiculoResidente }) {
  if (estadoDe(v) !== 'aprobada') return null
  if (!v.tag_codigo) {
    return (
      <div style={{ marginTop: '12px', fontSize: '13px', color: 'var(--at-ink-3)', background: 'var(--at-surface-2)', borderRadius: '8px', padding: '10px 12px' }}>
        🏷️ La administración todavía no te ha asignado el TAG de ingreso. Pasa por la administración para recogerlo.
      </div>
    )
  }
  return (
    <div style={{ marginTop: '12px', fontSize: '13px', color: 'var(--at-success)', background: 'var(--at-success-tint)', borderRadius: '8px', padding: '10px 12px' }}>
      🏷️ <strong>TAG de ingreso: {v.tag_codigo}</strong>
      {v.tag_tipo ? ` · ${TAG_TIPO_LABEL[v.tag_tipo]}` : ''}
      {v.tag_asignado_at ? ` · asignado ${fechaCorta(v.tag_asignado_at)}` : ''}
    </div>
  )
}

export function PortalVehiculosTab({ unidadId, unidadNombre, clienteId, esPropietario }: Props) {
  const [vehiculos, setVehiculos] = useState<VehiculoResidente[]>([])
  const [loading, setLoading]     = useState(true)
  const [formAbierto, setFormAbierto] = useState(false)
  const [expandido, setExpandido] = useState<string | null>(null)
  const [procesando, setProcesando] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setLoading(true)
    const { data, error } = await fetchVehiculosUnidad(unidadId)
    setLoading(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error }); return }
    setVehiculos(data)
  }, [unidadId])

  useEffect(() => { setFormAbierto(false); cargar() }, [cargar])

  const borrador = vehiculos.find(v => estadoDe(v) === 'borrador' && v.cliente_id === clienteId) ?? null
  const visibles = vehiculos.filter(v => estadoDe(v) !== 'borrador')
  const pendientes = visibles.filter(v => estadoDe(v) === 'pendiente').length
  const autorizados = visibles.filter(v => estadoDe(v) === 'aprobada' && v.activo).length

  async function retirar(v: VehiculoResidente) {
    const pendiente = estadoDe(v) === 'pendiente'
    const r = await confirm({
      title: pendiente ? `¿Retirar la solicitud de ${v.placa}?` : `¿Dar de baja el vehículo ${v.placa}?`,
      text: pendiente
        ? 'La solicitud dejará de estar en revisión. Podrás registrarlo de nuevo cuando quieras.'
        : 'El vehículo dejará de estar autorizado para ingresar y su TAG quedará desactivado. Devuelve el TAG a la administración.',
      icon: 'warning', variant: 'danger',
      confirmText: pendiente ? 'Retirar solicitud' : 'Dar de baja',
    })
    if (!r.isConfirmed) return
    setProcesando(v.id)
    const { error } = await darDeBajaPadron('vehiculo', v.id)
    setProcesando(null)
    if (error) { notify({ variant: 'error', title: 'Error', text: error }); return }
    notify({ variant: 'success', title: pendiente ? 'Solicitud retirada' : 'Vehículo dado de baja', duration: 1800 })
    cargar()
  }

  if (formAbierto) {
    return (
      <VehiculoForm
        key={borrador?.id ?? 'nuevo'}
        unidadId={unidadId}
        borradorId={borrador?.id ?? null}
        onCerrar={() => { setFormAbierto(false); cargar() }}
        onEnviado={() => { setFormAbierto(false); cargar() }}
      />
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap', marginBottom: '18px' }}>
        <div>
          <h3 style={{ margin: '0 0 4px', fontSize: '17px', fontWeight: 700, color: 'var(--at-ink)' }}>🚗 Vehículos — {unidadNombre}</h3>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--at-ink-3)' }}>
            Registra tus vehículos para su autorización y la asignación del TAG de ingreso por la administración.
          </p>
        </div>
        <button onClick={() => setFormAbierto(true)} style={{
          padding: '9px 18px', background: 'var(--at-accent-hover)', color: 'white', border: 'none',
          borderRadius: '9px', fontWeight: 600, fontSize: '13.5px', cursor: 'pointer',
        }}>{borrador ? '📝 Continuar registro' : '+ Registrar vehículo'}</button>
      </div>

      {!loading && visibles.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px', fontSize: '12.5px', color: 'var(--at-ink-3)' }}>
          <span>✅ {autorizados} autorizado{autorizados === 1 ? '' : 's'}</span>
          {pendientes > 0 && <span>· ⏳ {pendientes} en revisión</span>}
        </div>
      )}

      {loading ? (
        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--at-ink-3)', fontSize: '13px' }}>Cargando…</div>
      ) : visibles.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '42px', marginBottom: '10px' }}>🚗</div>
          <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '6px' }}>Sin vehículos registrados</div>
          <div style={{ fontSize: '13px' }}>Registra tu vehículo para que la administración lo autorice y te entregue el TAG de ingreso.</div>
        </div>
      ) : visibles.map(v => {
        const estado = estadoDe(v)
        const abierto = expandido === v.id
        const puedeRetirar = (estado === 'pendiente' || estado === 'aprobada') && (v.cliente_id === clienteId || esPropietario)
        const tipo = TIPO_VEHICULO[v.tipo] ?? TIPO_VEHICULO.otro
        return (
          <div key={v.id} style={{
            border: `1.5px solid ${abierto ? 'var(--at-accent-soft)' : 'var(--at-line)'}`, borderRadius: '12px',
            marginBottom: '10px', background: abierto ? 'var(--at-surface-2)' : 'var(--at-surface)',
          }}>
            <button
              type="button"
              onClick={() => setExpandido(abierto ? null : v.id)}
              aria-expanded={abierto}
              style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', flexWrap: 'wrap' }}
            >
              <span aria-hidden style={{ fontSize: '24px', flexShrink: 0 }}>{tipo.icon}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 800, fontSize: '15px', letterSpacing: '1px', color: 'var(--at-ink)' }}>{v.placa}</span>
                <span style={{ display: 'block', fontSize: '12.5px', color: 'var(--at-ink-3)' }}>
                  {[v.marca, v.modelo, v.anio, v.color].filter(Boolean).join(' · ') || tipo.label}
                  {estado === 'aprobada' && v.tag_codigo ? ` · 🏷️ ${v.tag_codigo}` : ''}
                </span>
              </span>
              <EstadoPadronBadge estado={estado} />
              <span aria-hidden style={{ color: 'var(--at-ink-3)' }}>{abierto ? '▲' : '▼'}</span>
            </button>

            {abierto && (
              <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--at-line)' }}>
                {estado === 'pendiente' && (
                  <div style={{ marginTop: '12px', fontSize: '13px', color: 'var(--at-warning-strong)' }}>
                    ⏳ Enviado {fechaCorta(v.fecha_solicitud)}. La administración está revisando la solicitud.
                  </div>
                )}
                <TagVehiculo v={v} />
                <ResolucionPadron fila={v} />
                {v.notas && (
                  <div style={{ marginTop: '10px', fontSize: '12.5px', color: 'var(--at-ink-2)', whiteSpace: 'pre-line' }}>
                    <span style={{ fontWeight: 600 }}>Notas:</span> {v.notas}
                  </div>
                )}
                <DocumentosPadron documentos={v.documentos} titulo="📎 Documentos enviados" />
                {puedeRetirar && (
                  <button
                    onClick={() => retirar(v)}
                    disabled={procesando === v.id}
                    style={{
                      marginTop: '14px', padding: '7px 16px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)',
                      border: '1px solid var(--at-danger-border)', borderRadius: '8px', fontSize: '12.5px', fontWeight: 600,
                      cursor: procesando === v.id ? 'default' : 'pointer', opacity: procesando === v.id ? 0.6 : 1,
                    }}
                  >{estado === 'pendiente' ? 'Retirar solicitud' : 'Dar de baja'}</button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
