import { useState, useEffect, useCallback, useRef } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../../lib/supabase'
import type { SolicitudMudanzaUnidad, TipoSolicitudMudanza, EstadoSolicitudMudanza } from '../../../types'

interface Props {
  unidadId: string
  unidadNombre: string
  proyectoId: string
  companyId: string
  clienteId: string
}

const TIPO_CFG: Record<TipoSolicitudMudanza, { label: string; icon: string; desc: string }> = {
  nueva_mudanza:    { label: 'Nueva mudanza',          icon: '🚛', desc: 'Ingreso de todos los muebles y pertenencias a la unidad' },
  ingreso_articulos:{ label: 'Ingreso de artículos',   icon: '📦', desc: 'Ingreso de artículos o muebles específicos a la unidad' },
  egreso_articulos: { label: 'Egreso de artículos',    icon: '📤', desc: 'Retiro de artículos o muebles específicos de la unidad' },
  mudanza_salida:   { label: 'Mudanza de salida',      icon: '🏁', desc: 'Retiro completo de pertenencias de la unidad' },
}

const ESTADO_CFG: Record<EstadoSolicitudMudanza, { label: string; bg: string; color: string; icon: string }> = {
  pendiente: { label: 'Pendiente', bg: '#fef3c7', color: '#d97706', icon: '⏳' },
  aprobada:  { label: 'Aprobada',  bg: '#f0fdf4', color: '#16a34a', icon: '✅' },
  rechazada: { label: 'Rechazada', bg: '#fef2f2', color: '#dc2626', icon: '❌' },
}

function blankForm() {
  return {
    tipo_mudanza: 'nueva_mudanza' as TipoSolicitudMudanza,
    fecha_solicitada: '',
    hora_solicitada: '',
    descripcion: '',
    imagenes: [] as File[],
    terminosAceptados: false,
  }
}

export function PortalMudanzaTab({ unidadId, unidadNombre, proyectoId, companyId, clienteId }: Props) {
  const [solicitudes, setSolicitudes]       = useState<SolicitudMudanzaUnidad[]>([])
  const [loading, setLoading]               = useState(true)
  const [showForm, setShowForm]             = useState(false)
  const [form, setForm]                     = useState(blankForm())
  const [saving, setSaving]                 = useState(false)
  const [terminosMudanza, setTerminosMudanza] = useState<string>('')
  const fileInputRef                        = useRef<HTMLInputElement>(null)

  const cargar = useCallback(async () => {
    if (!unidadId) return
    setLoading(true)

    // Fetch solicitudes and terms in parallel
    const [{ data: solData }, { data: termData }] = await Promise.all([
      supabase
        .from('solicitud_mudanza_unidad')
        .select('*')
        .eq('unidad_id', unidadId)
        .order('created_at', { ascending: false }),
      supabase
        .from('config_condominio')
        .select('terminos_mudanza')
        .eq('project_id', proyectoId)
        .maybeSingle(),
    ])

    setSolicitudes((solData as SolicitudMudanzaUnidad[]) ?? [])
    setTerminosMudanza(termData?.terminos_mudanza ?? '')
    setLoading(false)
  }, [unidadId, proyectoId])

  useEffect(() => { cargar() }, [cargar])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    setForm(p => {
      const combined = [...p.imagenes, ...files]
      return { ...p, imagenes: combined.slice(0, 5) }
    })
    // Reset input so same file can be re-added after removal
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function removeImage(index: number) {
    setForm(p => ({ ...p, imagenes: p.imagenes.filter((_, i) => i !== index) }))
  }

  async function enviar() {
    if (!form.fecha_solicitada) {
      Swal.fire('Error', 'La fecha propuesta es requerida.', 'error')
      return
    }
    if (terminosMudanza && !form.terminosAceptados) {
      Swal.fire('Error', 'Debes aceptar los términos de mudanza para continuar.', 'error')
      return
    }

    setSaving(true)

    // Upload images
    const uploadedUrls: string[] = []
    for (const file of form.imagenes) {
      const path = `${unidadId}/${Date.now()}_${file.name}`
      const { error: upErr } = await supabase.storage.from('mudanza-docs').upload(path, file)
      if (upErr) {
        setSaving(false)
        Swal.fire('Error', `No se pudo subir la imagen: ${upErr.message}`, 'error')
        return
      }
      const { data: urlData } = supabase.storage.from('mudanza-docs').getPublicUrl(path)
      uploadedUrls.push(urlData.publicUrl)
    }

    const payload: Record<string, unknown> = {
      company_id: companyId,
      project_id: proyectoId,
      unidad_id: unidadId,
      cliente_id: clienteId || null,
      tipo_mudanza: form.tipo_mudanza,
      fecha_solicitada: form.fecha_solicitada,
      hora_solicitada: form.hora_solicitada || null,
      descripcion: form.descripcion.trim() || null,
    }
    if (uploadedUrls.length > 0) {
      payload.imagenes = uploadedUrls
    }

    const { error } = await supabase.from('solicitud_mudanza_unidad').insert(payload)
    setSaving(false)
    if (error) { Swal.fire('Error', error.message, 'error'); return }
    Swal.fire({ icon: 'success', title: '¡Solicitud enviada!', text: 'La administración revisará tu solicitud pronto.', timer: 2000, showConfirmButton: false })
    setShowForm(false)
    setForm(blankForm())
    cargar()
  }

  const fieldStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px', fontSize: '13.5px',
    border: '1.5px solid #e2e8f0', borderRadius: '8px', outline: 'none', boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = { fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px', display: 'block' }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h3 style={{ margin: '0 0 4px', fontSize: '17px', fontWeight: 700, color: '#0f172a' }}>
            🚛 Mudanzas — {unidadNombre}
          </h3>
          <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
            Solicita autorización para mudanzas o movimiento de artículos en tu unidad.
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          style={{
            padding: '9px 18px', background: '#4f46e5', color: 'white',
            border: 'none', borderRadius: '9px', fontWeight: 600,
            fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >+ Nueva solicitud</button>
      </div>

      {/* New request form */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '16px' }}>
          <div style={{ background: 'white', borderRadius: '16px', padding: '28px', width: '100%', maxWidth: '520px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>Nueva solicitud de mudanza</h3>
              <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', color: '#94a3b8' }}>✕</button>
            </div>

            {/* Tipo selector */}
            <div style={{ marginBottom: '16px' }}>
              <label style={labelStyle}>Tipo de movimiento *</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {(Object.entries(TIPO_CFG) as [TipoSolicitudMudanza, typeof TIPO_CFG[TipoSolicitudMudanza]][]).map(([key, cfg]) => (
                  <button
                    key={key}
                    onClick={() => setForm(p => ({ ...p, tipo_mudanza: key }))}
                    style={{
                      padding: '10px 12px', borderRadius: '10px', cursor: 'pointer', textAlign: 'left',
                      border: `2px solid ${form.tipo_mudanza === key ? '#4f46e5' : '#e2e8f0'}`,
                      background: form.tipo_mudanza === key ? '#eef2ff' : 'white',
                    }}
                  >
                    <div style={{ fontSize: '18px', marginBottom: '2px' }}>{cfg.icon}</div>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: form.tipo_mudanza === key ? '#4f46e5' : '#334155' }}>{cfg.label}</div>
                    <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px', lineHeight: 1.3 }}>{cfg.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
              <div>
                <label style={labelStyle}>Fecha propuesta *</label>
                <input style={fieldStyle} type="date" value={form.fecha_solicitada} onChange={e => setForm(p => ({ ...p, fecha_solicitada: e.target.value }))} />
              </div>
              <div>
                <label style={labelStyle}>Hora aproximada</label>
                <input style={fieldStyle} type="time" value={form.hora_solicitada} onChange={e => setForm(p => ({ ...p, hora_solicitada: e.target.value }))} />
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={labelStyle}>Descripción / lista de artículos (opcional)</label>
              <textarea
                style={{ ...fieldStyle, minHeight: '80px', resize: 'vertical' }}
                value={form.descripcion}
                onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))}
                placeholder="Ej: sofá, cama king, refrigeradora…"
              />
            </div>

            {/* Image upload */}
            <div style={{ marginBottom: '16px' }}>
              <label style={labelStyle}>Fotos / documentos (opcional, máx. 5)</label>
              <div
                style={{
                  border: '1.5px dashed #c7d2fe', borderRadius: '8px', padding: '10px 12px',
                  background: '#f8f9ff', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
                }}
              >
                {form.imagenes.length < 5 && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      padding: '6px 14px', background: '#eef2ff', border: '1.5px solid #c7d2fe',
                      borderRadius: '7px', color: '#4f46e5', fontWeight: 600, fontSize: '12px', cursor: 'pointer',
                    }}
                  >
                    + Agregar imagen
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: 'none' }}
                  onChange={handleFileChange}
                />
                {form.imagenes.map((file, idx) => {
                  const url = URL.createObjectURL(file)
                  return (
                    <div key={idx} style={{ position: 'relative', width: '56px', height: '56px', flexShrink: 0 }}>
                      <img
                        src={url}
                        alt={file.name}
                        style={{ width: '56px', height: '56px', objectFit: 'cover', borderRadius: '6px', border: '1.5px solid #e2e8f0' }}
                        onLoad={() => URL.revokeObjectURL(url)}
                      />
                      <button
                        type="button"
                        onClick={() => removeImage(idx)}
                        style={{
                          position: 'absolute', top: '-6px', right: '-6px',
                          width: '18px', height: '18px', borderRadius: '50%',
                          background: '#ef4444', color: 'white', border: 'none',
                          fontSize: '10px', cursor: 'pointer', display: 'flex',
                          alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                        }}
                      >✕</button>
                    </div>
                  )
                })}
                {form.imagenes.length === 0 && (
                  <span style={{ fontSize: '12px', color: '#94a3b8' }}>Sin imágenes seleccionadas</span>
                )}
              </div>
            </div>

            {/* Terms */}
            {terminosMudanza && (
              <div style={{ marginBottom: '16px' }}>
                <label style={labelStyle}>Términos y condiciones de mudanza</label>
                <div style={{
                  background: '#f1f5f9', borderRadius: '8px', padding: '12px',
                  maxHeight: '130px', overflowY: 'auto', fontSize: '12.5px',
                  color: '#334155', lineHeight: 1.6, marginBottom: '10px',
                  border: '1px solid #e2e8f0', whiteSpace: 'pre-wrap',
                }}>
                  {terminosMudanza}
                </div>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', fontSize: '13px', color: '#0f172a', fontWeight: 500 }}>
                  <input
                    type="checkbox"
                    checked={form.terminosAceptados}
                    onChange={e => setForm(p => ({ ...p, terminosAceptados: e.target.checked }))}
                    style={{ marginTop: '2px', accentColor: '#4f46e5', width: '15px', height: '15px', flexShrink: 0 }}
                  />
                  He leído y acepto los términos de mudanza
                </label>
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowForm(false)} style={{ padding: '9px 20px', background: '#f1f5f9', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px', color: '#475569' }}>Cancelar</button>
              <button
                onClick={enviar}
                disabled={saving || (!!terminosMudanza && !form.terminosAceptados)}
                style={{
                  padding: '9px 22px', background: '#4f46e5', color: 'white', border: 'none', borderRadius: '8px',
                  cursor: (saving || (!!terminosMudanza && !form.terminosAceptados)) ? 'not-allowed' : 'pointer',
                  fontWeight: 600, fontSize: '13px',
                  opacity: (saving || (!!terminosMudanza && !form.terminosAceptados)) ? 0.6 : 1,
                }}
              >
                {saving ? 'Enviando…' : 'Enviar solicitud'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8', fontSize: '14px' }}>Cargando…</div>
      ) : solicitudes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px', color: '#94a3b8' }}>
          <div style={{ fontSize: '40px', marginBottom: '10px' }}>🚛</div>
          <div style={{ fontSize: '14px', marginBottom: '6px' }}>Sin solicitudes de mudanza</div>
          <div style={{ fontSize: '12.5px' }}>Usa el botón "+ Nueva solicitud" para solicitar autorización.</div>
        </div>
      ) : solicitudes.map(s => {
        const tipo  = TIPO_CFG[s.tipo_mudanza]
        const est   = ESTADO_CFG[s.estado]
        const fecha = s.created_at ? new Date(s.created_at).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' }) : ''
        return (
          <div key={s.id} style={{ border: '1.5px solid #e2e8f0', borderRadius: '12px', padding: '16px', marginBottom: '10px', background: 'white' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a', marginBottom: '4px' }}>
                  {tipo.icon} {tipo.label}
                </div>
                <div style={{ fontSize: '12.5px', color: '#475569' }}>
                  📅 Solicitado: {fecha}
                  {s.fecha_solicitada && <span>{'  ·  '}Propuesto: {s.fecha_solicitada}{s.hora_solicitada ? ` ${s.hora_solicitada}` : ''}</span>}
                </div>
                {s.descripcion && (
                  <div style={{ fontSize: '12.5px', color: '#64748b', marginTop: '4px' }}>{s.descripcion}</div>
                )}
              </div>
              <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 600, background: est.bg, color: est.color, whiteSpace: 'nowrap' }}>
                {est.icon} {est.label}
              </span>
            </div>

            {/* Resolution info */}
            {(s.comentario_admin || s.fecha_autorizada) && (
              <div style={{ marginTop: '10px', background: est.bg, borderRadius: '8px', padding: '10px 12px', fontSize: '12.5px', color: est.color }}>
                {s.estado === 'aprobada' && s.fecha_autorizada && (
                  <div style={{ fontWeight: 600, marginBottom: '2px' }}>
                    ✅ Fecha autorizada: {s.fecha_autorizada}{s.hora_autorizada ? ` a las ${s.hora_autorizada}` : ''}
                    {s.aprobado_por && <span style={{ fontWeight: 400, opacity: 0.8 }}> — {s.aprobado_por}</span>}
                  </div>
                )}
                {s.comentario_admin && <div>{s.comentario_admin}</div>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
