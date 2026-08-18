import { hoyLocalISO, mesLocalISO } from '../../../lib/format'
import { useState, useMemo } from 'react'
import { notify } from '../../shared/Dialog'
import { createCondominioRow } from '../../../domain/condominios/tabMutations'
import { PlantillaMensajeCond, CuotaCondominio, Unidad, ReservaAmenidad, CanalPlantilla } from '../../../types'

interface Props {
  plantillas: PlantillaMensajeCond[]
  cuotas: CuotaCondominio[]
  unidades: Unidad[]
  reservas: ReservaAmenidad[]
  proyectoId: string
  companyId: string
  moneda: string
  proyectoNombre?: string
  onRefresh: () => void
}

type SegmentoEnvio = 'todos' | 'morosos' | 'con_reserva' | 'deuda_alta'

const SEGMENTO_CFG: Record<SegmentoEnvio, { label: string; icon: string; desc: string }> = {
  todos:        { label: 'Todos los residentes',    icon: '👥', desc: 'Todas las unidades del proyecto' },
  morosos:      { label: 'Morosos',                 icon: '⚠️', desc: 'Unidades con cuotas vencidas' },
  con_reserva:  { label: 'Con reserva activa',      icon: '🏊', desc: 'Unidades con reservas confirmadas o pendientes' },
  deuda_alta:   { label: 'Deuda alta (>3 cuotas)',  icon: '🚨', desc: 'Unidades con más de 3 cuotas vencidas' },
}

const CANAL_CFG: Record<CanalPlantilla, { label: string; icon: string; color: string }> = {
  whatsapp: { label: 'WhatsApp', icon: '💬', color: 'var(--at-success)' },
  email:    { label: 'Email',    icon: '📧', color: 'var(--at-primary)' },
  sms:      { label: 'SMS',      icon: '📱', color: 'var(--at-accent-hover)' },
}

function resolverVariables(cuerpo: string, unidad: Unidad, cuotasU: CuotaCondominio[], moneda: string, proyecto = ''): string {
  const hoy = hoyLocalISO()
  const vencidas = cuotasU.filter(c => (c.estado === 'pendiente' || c.estado === 'moroso') && c.fecha_vencimiento && c.fecha_vencimiento < hoy)
  const saldo = cuotasU.filter(c => c.estado !== 'pagado').reduce((s, c) => s + c.monto, 0)
  const ultimaVenc = vencidas.length > 0 ? vencidas[0].fecha_vencimiento ?? '' : ''
  const diasMora = ultimaVenc ? Math.floor((Date.now() - new Date(ultimaVenc).getTime()) / 86400000) : 0

  return cuerpo
    .replace(/\{\{nombre_residente\}\}/g, unidad.nombre)
    .replace(/\{\{unidad\}\}/g, unidad.nombre)
    .replace(/\{\{monto\}\}/g, `${moneda} ${saldo.toFixed(2)}`)
    .replace(/\{\{fecha_vencimiento\}\}/g, ultimaVenc || hoy)
    .replace(/\{\{periodo\}\}/g, mesLocalISO())
    .replace(/\{\{dias_mora\}\}/g, String(diasMora))
    .replace(/\{\{proyecto\}\}/g, proyecto)
}

export default function EnvioMasivoTab({ plantillas, cuotas, unidades, reservas, proyectoId, companyId, moneda, proyectoNombre, onRefresh }: Props) {
  const hoy = hoyLocalISO()
  const [plantillaId, setPlantillaId] = useState('')
  const [segmento, setSegmento] = useState<SegmentoEnvio>('todos')
  const [previewUnidadId, setPreviewUnidadId] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [paso, setPaso] = useState<1 | 2 | 3>(1)

  const plantilla = plantillas.find(p => p.id === plantillaId)
  const plantillasActivas = plantillas.filter(p => p.activa)

  const destinatarios = useMemo<Unidad[]>(() => {
    if (segmento === 'todos') return unidades
    if (segmento === 'morosos') {
      const conMora = new Set(cuotas.filter(c => (c.estado === 'pendiente' || c.estado === 'moroso') && c.fecha_vencimiento && c.fecha_vencimiento < hoy).map(c => c.unidad_id))
      return unidades.filter(u => conMora.has(u.id))
    }
    if (segmento === 'con_reserva') {
      const conRes = new Set(reservas.filter(r => r.estado === 'confirmada' || r.estado === 'pendiente').map(r => r.unidad_id))
      return unidades.filter(u => conRes.has(u.id))
    }
    if (segmento === 'deuda_alta') {
      const moraPorUnidad: Record<string, number> = {}
      cuotas.filter(c => (c.estado === 'pendiente' || c.estado === 'moroso') && c.fecha_vencimiento && c.fecha_vencimiento < hoy).forEach(c => {
        if (c.unidad_id) moraPorUnidad[c.unidad_id] = (moraPorUnidad[c.unidad_id] ?? 0) + 1
      })
      return unidades.filter(u => (moraPorUnidad[u.id] ?? 0) > 3)
    }
    return unidades
  }, [segmento, unidades, cuotas, reservas, hoy])

  const previewUnidad = previewUnidadId ? unidades.find(u => u.id === previewUnidadId) : destinatarios[0]

  const previews = useMemo(() => {
    if (!plantilla || destinatarios.length === 0) return []
    return destinatarios.slice(0, 5).map(u => ({
      unidad: u,
      mensaje: resolverVariables(plantilla.cuerpo, u, cuotas.filter(c => c.unidad_id === u.id), moneda, proyectoNombre),
    }))
    // proyectoNombre alimenta {{proyecto}} dentro de resolverVariables: sin él
    // en deps, la vista previa se quedaba con el nombre del proyecto anterior.
  }, [plantilla, destinatarios, cuotas, moneda, proyectoNombre])

  async function enviar() {
    if (!plantilla || destinatarios.length === 0) return
    setEnviando(true)

    const rows = destinatarios.map(u => ({
      company_id: companyId,
      project_id: proyectoId,
      unidad_id: u.id,
      canal: plantilla.canal,
      plantilla_id: plantilla.id,
      mensaje: resolverVariables(plantilla.cuerpo, u, cuotas.filter(c => c.unidad_id === u.id), moneda, proyectoNombre),
      estado: 'enviado',
      fecha_envio: new Date().toISOString(),
    }))

    const { error } = await createCondominioRow('notificaciones_enviadas', rows)
    setEnviando(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    onRefresh()
    setPaso(3)
  }

  const canalCfg = plantilla ? CANAL_CFG[plantilla.canal] : null

  return (
    <div style={{ padding: 16 }}>
      {/* Stepper */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20, gap: 0 }}>
        {[
          { n: 1, label: 'Plantilla' },
          { n: 2, label: 'Vista previa' },
          { n: 3, label: 'Enviado' },
        ].map((s, i) => (
          <div key={s.n} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: paso >= s.n ? 'var(--at-primary)' : 'var(--at-line)', color: paso >= s.n ? 'white' : 'var(--at-ink-3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>
                {paso > s.n ? '✓' : s.n}
              </div>
              <div style={{ fontSize: 10, color: paso >= s.n ? 'var(--at-primary)' : 'var(--at-ink-3)', fontWeight: 600, marginTop: 3 }}>{s.label}</div>
            </div>
            {i < 2 && <div style={{ height: 2, flex: 1, background: paso > s.n ? 'var(--at-primary)' : 'var(--at-line)', margin: '0 4px', marginBottom: 16 }} />}
          </div>
        ))}
      </div>

      {paso === 1 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* Plantilla */}
          <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>1. Selecciona la plantilla</div>
            {plantillasActivas.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: 30, fontSize: 12 }}>
                No hay plantillas activas. Crea una en la pestaña "Plantillas msg."
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {plantillasActivas.map(p => {
                  const c = CANAL_CFG[p.canal]
                  const sel = plantillaId === p.id
                  return (
                    <div key={p.id} onClick={() => setPlantillaId(p.id)}
                      style={{ padding: '10px 12px', border: `1.5px solid ${sel ? c.color : 'var(--at-line)'}`, borderRadius: 8, cursor: 'pointer', background: sel ? c.color + '11' : 'var(--at-surface-2)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: c.color }}>{c.icon} {c.label}</span>
                      </div>
                      <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--at-ink)' }}>{p.nombre}</div>
                      <div style={{ fontSize: 10, color: 'var(--at-ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.cuerpo.slice(0, 60)}…</div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Segmento */}
          <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>2. Selecciona el segmento</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(Object.keys(SEGMENTO_CFG) as SegmentoEnvio[]).map(s => {
                const cfg = SEGMENTO_CFG[s]
                const count = s === 'todos' ? unidades.length
                  : s === 'morosos' ? new Set(cuotas.filter(c => (c.estado === 'pendiente' || c.estado === 'moroso') && c.fecha_vencimiento && c.fecha_vencimiento < hoy).map(c => c.unidad_id)).size
                  : s === 'con_reserva' ? new Set(reservas.filter(r => r.estado === 'confirmada' || r.estado === 'pendiente').map(r => r.unidad_id)).size
                  : unidades.filter(u => (cuotas.filter(c => c.unidad_id === u.id && (c.estado === 'pendiente' || c.estado === 'moroso') && c.fecha_vencimiento && c.fecha_vencimiento < hoy).length) > 3).length
                const sel = segmento === s
                return (
                  <div key={s} onClick={() => setSegmento(s)}
                    style={{ padding: '10px 12px', border: `1.5px solid ${sel ? 'var(--at-primary)' : 'var(--at-line)'}`, borderRadius: 8, cursor: 'pointer', background: sel ? 'var(--at-primary-tint)' : 'var(--at-surface-2)', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 18 }}>{cfg.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 12, color: sel ? 'var(--at-primary-hover)' : 'var(--at-ink)' }}>{cfg.label}</div>
                      <div style={{ fontSize: 10, color: 'var(--at-ink-3)' }}>{cfg.desc}</div>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: sel ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>{count}</div>
                  </div>
                )
              })}
            </div>

            <div style={{ marginTop: 14 }}>
              <button onClick={() => setPaso(2)} disabled={!plantillaId || destinatarios.length === 0}
                style={{ width: '100%', padding: '10px 0', background: !plantillaId || destinatarios.length === 0 ? 'var(--at-ink-3)' : 'var(--at-primary)', color: 'white', border: 'none', borderRadius: 8, cursor: !plantillaId || destinatarios.length === 0 ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 700 }}>
                Ver vista previa → ({destinatarios.length} destinatarios)
              </button>
            </div>
          </div>
        </div>
      )}

      {paso === 2 && plantilla && (
        <div>
          <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: 12, padding: 16, marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 13 }}>Vista previa del envío</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setPaso(1)} style={{ padding: '6px 14px', border: '1px solid var(--at-line)', borderRadius: 7, cursor: 'pointer', fontSize: 12, background: 'var(--at-surface-2)' }}>← Volver</button>
                <button onClick={enviar} disabled={enviando}
                  style={{ padding: '6px 18px', background: canalCfg?.color, color: 'white', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 700, opacity: enviando ? 0.7 : 1 }}>
                  {enviando ? 'Registrando…' : `${canalCfg?.icon} Enviar a ${destinatarios.length} unidades`}
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              {previews.map(p => (
                <button key={p.unidad.id} onClick={() => setPreviewUnidadId(p.unidad.id)}
                  style={{ padding: '4px 10px', border: `1px solid ${previewUnidad?.id === p.unidad.id ? canalCfg?.color ?? 'var(--at-primary)' : 'var(--at-line)'}`, borderRadius: 6, cursor: 'pointer', fontSize: 11, background: previewUnidad?.id === p.unidad.id ? (canalCfg?.color ?? 'var(--at-primary)') + '11' : 'var(--at-surface-2)' }}>
                  {p.unidad.nombre}
                </button>
              ))}
              {destinatarios.length > 5 && <span style={{ fontSize: 11, color: 'var(--at-ink-3)', alignSelf: 'center' }}>+{destinatarios.length - 5} más</span>}
            </div>

            {previewUnidad && plantilla && (
              <div style={{ background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginBottom: 6 }}>
                  {canalCfg?.icon} {canalCfg?.label} → <strong>{previewUnidad.nombre}</strong>
                  {plantilla.asunto && <span> · Asunto: {plantilla.asunto}</span>}
                </div>
                <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.6, color: 'var(--at-ink)' }}>
                  {resolverVariables(plantilla.cuerpo, previewUnidad, cuotas.filter(c => c.unidad_id === previewUnidad.id), moneda, proyectoNombre)}
                </div>
              </div>
            )}
          </div>

          <div style={{ padding: '8px 14px', background: 'var(--at-warning-tint)', borderRadius: 8, fontSize: 11, color: 'var(--at-warning)' }}>
            ⚠️ El sistema registra el envío en el log de notificaciones. La entrega real depende de la integración con WhatsApp/Email/SMS configurada en la plataforma de comunicaciones.
          </div>
        </div>
      )}

      {paso === 3 && (
        <div>
          <div style={{ textAlign: 'center', padding: '32px 0 20px' }}>
            <div style={{ fontSize: 48, marginBottom: 10 }}>✅</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--at-success)', marginBottom: 6 }}>Envío registrado</div>
            <div style={{ fontSize: 13, color: 'var(--at-ink-3)', marginBottom: 20 }}>
              Se registraron <strong>{destinatarios.length}</strong> mensajes en el log de notificaciones enviadas.
            </div>
            <button onClick={() => { setPaso(1); setPlantillaId(''); }}
              style={{ padding: '9px 22px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
              Nuevo envío
            </button>
          </div>

          {plantilla?.canal === 'whatsapp' && destinatarios.length > 0 && (
            <div style={{ background: 'var(--at-success-tint)', border: '1px solid var(--at-success-border)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--at-success-strong)', marginBottom: 4 }}>
                💬 Links directos de WhatsApp
              </div>
              <div style={{ fontSize: 11, color: 'var(--at-success)', marginBottom: 12 }}>
                Haz clic en cada botón para abrir WhatsApp con el mensaje pre-cargado. Selecciona el contacto al abrir.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 340, overflowY: 'auto' }}>
                {destinatarios.map(u => {
                  const msg = resolverVariables(plantilla.cuerpo, u, cuotas.filter(c => c.unidad_id === u.id), moneda)
                  const url = `https://wa.me/?text=${encodeURIComponent(msg)}`
                  return (
                    <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--at-surface)', border: '1px solid var(--at-success-border)', borderRadius: 8 }}>
                      <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'var(--at-ink)' }}>{u.nombre}</span>
                      <a href={url} target="_blank" rel="noreferrer"
                        style={{ padding: '5px 12px', background: 'var(--at-success)', color: 'var(--at-on-status)', borderRadius: 6, fontSize: 11, fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                        💬 Abrir WhatsApp
                      </a>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
