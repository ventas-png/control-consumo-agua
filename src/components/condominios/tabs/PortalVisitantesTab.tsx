import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { toast } from '../../../lib/toast'
import { ImageUploader } from '../ImageUploader'
import type { Visitante } from '../../../types'

interface Props {
  visitantes: Visitante[]
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

export function PortalVisitantesTab({ visitantes, unidadId, proyectoId, companyId, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving]     = useState(false)
  const [form, setForm]         = useState(blankForm())
  const [fotoUrl, setFotoUrl]                 = useState<string | null>(null)
  const [fotoDocumentoUrl, setFotoDocumentoUrl] = useState<string | null>(null)
  const [fotoVehiculoUrl, setFotoVehiculoUrl]   = useState<string | null>(null)
  const [acompanantes, setAcompanantes]       = useState<AcompananteForm[]>([])
  const [showAcompForm, setShowAcompForm]     = useState(false)
  const [acompForm, setAcompForm]             = useState(defaultAcompForm())

  const hoy      = new Date().toISOString().slice(0, 10)
  const recientes = visitantes.filter(v => v.hora_entrada.slice(0, 10) === hoy && !v.visitante_principal_id)

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
    const { data, error } = await supabase.from('visitantes').insert({
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
    }).select('id').single()

    if (error) { setSaving(false); toast.error(error.message); return }

    if (acompanantes.length > 0 && data) {
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
        visitante_principal_id: data.id,
      }))
      const { error: ae } = await supabase.from('visitantes').insert(acompRows)
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
    border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc',
  }
  const labelBase: React.CSSProperties = {
    fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px',
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', flexWrap: 'wrap', gap: '10px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#0f172a' }}>Mis visitantes</h3>
          {recientes.length > 0 && <p style={{ margin: '3px 0 0', fontSize: '13px', color: '#2563eb' }}>{recientes.length} visita{recientes.length > 1 ? 's' : ''} hoy</p>}
        </div>
        <button onClick={() => setShowForm(true)}
          style={{ padding: '9px 16px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '9px', fontWeight: 600, cursor: 'pointer', fontSize: '13.5px' }}>
          + Pre-autorizar visita
        </button>
      </div>

      {showForm && (
        <div
          onClick={e => { if (e.target === e.currentTarget) resetForm() }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '16px', overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'white', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '640px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>Pre-autorizar visita</h3>
              <button onClick={resetForm}
                style={{ width: 28, height: 28, borderRadius: '50%', background: '#f1f5f9', border: 'none', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', lineHeight: 1 }}>
                ×
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelBase}>Nombre completo *</label>
                <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                  placeholder="Nombre y apellido del visitante" style={inputBase} />
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.es_menor}
                      onChange={e => setForm(f => ({ ...f, es_menor: e.target.checked, identificacion: e.target.checked ? '' : f.identificacion }))} />
                    Es menor de edad
                  </label>
                  {form.es_menor && (
                    <span style={{ padding: '2px 8px', background: '#fef9c3', color: '#854d0e', borderRadius: '20px', fontSize: '11px', fontWeight: 700 }}>Menor</span>
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
                <p style={{ margin: '3px 0 0', fontSize: '11.5px', color: '#94a3b8' }}>Dejar vacío para visita de hoy únicamente</p>
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelBase}>Notas</label>
                <input value={form.notas}
                  onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                  placeholder="Opcional" style={inputBase} />
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
                  <ImageUploader value={fotoUrl} onChange={setFotoUrl} folder="visitantes" label="Foto del visitante" capture />
                  {!form.es_menor && (
                    <ImageUploader value={fotoDocumentoUrl} onChange={setFotoDocumentoUrl} folder="visitantes" label="Foto del DPI / Documento" capture />
                  )}
                  <ImageUploader value={fotoVehiculoUrl} onChange={setFotoVehiculoUrl} folder="visitantes" label="Foto del vehículo" capture />
                </div>
                <p style={{ margin: '6px 0 0', fontSize: '11.5px', color: '#94a3b8' }}>
                  Las fotos ayudan al guardia a identificar al visitante. Son opcionales.
                </p>
              </div>
            </div>

            <div style={{ marginTop: '20px', borderTop: '1.5px solid #f1f5f9', paddingTop: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#374151', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  👥 Acompañantes
                  {acompanantes.length > 0 && (
                    <span style={{ padding: '2px 8px', background: '#eff6ff', color: '#2563eb', borderRadius: '20px', fontSize: '11px', fontWeight: 700 }}>
                      {acompanantes.length}
                    </span>
                  )}
                </div>
                {!showAcompForm && (
                  <button type="button" onClick={() => setShowAcompForm(true)}
                    style={{ padding: '5px 12px', background: '#f8fafc', color: '#374151', border: '1.5px solid #e2e8f0', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                    + Agregar acompañante
                  </button>
                )}
              </div>

              {acompanantes.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px' }}>
                  {acompanantes.map(a => (
                    <div key={a.tempId} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: a.es_menor ? '#fef9c3' : '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', flexShrink: 0 }}>
                        {a.es_menor ? '👶' : '👤'}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>{a.nombre}</div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>
                          {a.es_menor
                            ? `Menor${a.fecha_nacimiento ? ` · Nac. ${a.fecha_nacimiento}` : ''}`
                            : a.identificacion ? `DPI: ${a.identificacion}` : 'Sin documento'}
                        </div>
                      </div>
                      <button type="button" onClick={() => quitarAcompanante(a.tempId)}
                        style={{ width: 22, height: 22, borderRadius: '50%', background: '#fee2e2', border: 'none', cursor: 'pointer', fontSize: '12px', color: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {showAcompForm && (
                <div style={{ padding: '14px', background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 700, color: '#374151' }}>Datos del acompañante</div>
                  <div>
                    <label style={{ fontSize: '11.5px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '3px' }}>Nombre *</label>
                    <input value={acompForm.nombre} onChange={e => setAcompForm(f => ({ ...f, nombre: e.target.value }))}
                      placeholder="Nombre completo"
                      style={{ ...inputBase, padding: '8px 10px', fontSize: '13px', background: 'white' }} />
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: '#374151', cursor: 'pointer', fontWeight: 600 }}>
                    <input type="checkbox" checked={acompForm.es_menor}
                      onChange={e => setAcompForm(f => ({ ...f, es_menor: e.target.checked, identificacion: '' }))} />
                    Es menor de edad
                    {acompForm.es_menor && <span style={{ padding: '2px 8px', background: '#fef9c3', color: '#854d0e', borderRadius: '20px', fontSize: '11px' }}>Menor</span>}
                  </label>
                  {acompForm.es_menor ? (
                    <div>
                      <label style={{ fontSize: '11.5px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '3px' }}>Fecha de nacimiento (opcional)</label>
                      <input type="date" value={acompForm.fecha_nacimiento}
                        onChange={e => setAcompForm(f => ({ ...f, fecha_nacimiento: e.target.value }))}
                        style={{ ...inputBase, padding: '8px 10px', fontSize: '13px', background: 'white' }} />
                    </div>
                  ) : (
                    <div>
                      <label style={{ fontSize: '11.5px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '3px' }}>DPI / Identificación (opcional)</label>
                      <input value={acompForm.identificacion}
                        onChange={e => setAcompForm(f => ({ ...f, identificacion: e.target.value }))}
                        placeholder="Número de documento"
                        style={{ ...inputBase, padding: '8px 10px', fontSize: '13px', background: 'white' }} />
                    </div>
                  )}
                  <div>
                    <label style={{ fontSize: '11.5px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Fotografías (opcional)</label>
                    <div style={{ display: 'grid', gridTemplateColumns: acompForm.es_menor ? '1fr' : '1fr 1fr', gap: '10px' }}>
                      <div>
                        <div style={{ fontSize: '10.5px', color: '#64748b', marginBottom: '3px' }}>Foto de la persona</div>
                        <ImageUploader value={acompForm.foto_url}
                          onChange={v => setAcompForm(f => ({ ...f, foto_url: v }))}
                          folder="visitantes" label="Foto" capture />
                      </div>
                      {!acompForm.es_menor && (
                        <div>
                          <div style={{ fontSize: '10.5px', color: '#64748b', marginBottom: '3px' }}>Foto del documento / DPI</div>
                          <ImageUploader value={acompForm.foto_documento_url}
                            onChange={v => setAcompForm(f => ({ ...f, foto_documento_url: v }))}
                            folder="visitantes" label="DPI" capture />
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="button" onClick={agregarAcompanante}
                      style={{ padding: '7px 16px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}>
                      + Agregar
                    </button>
                    <button type="button" onClick={() => { setShowAcompForm(false); setAcompForm(defaultAcompForm()) }}
                      style={{ padding: '7px 14px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
              <button onClick={preAutorizar} disabled={saving}
                style={{ padding: '10px 22px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
                {saving ? 'Autorizando...' : `✅ Pre-autorizar visita${acompanantes.length > 0 ? ` (+${acompanantes.length})` : ''}`}
              </button>
              <button onClick={resetForm}
                style={{ padding: '10px 16px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {visitantes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
          <div style={{ fontSize: '40px', marginBottom: '10px' }}>🚪</div>
          <p style={{ fontWeight: 600, color: '#64748b' }}>Sin visitantes registrados</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {visitantes
            .filter(v => !v.visitante_principal_id)
            .sort((a, b) => b.hora_entrada.localeCompare(a.hora_entrada))
            .map(v => {
              const esHoy = v.hora_entrada.slice(0, 10) === hoy
              const vigente = !v.valido_hasta || v.valido_hasta >= hoy
              const acomps = visitantes.filter(c => c.visitante_principal_id === v.id)
              return (
                <div key={v.id} style={{ background: 'white', border: `1.5px solid ${esHoy ? '#bfdbfe' : '#e2e8f0'}`, borderRadius: '12px', padding: '13px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '22px', flexShrink: 0 }}>{v.es_menor ? '👶' : '👤'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>
                      {v.nombre}
                      {acomps.length > 0 && (
                        <span style={{ marginLeft: 8, padding: '2px 8px', background: '#eff6ff', color: '#2563eb', borderRadius: 20, fontSize: 11, fontWeight: 700 }}>
                          +{acomps.length}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '12.5px', color: '#64748b', display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '2px' }}>
                      {v.identificacion && <span>🪪 {v.identificacion}</span>}
                      {v.placa_vehiculo && <span>🚗 {v.placa_vehiculo}</span>}
                      {v.motivo && <span>· {v.motivo}</span>}
                    </div>
                    <div style={{ fontSize: '11.5px', color: '#94a3b8', marginTop: '2px' }}>
                      {new Date(v.hora_entrada).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}
                      {v.valido_hasta && ` · Válida hasta ${new Date(v.valido_hasta + 'T12:00:00').toLocaleDateString('es', { day: '2-digit', month: 'short' })}`}
                    </div>
                  </div>
                  {esHoy && <span style={{ padding: '3px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#eff6ff', color: '#2563eb', flexShrink: 0 }}>Hoy</span>}
                  {!esHoy && vigente && <span style={{ padding: '3px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#f0fdf4', color: '#16a34a', flexShrink: 0 }}>Vigente</span>}
                  {!vigente && !esHoy && <span style={{ padding: '3px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#f8fafc', color: '#94a3b8', flexShrink: 0 }}>Expirada</span>}
                </div>
              )
            })}
        </div>
      )}
    </div>
  )
}
