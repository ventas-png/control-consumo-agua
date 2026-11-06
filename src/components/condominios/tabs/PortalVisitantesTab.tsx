import { hoyLocalISO, formatFechaCalendario } from '../../../lib/format'
import { useState } from 'react'
import { validatedInsert, validatedInsertMany } from '../../../lib/validatedInsert'
import { visitanteInputSchema } from '../../../domain/condominios/schemas'
import { toast } from '../../../lib/toast'
import { ImageUploader } from '../../shared/ImageUploader'
import { diaValidez } from '../../../lib/visitantesFiltros'
import type { Visitante, VisitaFrecuente } from '../../../types'
import { ModalPortal } from '../../shared/ModalPortal'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { SecureImage } from '../../shared/SecureImage'
import { PortalVisitasFrecuentes } from './PortalVisitasFrecuentes'

interface Props {
  visitantes: Visitante[]
  /** Pre-autorizaciones de ingreso de esta unidad (en cualquier estado). */
  visitasFrecuentes?: VisitaFrecuente[]
  /** Días de aviso de renovación del condominio; si no viene, se lee de `projects`. */
  diasAvisoRenovacion?: number
  unidadId: string
  proyectoId: string
  companyId: string
  onRefresh: () => void
}

interface AcompananteForm {
  tempId: string
  nombre: string
  identificacion: string
  es_menor: boolean
  fecha_nacimiento: string
  notas: string
  foto_url: string | null
  foto_documento_url: string | null
}

const defaultAcompForm = (): Omit<AcompananteForm, 'tempId'> => ({
  nombre: '', identificacion: '', es_menor: false, fecha_nacimiento: '', notas: '', foto_url: null, foto_documento_url: null,
})

/** "2026-11-06T10:30:00Z" → "06 de noviembre de 2026, 10:30" (hora local). */
const fechaHoraLarga = (iso: string) => new Date(iso).toLocaleString('es', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
/** "lunes, 05 de enero" → "Lunes, 05 de enero". */
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const ESTADO_VISITA = {
  hoy:      { label: 'Hoy',      bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' },
  vigente:  { label: 'Vigente',  bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  expirada: { label: 'Expirada', bg: 'var(--at-surface-2)',    color: 'var(--at-ink-3)' },
} as const

function blankForm() {
  return {
    nombre: '',
    identificacion: '',
    placa_vehiculo: '',
    motivo: '',
    notas: '',
    valido_hasta: '',
    es_menor: false,
    fecha_nacimiento: '',
  }
}

export function PortalVisitantesTab({ visitantes, visitasFrecuentes = [], diasAvisoRenovacion, unidadId, proyectoId, companyId, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [form, setForm]         = useState(blankForm())
  const [fotoUrl, setFotoUrl]                 = useState<string | null>(null)
  const [fotoDocumentoUrl, setFotoDocumentoUrl] = useState<string | null>(null)
  const [fotoVehiculoUrl, setFotoVehiculoUrl]   = useState<string | null>(null)
  const [acompanantes, setAcompanantes]       = useState<AcompananteForm[]>([])
  const [showAcompForm, setShowAcompForm]     = useState(false)
  const [acompForm, setAcompForm]             = useState(defaultAcompForm())

  const hoy      = hoyLocalISO()
  const recientes = visitantes.filter(v => v.hora_entrada.slice(0, 10) === hoy && !v.visitante_principal_id)
  // Visitante abierto en la ficha, por id: así la ficha sigue a la fila cuando el padre recarga.
  const [detalleId, setDetalleId] = useState<string | null>(null)
  const detalle = detalleId ? visitantes.find(v => v.id === detalleId) ?? null : null
  const estadoDe = (v: Visitante) => {
    const esHoy = v.hora_entrada.slice(0, 10) === hoy
    const vigente = !v.valido_hasta || diaValidez(v.valido_hasta) >= hoy
    return esHoy ? ESTADO_VISITA.hoy : vigente ? ESTADO_VISITA.vigente : ESTADO_VISITA.expirada
  }

  function resetForm() {
    setForm(blankForm())
    setFotoUrl(null)
    setFotoDocumentoUrl(null)
    setFotoVehiculoUrl(null)
    setAcompanantes([])
    setShowAcompForm(false)
    setAcompForm(defaultAcompForm())
    setShowForm(false)
  }

  function agregarAcompanante() {
    if (!acompForm.nombre.trim()) { toast.error('Ingrese el nombre del acompañante.'); return }
    setAcompanantes(prev => [...prev, {
      ...acompForm,
      nombre: acompForm.nombre.trim(),
      tempId: crypto.randomUUID(),
    }])
    setAcompForm(defaultAcompForm())
    setShowAcompForm(false)
  }

  function quitarAcompanante(tempId: string) {
    setAcompanantes(prev => prev.filter(a => a.tempId !== tempId))
  }

  async function preAutorizar() {
    if (!form.nombre.trim()) { toast.error('Ingrese el nombre del visitante.'); return }
    setSaving(true)
    const horaEntrada = new Date().toISOString()
    // cond:C2 — pre-validación Zod (boundary portal residente).
    const { data, error } = await validatedInsert('visitantes', visitanteInputSchema, {
      company_id: companyId,
      project_id: proyectoId,
      unidad_id: unidadId,
      nombre: form.nombre.trim(),
      identificacion: form.es_menor ? null : (form.identificacion.trim() || null),
      placa_vehiculo: form.placa_vehiculo.trim() || null,
      motivo: form.motivo.trim() || null,
      notas: form.notas.trim() || null,
      foto_url: fotoUrl,
      foto_documento_url: form.es_menor ? null : fotoDocumentoUrl,
      foto_vehiculo_url: fotoVehiculoUrl,
      valido_hasta: form.valido_hasta || null,
      hora_entrada: horaEntrada,
      es_menor: form.es_menor,
      fecha_nacimiento: form.es_menor && form.fecha_nacimiento ? form.fecha_nacimiento : null,
    }, { returning: true })

    if (error) { setSaving(false); toast.error(error.message); return }

    const insertedVisitante = data?.[0] as { id?: string } | undefined
    if (acompanantes.length > 0 && insertedVisitante) {
      const acompRows = acompanantes.map(a => ({
        company_id: companyId,
        project_id: proyectoId,
        unidad_id: unidadId,
        nombre: a.nombre,
        identificacion: a.es_menor ? null : (a.identificacion.trim() || null),
        placa_vehiculo: form.placa_vehiculo.trim() || null,
        motivo: form.motivo.trim() || null,
        notas: a.notas.trim() || null,
        foto_url: a.foto_url,
        foto_documento_url: a.es_menor ? null : a.foto_documento_url,
        valido_hasta: form.valido_hasta || null,
        hora_entrada: horaEntrada,
        es_menor: a.es_menor,
        fecha_nacimiento: a.es_menor && a.fecha_nacimiento ? a.fecha_nacimiento : null,
        visitante_principal_id: insertedVisitante.id,
      }))
      // cond:C2 — batch insert (acompañantes) con validación por fila.
      const { error: ae } = await validatedInsertMany('visitantes', visitanteInputSchema, acompRows)
      if (ae) {
        setSaving(false)
        toast.error('Visitante pre-autorizado, pero acompañantes no se guardaron', { description: ae.message })
        resetForm()
        onRefresh()
        return
      }
    }

    setSaving(false)
    const msg = acompanantes.length > 0
      ? `Visitante pre-autorizado con ${acompanantes.length} acompañante${acompanantes.length > 1 ? 's' : ''}`
      : '¡Visitante pre-autorizado!'
    toast.success(msg, { description: 'La administración fue notificada.' })
    resetForm()
    onRefresh()
  }

  const inputBase: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '9px 12px',
    border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)',
  }
  const labelBase: React.CSSProperties = {
    fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px',
  }

  return (
    <div>
      {/* Personas de confianza con ingreso pre-autorizado (la administración aprueba). */}
      <PortalVisitasFrecuentes visitas={visitasFrecuentes} diasAviso={diasAvisoRenovacion} unidadId={unidadId} proyectoId={proyectoId} companyId={companyId} onRefresh={onRefresh} />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: 'var(--at-ink)' }}>Mis visitantes</h3>
          {recientes.length > 0 && <p style={{ margin: '3px 0 0', fontSize: '13px', color: 'var(--at-primary)' }}>{recientes.length} visita{recientes.length > 1 ? 's' : ''} hoy</p>}
        </div>
        <button onClick={() => setShowForm(true)}
          style={{ padding: '9px 16px', background: 'linear-gradient(135deg,var(--at-cta),var(--at-cta-hover))', color: 'white', border: 'none', borderRadius: '9px', fontWeight: 600, cursor: 'pointer', fontSize: '13.5px' }}>
          + Pre-autorizar visita
        </button>
      </div>

      {showForm && (
        <ModalPortal>
        <div
          onClick={e => { if (e.target === e.currentTarget) resetForm() }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '16px', overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'var(--at-surface)', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '640px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>Pre-autorizar visita</h3>
              <button onClick={resetForm}
                style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--at-chip)', border: 'none', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--at-ink-3)', lineHeight: 1 }}>
                ×
              </button>
            </div>

            <div className="portal-form-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelBase}>Nombre completo *</label>
                <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                  placeholder="Nombre y apellido del visitante" style={inputBase} />
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.es_menor}
                      onChange={e => setForm(f => ({ ...f, es_menor: e.target.checked, identificacion: e.target.checked ? '' : f.identificacion }))} />
                    Es menor de edad
                  </label>
                  {form.es_menor && (
                    <span style={{ padding: '2px 8px', background: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', borderRadius: '20px', fontSize: '11px', fontWeight: 700 }}>Menor</span>
                  )}
                </div>
                {form.es_menor ? (
                  <div>
                    <label style={labelBase}>Fecha de nacimiento (opcional)</label>
                    <input type="date" value={form.fecha_nacimiento}
                      onChange={e => setForm(f => ({ ...f, fecha_nacimiento: e.target.value }))} style={inputBase} />
                  </div>
                ) : (
                  <div>
                    <label style={labelBase}>DPI / Identificación</label>
                    <input value={form.identificacion}
                      onChange={e => setForm(f => ({ ...f, identificacion: e.target.value }))}
                      placeholder="DPI, pasaporte..." style={inputBase} />
                  </div>
                )}
              </div>

              <div>
                <label style={labelBase}>Placa del vehículo</label>
                <input value={form.placa_vehiculo}
                  onChange={e => setForm(f => ({ ...f, placa_vehiculo: e.target.value }))}
                  placeholder="Ej. ABC-123" style={inputBase} />
              </div>

              <div>
                <label style={labelBase}>Motivo de la visita</label>
                <input value={form.motivo}
                  onChange={e => setForm(f => ({ ...f, motivo: e.target.value }))}
                  placeholder="Familiar, técnico, delivery..." style={inputBase} />
              </div>

              <div>
                <label style={labelBase}>Autorización válida hasta</label>
                <input type="date" value={form.valido_hasta} min={hoy}
                  onChange={e => setForm(f => ({ ...f, valido_hasta: e.target.value }))} style={inputBase} />
                <p style={{ margin: '3px 0 0', fontSize: '11.5px', color: 'var(--at-ink-3)' }}>Dejar vacío para visita de hoy únicamente</p>
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelBase}>Notas</label>
                <input value={form.notas}
                  onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                  placeholder="Opcional" style={inputBase} />
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                {/* auto-fill y no 3 columnas fijas: en el teléfono tres casillas de
                  * ~84px no dejaban leer "Foto del DPI / Documento"; con 130px de
                  * mínimo caben dos por fila y la tercera baja. */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 130px), 1fr))', gap: '14px' }}>
                  <ImageUploader value={fotoUrl} onChange={setFotoUrl} folder="visitantes" label="Foto del visitante" capture />
                  {!form.es_menor && (
                    <ImageUploader value={fotoDocumentoUrl} onChange={setFotoDocumentoUrl} folder="visitantes" label="Foto del DPI / Documento" capture />
                  )}
                  <ImageUploader value={fotoVehiculoUrl} onChange={setFotoVehiculoUrl} folder="visitantes" label="Foto del vehículo" capture />
                </div>
                <p style={{ margin: '6px 0 0', fontSize: '11.5px', color: 'var(--at-ink-3)' }}>
                  Las fotos ayudan al guardia a identificar al visitante. Son opcionales.
                </p>
              </div>
            </div>

            <div style={{ marginTop: '20px', borderTop: '1.5px solid var(--at-chip)', paddingTop: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--at-ink-2)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  👥 Acompañantes
                  {acompanantes.length > 0 && (
                    <span style={{ padding: '2px 8px', background: 'var(--at-primary-tint)', color: 'var(--at-primary)', borderRadius: '20px', fontSize: '11px', fontWeight: 700 }}>
                      {acompanantes.length}
                    </span>
                  )}
                </div>
                {!showAcompForm && (
                  <button type="button" onClick={() => setShowAcompForm(true)}
                    style={{ padding: '5px 12px', background: 'var(--at-surface-2)', color: 'var(--at-ink-2)', border: '1.5px solid var(--at-line)', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                    + Agregar acompañante
                  </button>
                )}
              </div>

              {acompanantes.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px' }}>
                  {acompanantes.map(a => (
                    <div key={a.tempId} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '8px' }}>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: a.es_menor ? 'var(--at-warning-tint)' : 'var(--at-primary-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', flexShrink: 0 }}>
                        {a.es_menor ? '👶' : '👤'}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--at-ink)' }}>{a.nombre}</div>
                        <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>
                          {a.es_menor
                            ? `Menor${a.fecha_nacimiento ? ` · Nac. ${a.fecha_nacimiento}` : ''}`
                            : a.identificacion ? `DPI: ${a.identificacion}` : 'Sin documento'}
                        </div>
                      </div>
                      <button type="button" onClick={() => quitarAcompanante(a.tempId)}
                        style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--at-danger-tint)', border: 'none', cursor: 'pointer', fontSize: '12px', color: 'var(--at-danger)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {showAcompForm && (
                <div style={{ padding: '14px', background: 'var(--at-surface-2)', border: '1.5px solid var(--at-line)', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink-2)' }}>Datos del acompañante</div>
                  <div>
                    <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '3px' }}>Nombre *</label>
                    <input value={acompForm.nombre} onChange={e => setAcompForm(f => ({ ...f, nombre: e.target.value }))}
                      placeholder="Nombre completo"
                      style={{ ...inputBase, padding: '8px 10px', fontSize: '13px', background: 'var(--at-surface)' }} />
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: 'var(--at-ink-2)', cursor: 'pointer', fontWeight: 600 }}>
                    <input type="checkbox" checked={acompForm.es_menor}
                      onChange={e => setAcompForm(f => ({ ...f, es_menor: e.target.checked, identificacion: '' }))} />
                    Es menor de edad
                    {acompForm.es_menor && <span style={{ padding: '2px 8px', background: 'var(--at-warning-tint)', color: 'var(--at-warning-strong)', borderRadius: '20px', fontSize: '11px' }}>Menor</span>}
                  </label>
                  {acompForm.es_menor ? (
                    <div>
                      <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '3px' }}>Fecha de nacimiento (opcional)</label>
                      <input type="date" value={acompForm.fecha_nacimiento}
                        onChange={e => setAcompForm(f => ({ ...f, fecha_nacimiento: e.target.value }))}
                        style={{ ...inputBase, padding: '8px 10px', fontSize: '13px', background: 'var(--at-surface)' }} />
                    </div>
                  ) : (
                    <div>
                      <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '3px' }}>DPI / Identificación (opcional)</label>
                      <input value={acompForm.identificacion}
                        onChange={e => setAcompForm(f => ({ ...f, identificacion: e.target.value }))}
                        placeholder="Número de documento"
                        style={{ ...inputBase, padding: '8px 10px', fontSize: '13px', background: 'var(--at-surface)' }} />
                    </div>
                  )}
                  <div>
                    <label style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Fotografías (opcional)</label>
                    <div style={{ display: 'grid', gridTemplateColumns: acompForm.es_menor ? '1fr' : '1fr 1fr', gap: '10px' }}>
                      <div>
                        <div style={{ fontSize: '10.5px', color: 'var(--at-ink-3)', marginBottom: '3px' }}>Foto de la persona</div>
                        <ImageUploader value={acompForm.foto_url}
                          onChange={v => setAcompForm(f => ({ ...f, foto_url: v }))}
                          folder="visitantes" label="Foto" capture />
                      </div>
                      {!acompForm.es_menor && (
                        <div>
                          <div style={{ fontSize: '10.5px', color: 'var(--at-ink-3)', marginBottom: '3px' }}>Foto del documento / DPI</div>
                          <ImageUploader value={acompForm.foto_documento_url}
                            onChange={v => setAcompForm(f => ({ ...f, foto_documento_url: v }))}
                            folder="visitantes" label="DPI" capture />
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="button" onClick={agregarAcompanante}
                      style={{ padding: '7px 16px', background: 'linear-gradient(135deg,var(--at-cta),var(--at-cta-hover))', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}>
                      + Agregar
                    </button>
                    <button type="button" onClick={() => { setShowAcompForm(false); setAcompForm(defaultAcompForm()) }}
                      style={{ padding: '7px 14px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '20px', flexWrap: 'wrap' }}>
              <button onClick={preAutorizar} disabled={saving}
                style={{ padding: '10px 22px', background: 'linear-gradient(135deg,var(--at-cta),var(--at-cta-hover))', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
                {saving ? 'Autorizando...' : `✅ Pre-autorizar visita${acompanantes.length > 0 ? ` (+${acompanantes.length})` : ''}`}
              </button>
              <button onClick={resetForm}
                style={{ padding: '10px 16px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {visitantes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '40px', marginBottom: '10px' }}>🚪</div>
          <p style={{ fontWeight: 600, color: 'var(--at-ink-3)' }}>Sin visitantes registrados</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {visitantes
            .filter(v => !v.visitante_principal_id)
            .sort((a, b) => b.hora_entrada.localeCompare(a.hora_entrada))
            .map(v => {
              const esHoy = v.hora_entrada.slice(0, 10) === hoy
              const ec = estadoDe(v)
              const acomps = visitantes.filter(c => c.visitante_principal_id === v.id)
              const fotos = [v.foto_url, v.foto_documento_url, v.foto_vehiculo_url].filter(Boolean).length
              const abrir = () => setDetalleId(v.id)
              return (
                /* La fila sólo resume; la ficha completa (fotos, notas, acompañantes) abre en ventana al tocarla. */
                <div key={v.id} role="button" tabIndex={0} aria-label={v.nombre}
                  onClick={abrir}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir() } }}
                  style={{ background: 'var(--at-surface)', border: `1.5px solid ${esHoy ? 'var(--at-primary-soft-2)' : 'var(--at-line)'}`, borderRadius: '12px', padding: '13px 16px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', cursor: 'pointer' }}>
                  <span aria-hidden style={{ fontSize: '22px', flexShrink: 0 }}>{v.es_menor ? '👶' : '👤'}</span>
                  <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>
                      {v.nombre}
                      {acomps.length > 0 && (
                        <span style={{ marginLeft: 8, padding: '2px 8px', background: 'var(--at-primary-tint)', color: 'var(--at-primary)', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
                          +{acomps.length}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '12.5px', color: 'var(--at-ink-3)', display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '2px' }}>
                      {v.identificacion && <span>🪪 {v.identificacion}</span>}
                      {v.placa_vehiculo && <span>🚗 {v.placa_vehiculo}</span>}
                      {v.motivo && <span>· {v.motivo}</span>}
                      {fotos > 0 && <span>📷 {fotos}</span>}
                    </div>
                    <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                      {new Date(v.hora_entrada).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}
                      {v.valido_hasta && ` · Válida hasta ${formatFechaCalendario(diaValidez(v.valido_hasta), { day: '2-digit', month: 'short' }, 'es', '—')}`}
                    </div>
                  </div>
                  <span style={{ padding: '3px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: ec.bg, color: ec.color, flexShrink: 0 }}>{ec.label}</span>
                  <span aria-hidden style={{ fontSize: 12, fontWeight: 700, color: 'var(--at-primary)', flexShrink: 0 }}>Ver ficha ›</span>
                </div>
              )
            })}
        </div>
      )}

      {/* Ficha del visitante en ventana emergente (pantalla completa en el
          teléfono): estado, cuándo se registró, vigencia, documento, placa,
          motivo, notas, fotos y acompañantes. Antes la fila era todo lo que
          había: ni fotos ni acompañantes se podían consultar. */}
      {detalle && (() => {
        const v = detalle
        const ec = estadoDe(v)
        const acomps = visitantes.filter(c => c.visitante_principal_id === v.id)
        const fotos: { label: string; src: string }[] = [
          v.foto_url ? { label: 'Visitante', src: v.foto_url } : null,
          v.foto_documento_url ? { label: 'Documento', src: v.foto_documento_url } : null,
          v.foto_vehiculo_url ? { label: 'Vehículo', src: v.foto_vehiculo_url } : null,
        ].filter((f): f is { label: string; src: string } => f !== null)
        const datos: { label: string; value: string; color?: string }[] = [
          { label: 'Estado', value: ec.label, color: ec.color },
          { label: 'Registrado', value: fechaHoraLarga(v.hora_entrada) },
        ]
        if (v.hora_salida) datos.push({ label: 'Salida', value: fechaHoraLarga(v.hora_salida) })
        datos.push({ label: 'Válida hasta', value: v.valido_hasta ? cap(formatFechaCalendario(diaValidez(v.valido_hasta), { weekday: 'long', day: '2-digit', month: 'long' }, 'es', diaValidez(v.valido_hasta))) : 'Sólo el día del registro' })
        if (v.es_menor) datos.push({ label: 'Menor de edad', value: v.fecha_nacimiento ? `Nac. ${v.fecha_nacimiento}` : 'Sí' })
        else datos.push({ label: 'Identificación', value: v.identificacion || '—' })
        datos.push({ label: 'Placa', value: v.placa_vehiculo || '—' })
        datos.push({ label: 'Motivo', value: v.motivo || '—' })
        datos.push({ label: 'Acompañantes', value: acomps.length > 0 ? String(acomps.length) : 'Ninguno' })
        if (v.autorizacion_ingreso) datos.push({ label: 'Ingreso', value: `${v.autorizacion_ingreso === 'pre_autorizado' ? 'Pre-autorizado (visita frecuente)' : 'Autorizado por el residente'}${v.autorizacion_detalle ? ` · ${v.autorizacion_detalle}` : ''}` })
        const seccion = { background: 'var(--at-surface-2)', borderRadius: 8, padding: 10, border: '1px solid var(--at-line)', marginBottom: 12 } as const
        return (
          <EditModal
            title={v.nombre}
            subtitle={
              <span style={{ display: 'inline-flex', gap: '4px 8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span aria-hidden>{v.es_menor ? '👶' : '👤'}</span>
                <span style={{ padding: '2px 9px', borderRadius: '999px', fontSize: '10.5px', fontWeight: 800, background: ec.bg, color: ec.color }}>{ec.label}</span>
                <span>📅 {new Date(v.hora_entrada).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}{v.motivo ? ` · ${v.motivo}` : ''}{acomps.length > 0 ? ` · 👥 +${acomps.length}` : ''}</span>
              </span>
            }
            size="lg"
            fullScreenOnMobile
            onClose={() => setDetalleId(null)}
            footer={
              <div className="at-ficha-acciones" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '8px', width: '100%' }}>
                <Button variant="secondary" onClick={() => setDetalleId(null)}>Cerrar</Button>
              </div>
            }
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, marginBottom: 12 }}>
              {datos.map(d => (
                <div key={d.label} style={{ background: 'var(--at-surface-2)', borderRadius: 7, padding: 8, border: '1px solid var(--at-line)', minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{d.label}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: d.color ?? 'var(--at-ink-2)', overflowWrap: 'anywhere' }}>{d.value}</div>
                </div>
              ))}
            </div>

            {v.notas && (
              <div style={seccion}>
                <div style={{ fontSize: 10, color: 'var(--at-ink-3)', marginBottom: 4 }}>Notas</div>
                <p style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 13, color: 'var(--at-ink-2)', lineHeight: 1.45, overflowWrap: 'anywhere' }}>{v.notas}</p>
              </div>
            )}

            {fotos.length > 0 && (
              <div style={seccion}>
                <div style={{ fontSize: 10, color: 'var(--at-ink-3)', marginBottom: 6 }}>Fotos</div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {fotos.map(f => (
                    <figure key={f.label} style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                      <SecureImage src={f.src} alt={`${f.label}: ${v.nombre}`} style={{ width: 110, height: 110, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--at-line)' }} />
                      <figcaption style={{ fontSize: 11, color: 'var(--at-ink-3)' }}>{f.label}</figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            )}

            {acomps.length > 0 && (
              <div style={{ ...seccion, marginBottom: 0 }}>
                <div style={{ fontSize: 10, color: 'var(--at-ink-3)', marginBottom: 6 }}>Acompañantes</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {acomps.map(a => (
                    <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 8 }}>
                      {a.foto_url
                        ? <SecureImage src={a.foto_url} alt={`Foto de ${a.nombre}`} style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: '50%', flexShrink: 0 }} />
                        : <span aria-hidden style={{ width: 36, height: 36, borderRadius: '50%', background: a.es_menor ? 'var(--at-warning-tint)' : 'var(--at-primary-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>{a.es_menor ? '👶' : '👤'}</span>}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--at-ink)' }}>{a.nombre}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--at-ink-3)' }}>
                          {a.es_menor ? `Menor${a.fecha_nacimiento ? ` · Nac. ${a.fecha_nacimiento}` : ''}` : (a.identificacion ? `DPI: ${a.identificacion}` : 'Sin documento')}
                          {a.notas ? ` · ${a.notas}` : ''}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </EditModal>
        )
      })()}
    </div>
  )
}
