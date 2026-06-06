import { useState } from 'react'
import { confirm, notify } from '../../shared/Dialog'
import { openPromptDialog } from '../../shared/PromptDialog'
import {
  createCondominioRow,
  createCondominioRowReturning,
  updateCondominioRow,
  deleteCondominioRow,
} from '../../../domain/condominios/tabMutations'
import { fetchVisitantesPorDpi } from '../../../domain/condominios/tabQueries'
import { validatedInsert } from '../../../lib/validatedInsert'
import { visitanteInputSchema } from '../../../domain/condominios/schemas'
import { SecureImage } from '../../shared/SecureImage'
import { SecureFileLink } from '../../shared/SecureFileLink'
import type {
  RondaSeguridad, NovedadSeguridad, TipoNovedad, PrioridadNovedad, EstadoRonda,
  RutaRonda, PuntoControlRuta, VisitaControl, EstadoVisitaControl,
  Visitante, Unidad, ReservaSTR,
} from '../../../types'

const PLATAFORMA_LABEL: Record<string, string> = {
  airbnb: 'Airbnb', booking: 'Booking.com', vrbo: 'VRBO', directo: 'Directo', otro: 'Otro',
}

const PLATAFORMA_COLOR: Record<string, { bg: string; color: string }> = {
  airbnb:   { bg: 'var(--at-danger-tint)', color: '#e11d48' },
  booking:  { bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' },
  vrbo:     { bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  directo:  { bg: 'var(--at-accent-tint-2)', color: 'var(--at-accent-hover)' },
  otro:     { bg: 'var(--at-surface-2)', color: 'var(--at-ink-2)' },
}
import { ImageUploader, MultiImageUploader } from '../../shared/ImageUploader'

interface Props {
  rondas: RondaSeguridad[]
  novedades: NovedadSeguridad[]
  rutas: RutaRonda[]
  puntosControl: PuntoControlRuta[]
  visitasControl: VisitaControl[]
  visitantes: Visitante[]
  unidades: Unidad[]
  reservasSTR: ReservaSTR[]
  proyectoId: string
  companyId: string
  userId: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const PRIORIDAD_CONFIG: Record<PrioridadNovedad, { label: string; bg: string; color: string }> = {
  normal:  { label: 'Normal',  bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  alta:    { label: 'Alta',    bg: 'var(--at-warning-tint)', color: 'var(--at-warning)' },
  critica: { label: 'Crítica', bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
}

const TIPO_NOVEDAD_CONFIG: Record<TipoNovedad, { label: string; icon: string }> = {
  incidente:   { label: 'Incidente',   icon: '🚨' },
  observacion: { label: 'Observación', icon: '👁' },
  alarma:      { label: 'Alarma',      icon: '🔔' },
  acceso:      { label: 'Acceso',      icon: '🚪' },
  otro:        { label: 'Otro',        icon: '📋' },
}

const ESTADO_RONDA: Record<EstadoRonda, { label: string; bg: string; color: string }> = {
  en_curso:   { label: 'En curso',   bg: 'var(--at-primary-tint)', color: 'var(--at-primary)' },
  completada: { label: 'Completada', bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  incompleta: { label: 'Incompleta', bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
}

const VISITA_CONFIG: Record<EstadoVisitaControl, { label: string; icon: string; bg: string; color: string }> = {
  pendiente: { label: 'Pendiente', icon: '⏳', bg: 'var(--at-surface-2)',  color: 'var(--at-ink-3)' },
  ok:        { label: 'OK',        icon: '✅', bg: 'var(--at-success-tint)',  color: 'var(--at-success)' },
  novedad:   { label: 'Novedad',   icon: '⚠️', bg: 'var(--at-warning-tint)',  color: 'var(--at-warning)' },
  omitido:   { label: 'Omitido',   icon: '⏭',  bg: 'var(--at-accent-tint-2)',  color: 'var(--at-accent-hover)' },
}

export function SeguridadTab({
  rondas, novedades, rutas, puntosControl, visitasControl,
  visitantes: _visitantes, unidades, reservasSTR,
  proyectoId, companyId, userId, canCreate, canEdit, onRefresh,
}: Props) {
  const [vista, setVista] = useState<'novedades' | 'rondas'>('novedades')
  const [showAccesosModal, setShowAccesosModal] = useState(false)
  const [showNovedadForm, setShowNovedadForm] = useState(false)
  const [showRondaForm, setShowRondaForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [filtroPrioridad, setFiltroPrioridad] = useState<PrioridadNovedad | 'todos'>('todos')
  const [novedadDetalle, setNovedadDetalle] = useState<NovedadSeguridad | null>(null)

  const [novedadForm, setNovedadForm] = useState({
    tipo: 'observacion' as TipoNovedad, descripcion: '', ubicacion: '',
    prioridad: 'normal' as PrioridadNovedad, ronda_id: '',
  })
  const [fotosNovedadForm, setFotosNovedadForm] = useState<string[]>([])
  const [rondaForm, setRondaForm] = useState({ notas: '', ruta_id: '' })

  // Accesos / verificación visitante
  const [modoModal, setModoModal] = useState<'dpi' | 'str'>('dpi')
  const [strSearch, setStrSearch] = useState('')
  const [dpiSearch, setDpiSearch] = useState('')
  const [searchResult, setSearchResult] = useState<'idle' | 'found' | 'not_found'>('idle')
  const [searchResultVisitantes, setSearchResultVisitantes] = useState<Visitante[]>([])
  const [searching, setSearching] = useState(false)
  const [showRegForm, setShowRegForm] = useState(false)
  const [regSaving, setRegSaving] = useState(false)
  const [fotoPersonaUrl, setFotoPersonaUrl] = useState<string | null>(null)
  const [fotoDocumentoUrl, setFotoDocumentoUrl] = useState<string | null>(null)
  const [fotoVehiculoUrl, setFotoVehiculoUrl] = useState<string | null>(null)
  const [fotosExpiradas, setFotosExpiradas] = useState<{ foto: boolean; documento: boolean; vehiculo: boolean }>({ foto: false, documento: false, vehiculo: false })
  const [regForm, setRegForm] = useState({
    nombre: '', unidad_id: '', placa_vehiculo: '', motivo: '', notas: '', identificacion: '',
  })
  const [strReservaId, setStrReservaId] = useState<string | null>(null)
  const [strIngresados, setStrIngresados] = useState<Set<string>>(new Set())

  const novedadesFiltradas = novedades.filter(n =>
    filtroPrioridad === 'todos' || n.prioridad === filtroPrioridad
  )

  const rondaEnCurso = rondas.find(r => r.estado === 'en_curso')
  const hoy = new Date().toISOString().slice(0, 10)
  const novedadesHoy = novedades.filter(n => n.created_at.startsWith(hoy))
  const criticas = novedades.filter(n => n.prioridad === 'critica').length

  // Checklist de la ronda en curso
  const visitasRondaActual = rondaEnCurso
    ? visitasControl.filter(v => v.ronda_id === rondaEnCurso.id)
    : []
  const puntosRondaActual = rondaEnCurso?.ruta_id
    ? puntosControl.filter(p => p.ruta_id === rondaEnCurso.ruta_id).sort((a, b) => a.orden - b.orden)
    : []
  const puntosCompletados = visitasRondaActual.filter(v => v.estado !== 'pendiente').length
  const progreso = puntosRondaActual.length > 0 ? Math.round((puntosCompletados / puntosRondaActual.length) * 100) : 0

  const rutasActivas = rutas.filter(r => r.activo)

  async function iniciarRonda() {
    setSaving(true)
    const { data: rondaData, error } = await createCondominioRowReturning('rondas_seguridad', {
      company_id: companyId, project_id: proyectoId,
      guardia_id: userId, estado: 'en_curso',
      ruta_id: rondaForm.ruta_id || null,
      notas: rondaForm.notas.trim() || null,
    })
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); setSaving(false); return }

    // Si se seleccionó una ruta, crear las visitas_control para cada punto
    if (rondaForm.ruta_id && rondaData) {
      const puntos = puntosControl.filter(p => p.ruta_id === rondaForm.ruta_id).sort((a, b) => a.orden - b.orden)
      if (puntos.length > 0) {
        await createCondominioRow('visitas_control',
          puntos.map(p => ({ ronda_id: rondaData.id as string, punto_id: p.id, estado: 'pendiente' }))
        )
      }
    }
    setSaving(false); setRondaForm({ notas: '', ruta_id: '' }); setShowRondaForm(false)
    onRefresh()
  }

  async function finalizarRonda(id: string, estado: EstadoRonda) {
    await updateCondominioRow('rondas_seguridad', id, { estado, fin: new Date().toISOString() })
    onRefresh()
  }

  async function marcarVisita(visitaId: string, estado: EstadoVisitaControl, notas?: string) {
    await updateCondominioRow('visitas_control', visitaId, {
      estado, notas: notas ?? null,
      visitado_en: estado !== 'pendiente' ? new Date().toISOString() : null,
    })
    onRefresh()
  }

  async function marcarVisitaConNovedad(visitaId: string) {
    const result = await openPromptDialog({
      title: 'Registrar novedad en este punto',
      fields: [{
        name: 'notas',
        label: 'Novedad',
        control: 'textarea',
        rows: 4,
        placeholder: 'Describe la novedad encontrada...',
        required: true,
        autoFocus: true,
      }],
      submitText: 'Registrar',
    })
    if (!result) return
    await marcarVisita(visitaId, 'novedad', result.notas)
  }

  async function registrarNovedad() {
    if (!novedadForm.descripcion.trim()) { notify({ variant: 'error', title: 'Error', text: 'Ingrese la descripción.' }); return }
    setSaving(true)
    const { error } = await createCondominioRow('novedades_seguridad', {
      company_id: companyId, project_id: proyectoId,
      ronda_id: novedadForm.ronda_id || null,
      tipo: novedadForm.tipo, descripcion: novedadForm.descripcion.trim(),
      ubicacion: novedadForm.ubicacion.trim() || null,
      prioridad: novedadForm.prioridad, reportado_por: userId,
      foto_url: fotosNovedadForm[0] ?? null,
      fotos: fotosNovedadForm.length > 0 ? fotosNovedadForm : null,
    })
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    notify({ variant: 'success', title: 'Novedad registrada', duration: 1400 })
    setNovedadForm({ tipo: 'observacion', descripcion: '', ubicacion: '', prioridad: 'normal', ronda_id: '' })
    setFotosNovedadForm([])
    setShowNovedadForm(false); onRefresh()
  }

  async function eliminarNovedad(id: string) {
    const r = await confirm({ title: '¿Eliminar novedad?', icon: 'warning', variant: 'danger', confirmText: 'Eliminar' })
    if (!r.isConfirmed) return
    await deleteCondominioRow('novedades_seguridad', id)
    onRefresh()
  }

  function resetAccesos() {
    setModoModal('dpi')
    setStrSearch('')
    setDpiSearch('')
    setSearchResult('idle')
    setSearchResultVisitantes([])
    setShowRegForm(false)
    setRegForm({ nombre: '', unidad_id: '', placa_vehiculo: '', motivo: '', notas: '', identificacion: '' })
    setFotoPersonaUrl(null)
    setFotoDocumentoUrl(null)
    setFotoVehiculoUrl(null)
    setFotosExpiradas({ foto: false, documento: false, vehiculo: false })
    setStrReservaId(null)
    setStrIngresados(new Set())
    setShowAccesosModal(false)
  }

  function cambiarModo(modo: 'dpi' | 'str') {
    setModoModal(modo)
    setStrSearch('')
    setDpiSearch('')
    setSearchResult('idle')
    setSearchResultVisitantes([])
    setShowRegForm(false)
    setRegForm({ nombre: '', unidad_id: '', placa_vehiculo: '', motivo: '', notas: '', identificacion: '' })
    setFotoPersonaUrl(null)
    setFotoDocumentoUrl(null)
    setFotoVehiculoUrl(null)
    setFotosExpiradas({ foto: false, documento: false, vehiculo: false })
    setStrReservaId(null)
  }

  function precargarDesdeSTR(r: ReservaSTR) {
    const noches = Math.max(0, Math.round((new Date(r.fecha_salida).getTime() - new Date(r.fecha_entrada).getTime()) / 86400000))
    setStrReservaId(r.id)
    setRegForm({
      nombre: r.huesped_nombre,
      unidad_id: r.unidad_id ?? '',
      placa_vehiculo: '',
      motivo: `Renta corta · ${PLATAFORMA_LABEL[r.plataforma] ?? r.plataforma}`,
      notas: `Entrada: ${r.fecha_entrada} · Salida: ${r.fecha_salida} (${noches} noche${noches !== 1 ? 's' : ''})`,
      identificacion: '',
    })
    setFotoPersonaUrl(null)
    setFotoDocumentoUrl(null)
    setFotoVehiculoUrl(null)
    setShowRegForm(true)
  }

  async function buscarPorDpi() {
    const dpi = dpiSearch.trim()
    if (!dpi) return
    setSearching(true)
    setSearchResult('idle')
    setSearchResultVisitantes([])
    setShowRegForm(false)
    const { data, error } = await fetchVisitantesPorDpi<Visitante & { unidades?: { nombre: string } }>(companyId, dpi)
    setSearching(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    if (data && data.length > 0) {
      const mapped = data.map((v: Visitante & { unidades?: { nombre: string } }) => ({ ...v, unidad_nombre: v.unidades?.nombre }))
      setSearchResultVisitantes(mapped)
      setSearchResult('found')
      const latest = mapped[0]
      setRegForm({
        nombre: latest.nombre,
        identificacion: latest.identificacion ?? dpi,
        placa_vehiculo: latest.placa_vehiculo ?? '',
        motivo: '',
        notas: '',
        unidad_id: '',
      })
      setFotoPersonaUrl(latest.foto_url ?? null)
      setFotoDocumentoUrl(latest.foto_documento_url ?? null)
      setFotoVehiculoUrl(latest.foto_vehiculo_url ?? null)
      const DIAS_90 = 90 * 24 * 60 * 60 * 1000
      const ahora = Date.now()
      const esVencida = (r: Visitante | undefined) => !!r && (ahora - new Date(r.hora_entrada).getTime()) > DIAS_90
      setFotosExpiradas({
        foto:      esVencida(mapped.find((r: Visitante) => r.foto_url)),
        documento: esVencida(mapped.find((r: Visitante) => r.foto_documento_url)),
        vehiculo:  esVencida(mapped.find((r: Visitante) => r.foto_vehiculo_url)),
      })
    } else {
      setSearchResult('not_found')
      setRegForm(f => ({ ...f, identificacion: dpi }))
      setShowRegForm(true)
    }
  }

  async function handleRegistrarAcceso() {
    if (!regForm.nombre.trim()) { notify({ variant: 'error', title: 'Error', text: 'Ingrese el nombre del visitante.' }); return }
    if (!regForm.unidad_id) { notify({ variant: 'error', title: 'Error', text: 'Seleccione la unidad a visitar.' }); return }
    setRegSaving(true)
    // cond:C2 — pre-validación Zod en boundary de persistencia.
    const { error } = await validatedInsert('visitantes', visitanteInputSchema, {
      company_id: companyId,
      project_id: proyectoId,
      unidad_id: regForm.unidad_id,
      nombre: regForm.nombre.trim(),
      identificacion: regForm.identificacion.trim() || null,
      placa_vehiculo: regForm.placa_vehiculo.trim() || null,
      motivo: regForm.motivo.trim() || null,
      notas: regForm.notas.trim() || null,
      foto_url: fotoPersonaUrl,
      foto_documento_url: fotoDocumentoUrl,
      foto_vehiculo_url: fotoVehiculoUrl,
      registrado_por: userId,
      hora_entrada: new Date().toISOString(),
    })
    setRegSaving(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error.message }); return }
    if (strReservaId) {
      setStrIngresados(prev => new Set([...prev, strReservaId]))
      setStrReservaId(null)
    }
    notify({ variant: 'success', title: 'Entrada registrada', duration: 1500 })
    resetAccesos()
    onRefresh()
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--at-ink)' }}>Seguridad</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--at-ink-3)', fontSize: '13.5px' }}>
            {novedadesHoy.length} novedades hoy
            {criticas > 0 && <span style={{ color: 'var(--at-danger)', fontWeight: 700 }}> · {criticas} críticas</span>}
            {rondaEnCurso && <span style={{ color: 'var(--at-primary)', fontWeight: 600 }}> · Ronda en curso</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button onClick={() => setShowAccesosModal(true)} style={{ padding: '9px 16px', background: 'var(--at-accent-tint-2)', color: 'var(--at-accent-hover)', border: '1.5px solid var(--at-accent-soft-2)', borderRadius: '9px', fontWeight: 600, cursor: 'pointer', fontSize: '13.5px' }}>
            🚪 Verificar acceso
          </button>
          {canCreate && (
            <>
              <button onClick={() => setShowNovedadForm(true)} style={{ padding: '9px 16px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '9px', fontWeight: 600, cursor: 'pointer', fontSize: '13.5px' }}>
                + Novedad
              </button>
              {!rondaEnCurso && (
                <button onClick={() => setShowRondaForm(true)} style={{ padding: '9px 16px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: '1.5px solid var(--at-line)', borderRadius: '9px', fontWeight: 600, cursor: 'pointer', fontSize: '13.5px' }}>
                  🛡 Iniciar ronda
                </button>
              )}
              {rondaEnCurso && (
                <button onClick={() => finalizarRonda(rondaEnCurso.id, 'completada')} style={{ padding: '9px 16px', background: 'var(--at-success-tint)', color: 'var(--at-success)', border: '1.5px solid var(--at-success-border)', borderRadius: '9px', fontWeight: 600, cursor: 'pointer', fontSize: '13.5px' }}>
                  ✓ Finalizar ronda
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Ronda en curso banner */}
      {rondaEnCurso && (
        <div style={{ background: 'var(--at-primary-tint)', border: '1px solid var(--at-primary-soft-2)', borderRadius: '12px', padding: '14px 16px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: puntosRondaActual.length > 0 ? '12px' : '0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '18px' }}>🛡️</span>
              <div>
                <span style={{ fontSize: '13.5px', color: 'var(--at-primary-hover)', fontWeight: 600 }}>
                  Ronda en curso desde {new Date(rondaEnCurso.inicio).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                </span>
                {rondaEnCurso.ruta_id && rutas.find(r => r.id === rondaEnCurso.ruta_id) && (
                  <span style={{ display: 'block', fontSize: '12px', color: 'var(--at-primary-2)' }}>
                    🗺 {rutas.find(r => r.id === rondaEnCurso.ruta_id)?.nombre}
                  </span>
                )}
              </div>
            </div>
            {canEdit && (
              <button onClick={() => finalizarRonda(rondaEnCurso.id, 'incompleta')}
                style={{ padding: '5px 12px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: '1px solid var(--at-danger-border)', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                Marcar incompleta
              </button>
            )}
          </div>

          {/* Checklist de puntos de la ronda */}
          {puntosRondaActual.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                <div style={{ flex: 1, height: '8px', background: 'var(--at-primary-soft)', borderRadius: '99px', overflow: 'hidden' }}>
                  <div style={{ width: `${progreso}%`, height: '100%', background: progreso === 100 ? 'var(--at-success)' : 'var(--at-primary-2)', borderRadius: '99px', transition: 'width .4s' }} />
                </div>
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-primary-hover)', whiteSpace: 'nowrap' }}>{puntosCompletados}/{puntosRondaActual.length} puntos ({progreso}%)</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {puntosRondaActual.map((punto, idx) => {
                  const visita = visitasRondaActual.find(v => v.punto_id === punto.id)
                  const vc = visita ? VISITA_CONFIG[visita.estado] : VISITA_CONFIG['pendiente']
                  const area = punto.area_nombre ?? punto.area_id
                  const icono = punto.area_icono ?? '📍'
                  return (
                    <div key={punto.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', background: vc.bg, borderRadius: '9px', border: `1px solid ${visita?.estado === 'ok' ? 'var(--at-success-border)' : visita?.estado === 'novedad' ? 'var(--at-warning-border)' : 'var(--at-line)'}` }}>
                      <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--at-accent)', width: '16px', textAlign: 'center' }}>{idx + 1}</span>
                      <span style={{ fontSize: '18px' }}>{icono}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--at-ink)' }}>{area}</div>
                        {punto.instrucciones && <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)' }}>{punto.instrucciones}</div>}
                        {visita?.notas && <div style={{ fontSize: '11.5px', color: 'var(--at-warning)' }}>⚠ {visita.notas}</div>}
                      </div>
                      <span style={{ fontSize: '14px' }}>{vc.icon}</span>
                      {canEdit && visita && visita.estado === 'pendiente' && (
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button onClick={() => marcarVisita(visita.id, 'ok')} title="OK" style={{ padding: '4px 9px', background: 'var(--at-success-tint)', border: '1px solid var(--at-success-border)', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>✅</button>
                          <button onClick={() => marcarVisitaConNovedad(visita.id)} title="Novedad" style={{ padding: '4px 9px', background: 'var(--at-warning-tint)', border: '1px solid var(--at-warning-border)', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>⚠️</button>
                          <button onClick={() => marcarVisita(visita.id, 'omitido')} title="Omitir" style={{ padding: '4px 9px', background: 'var(--at-accent-tint-2)', border: '1px solid var(--at-accent-soft-2)', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>⏭</button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Vista toggle */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <button onClick={() => setVista('novedades')}
          style={{ padding: '8px 16px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer', border: '1.5px solid', borderColor: vista === 'novedades' ? 'var(--at-primary)' : 'var(--at-line)', background: vista === 'novedades' ? 'var(--at-primary-tint)' : 'var(--at-surface)', color: vista === 'novedades' ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
          📋 Novedades ({novedades.length})
        </button>
        <button onClick={() => setVista('rondas')}
          style={{ padding: '8px 16px', borderRadius: '8px', fontWeight: 700, fontSize: '13px', cursor: 'pointer', border: '1.5px solid', borderColor: vista === 'rondas' ? 'var(--at-primary)' : 'var(--at-line)', background: vista === 'rondas' ? 'var(--at-primary-tint)' : 'var(--at-surface)', color: vista === 'rondas' ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
          🛡 Rondas ({rondas.length})
        </button>
      </div>

      {/* Form novedad */}
      {showNovedadForm && (
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>Registrar novedad</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Tipo</label>
              <select value={novedadForm.tipo} onChange={e => setNovedadForm(f => ({ ...f, tipo: e.target.value as TipoNovedad }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }}>
                {(Object.entries(TIPO_NOVEDAD_CONFIG) as [TipoNovedad, typeof TIPO_NOVEDAD_CONFIG[TipoNovedad]][]).map(([v, c]) => (
                  <option key={v} value={v}>{c.icon} {c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Prioridad</label>
              <select value={novedadForm.prioridad} onChange={e => setNovedadForm(f => ({ ...f, prioridad: e.target.value as PrioridadNovedad }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }}>
                <option value="normal">Normal</option>
                <option value="alta">Alta</option>
                <option value="critica">Crítica</option>
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Descripción *</label>
              <textarea value={novedadForm.descripcion} onChange={e => setNovedadForm(f => ({ ...f, descripcion: e.target.value }))}
                placeholder="Detalle la novedad..." rows={3}
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)', resize: 'vertical' }} />
            </div>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Ubicación</label>
              <input value={novedadForm.ubicacion} onChange={e => setNovedadForm(f => ({ ...f, ubicacion: e.target.value }))} placeholder="Ej. Entrada principal, Nivel 3..."
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
            {rondaEnCurso && (
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Vincular a ronda actual</label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13.5px', color: 'var(--at-ink-2)', cursor: 'pointer', marginTop: '8px' }}>
                  <input type="checkbox" checked={novedadForm.ronda_id === rondaEnCurso.id}
                    onChange={e => setNovedadForm(f => ({ ...f, ronda_id: e.target.checked ? rondaEnCurso.id : '' }))} />
                  Sí, vincular a esta ronda
                </label>
              </div>
            )}
            <div style={{ gridColumn: '1 / -1' }}>
              <MultiImageUploader
                values={fotosNovedadForm}
                onChange={setFotosNovedadForm}
                folder="novedades"
                label="Fotografías de evidencia (opcional)"
                capture
                maxFiles={10}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button onClick={registrarNovedad} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Guardando...' : 'Registrar'}
            </button>
            <button onClick={() => { setShowNovedadForm(false); setFotosNovedadForm([]) }} style={{ padding: '10px 20px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Form ronda */}
      {showRondaForm && (
        <div style={{ background: 'var(--at-surface)', border: '1px solid var(--at-line)', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '16px', fontWeight: 700 }}>Iniciar ronda de seguridad</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Ruta de ronda</label>
              <select value={rondaForm.ruta_id} onChange={e => setRondaForm(f => ({ ...f, ruta_id: e.target.value }))}
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }}>
                <option value="">Sin ruta específica</option>
                {rutasActivas.map(r => {
                  const cantPuntos = puntosControl.filter(p => p.ruta_id === r.id).length
                  return <option key={r.id} value={r.id}>{r.nombre} ({cantPuntos} punto{cantPuntos !== 1 ? 's' : ''}{r.tiempo_estimado_min ? ` · ~${r.tiempo_estimado_min} min` : ''})</option>
                })}
              </select>
              {rondaForm.ruta_id && (
                <p style={{ margin: '6px 0 0', fontSize: '12px', color: 'var(--at-accent)' }}>
                  🗺 Se generará automáticamente el checklist de puntos de control.
                </p>
              )}
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Notas (opcional)</label>
              <input value={rondaForm.notas} onChange={e => setRondaForm(f => ({ ...f, notas: e.target.value }))} placeholder="Observaciones iniciales..."
                style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
            <button onClick={iniciarRonda} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>
              🛡 Iniciar ahora
            </button>
            <button onClick={() => setShowRondaForm(false)} style={{ padding: '10px 20px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* Novedades view */}
      {vista === 'novedades' && (
        <>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
            {(['todos', 'normal', 'alta', 'critica'] as const).map(p => (
              <button key={p} onClick={() => setFiltroPrioridad(p)}
                style={{ padding: '6px 13px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, cursor: 'pointer', border: 'none',
                  background: filtroPrioridad === p ? (p === 'todos' ? 'var(--at-line)' : PRIORIDAD_CONFIG[p as PrioridadNovedad]?.bg) : 'transparent',
                  color: filtroPrioridad === p ? (p === 'todos' ? 'var(--at-ink-2)' : PRIORIDAD_CONFIG[p as PrioridadNovedad]?.color) : 'var(--at-ink-3)' }}>
                {p === 'todos' ? 'Todas' : PRIORIDAD_CONFIG[p as PrioridadNovedad].label}
              </button>
            ))}
          </div>
          {novedadesFiltradas.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>📋</div>
              <p style={{ fontWeight: 600, color: 'var(--at-ink-3)' }}>No hay novedades registradas</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {novedadesFiltradas.map(n => {
                const pc = PRIORIDAD_CONFIG[n.prioridad]
                const tc = TIPO_NOVEDAD_CONFIG[n.tipo]
                const rondaVinculada = n.ronda_id ? rondas.find(r => r.id === n.ronda_id) : null
                const accentColor = n.prioridad === 'critica' ? 'var(--at-danger)' : n.prioridad === 'alta' ? 'var(--at-warning)' : 'var(--at-success)'
                return (
                  <div key={n.id} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '12px', overflow: 'hidden', display: 'flex' }}>
                    {/* Accent stripe */}
                    <div style={{ width: '5px', background: accentColor, flexShrink: 0 }} />
                    <div style={{ flex: 1, padding: '14px 16px' }}>
                      {/* Top row */}
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                        <span style={{ fontSize: '22px', flexShrink: 0, lineHeight: 1 }}>{tc.icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '6px' }}>
                            <span style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--at-ink)' }}>{tc.label}</span>
                            <span style={{ padding: '2px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: pc.bg, color: pc.color }}>{pc.label}</span>
                            <span style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', marginLeft: 'auto' }}>
                              {new Date(n.created_at).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          {/* Description */}
                          <p style={{ margin: '0 0 8px', fontSize: '13.5px', color: 'var(--at-ink-2)', lineHeight: 1.5 }}>{n.descripcion}</p>
                          {/* Metadata footer */}
                          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                            {n.ubicacion && (
                              <span style={{ fontSize: '12px', color: 'var(--at-ink-3)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                📍 {n.ubicacion}
                              </span>
                            )}
                            {rondaVinculada && (
                              <span style={{ fontSize: '12px', color: 'var(--at-primary)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                🛡 Ronda {new Date(rondaVinculada.inicio).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            )}
                            <button onClick={() => setNovedadDetalle(n)}
                              style={{ fontSize: '12px', color: 'var(--at-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: '0', fontWeight: 600, marginLeft: 'auto' }}>
                              Ver detalle →
                            </button>
                            {canEdit && (
                              <button onClick={() => eliminarNovedad(n.id)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--at-danger)', fontSize: '14px', padding: '2px 4px' }}>
                                🗑
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Rondas view */}
      {vista === 'rondas' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {rondas.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px', color: 'var(--at-ink-3)' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>🛡️</div>
              <p style={{ fontWeight: 600, color: 'var(--at-ink-3)' }}>No hay rondas registradas</p>
            </div>
          ) : rondas.map(r => {
            const ec = ESTADO_RONDA[r.estado]
            const duracion = r.fin
              ? Math.round((new Date(r.fin).getTime() - new Date(r.inicio).getTime()) / 60000)
              : Math.round((Date.now() - new Date(r.inicio).getTime()) / 60000)
            const novsRonda = novedades.filter(n => n.ronda_id === r.id).length
            const visitasR = visitasControl.filter(v => v.ronda_id === r.id)
            const okCount = visitasR.filter(v => v.estado === 'ok').length
            const novCount = visitasR.filter(v => v.estado === 'novedad').length
            const omitCount = visitasR.filter(v => v.estado === 'omitido').length
            const rutaNombre = r.ruta_id ? rutas.find(rt => rt.id === r.ruta_id)?.nombre : null
            return (
              <div key={r.id} style={{ background: 'var(--at-surface)', border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '14px' }}>
                <span style={{ fontSize: '22px', flexShrink: 0 }}>🛡️</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>
                    {new Date(r.inicio).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })} — {new Date(r.inicio).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div style={{ fontSize: '12.5px', color: 'var(--at-ink-3)', display: 'flex', gap: '12px', marginTop: '3px', flexWrap: 'wrap' }}>
                    <span>⏱ {duracion} min{r.fin ? '' : ' (en curso)'}</span>
                    {rutaNombre && <span>🗺 {rutaNombre}</span>}
                    {visitasR.length > 0 && (
                      <>
                        {okCount > 0 && <span style={{ color: 'var(--at-success)' }}>✅ {okCount}</span>}
                        {novCount > 0 && <span style={{ color: 'var(--at-warning)' }}>⚠️ {novCount}</span>}
                        {omitCount > 0 && <span style={{ color: 'var(--at-accent-hover)' }}>⏭ {omitCount}</span>}
                      </>
                    )}
                    {novsRonda > 0 && <span>📋 {novsRonda} novedad{novsRonda > 1 ? 'es' : ''}</span>}
                    {r.notas && <span>· {r.notas}</span>}
                  </div>
                </div>
                <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, background: ec.bg, color: ec.color, flexShrink: 0 }}>{ec.label}</span>
                {canEdit && r.estado === 'en_curso' && (
                  <button onClick={() => finalizarRonda(r.id, 'completada')} style={{ padding: '6px 12px', background: 'var(--at-success-tint)', color: 'var(--at-success)', border: '1px solid var(--at-success-border)', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600, flexShrink: 0 }}>
                    ✓ Completar
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Modal detalle de novedad */}
      {novedadDetalle && (() => {
        const pc = PRIORIDAD_CONFIG[novedadDetalle.prioridad]
        const tc = TIPO_NOVEDAD_CONFIG[novedadDetalle.tipo]
        const rondaVinculada = novedadDetalle.ronda_id ? rondas.find(r => r.id === novedadDetalle.ronda_id) : null
        const accentColor = novedadDetalle.prioridad === 'critica' ? 'var(--at-danger)' : novedadDetalle.prioridad === 'alta' ? 'var(--at-warning)' : 'var(--at-success)'
        return (
          <div onClick={() => setNovedadDetalle(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
            <div onClick={e => e.stopPropagation()}
              style={{ background: 'var(--at-surface)', borderRadius: '16px', width: '100%', maxWidth: '520px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
              {/* Header con color de prioridad */}
              <div style={{ height: '6px', background: accentColor }} />
              <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--at-chip)', display: 'flex', alignItems: 'flex-start', gap: '12px', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <span style={{ fontSize: '28px', lineHeight: 1 }}>{tc.icon}</span>
                  <div>
                    <div style={{ fontSize: '17px', fontWeight: 800, color: 'var(--at-ink)' }}>{tc.label}</div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
                      <span style={{ padding: '2px 9px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 700, background: pc.bg, color: pc.color }}>{pc.label}</span>
                      <span style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>
                        {new Date(novedadDetalle.created_at).toLocaleString('es', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                </div>
                <button onClick={() => setNovedadDetalle(null)}
                  style={{ background: 'var(--at-chip)', border: 'none', borderRadius: '8px', color: 'var(--at-ink-3)', cursor: 'pointer', fontSize: '18px', lineHeight: 1, padding: '6px 10px', flexShrink: 0 }}>
                  ✕
                </button>
              </div>

              <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto' }}>
                {/* Fotos de evidencia */}
                {((novedadDetalle.fotos && novedadDetalle.fotos.length > 0) || novedadDetalle.foto_url) && (() => {
                  const todas = novedadDetalle.fotos && novedadDetalle.fotos.length > 0
                    ? novedadDetalle.fotos
                    : [novedadDetalle.foto_url!]
                  return (
                    <div>
                      <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
                        Evidencia fotográfica ({todas.length})
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: todas.length === 1 ? '1fr' : 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px' }}>
                        {todas.map((url, i) => (
                          <SecureFileLink key={i} src={url}>
                            {signed => (
                              <img src={signed} alt={`Evidencia ${i + 1}`}
                                style={{ width: '100%', height: todas.length === 1 ? '200px' : '100px', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--at-line)', display: 'block' }} />
                            )}
                          </SecureFileLink>
                        ))}
                      </div>
                    </div>
                  )
                })()}

                {/* Descripción: separar datos del registro vs comentario del guardia */}
                {(() => {
                  const partes = novedadDetalle.descripcion.split('\n\n')
                  const tieneDatos = partes.length >= 2
                  const datosRegistro = tieneDatos ? partes[0] : null
                  const comentario = tieneDatos ? partes.slice(1).join('\n\n') : novedadDetalle.descripcion
                  return (
                    <>
                      {datosRegistro && (
                        <div>
                          <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>Datos del registro</div>
                          <div style={{ fontSize: '12.5px', color: 'var(--at-ink-3)', background: 'var(--at-surface-2)', padding: '10px 14px', borderRadius: '10px', border: '1px solid var(--at-line)', lineHeight: 1.7 }}>
                            {datosRegistro.split(' | ').map((item, i) => (
                              <span key={i} style={{ display: 'inline-block', marginRight: '6px' }}>
                                {i > 0 && <span style={{ color: 'var(--at-line-strong)', marginRight: '6px' }}>·</span>}
                                {item}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      <div>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>Comentarios</div>
                        <p style={{ margin: 0, fontSize: '14.5px', color: 'var(--at-ink)', lineHeight: 1.6, background: 'var(--at-warning-tint)', padding: '12px 14px', borderRadius: '10px', border: '1px solid var(--at-warning-border)', whiteSpace: 'pre-wrap' }}>
                          {comentario}
                        </p>
                      </div>
                    </>
                  )
                })()}

                {/* Metadatos en grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  {novedadDetalle.ubicacion && (
                    <div style={{ background: 'var(--at-surface-2)', borderRadius: '10px', padding: '12px', border: '1px solid var(--at-line)' }}>
                      <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>Ubicación</div>
                      <div style={{ fontSize: '13.5px', color: 'var(--at-ink-2)', fontWeight: 600 }}>📍 {novedadDetalle.ubicacion}</div>
                    </div>
                  )}
                  {rondaVinculada && (
                    <div style={{ background: 'var(--at-primary-tint)', borderRadius: '10px', padding: '12px', border: '1px solid var(--at-primary-soft-2)' }}>
                      <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-primary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>Ronda vinculada</div>
                      <div style={{ fontSize: '13.5px', color: 'var(--at-primary-hover)', fontWeight: 600 }}>
                        🛡 {new Date(rondaVinculada.inicio).toLocaleDateString('es', { day: '2-digit', month: 'short' })} · {new Date(rondaVinculada.inicio).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  )}
                  <div style={{ background: 'var(--at-surface-2)', borderRadius: '10px', padding: '12px', border: '1px solid var(--at-line)' }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>Tipo</div>
                    <div style={{ fontSize: '13.5px', color: 'var(--at-ink-2)', fontWeight: 600 }}>{tc.icon} {tc.label}</div>
                  </div>
                  <div style={{ background: pc.bg, borderRadius: '10px', padding: '12px', border: `1px solid ${accentColor}30` }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: pc.color, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>Prioridad</div>
                    <div style={{ fontSize: '13.5px', color: pc.color, fontWeight: 700 }}>{pc.label}</div>
                  </div>
                </div>

                {/* Acciones */}
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', paddingTop: '4px', borderTop: '1px solid var(--at-chip)' }}>
                  {canEdit && (
                    <button onClick={async () => { setNovedadDetalle(null); await eliminarNovedad(novedadDetalle.id) }}
                      style={{ padding: '9px 16px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: '1.5px solid var(--at-danger-border)', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>
                      🗑 Eliminar
                    </button>
                  )}
                  <button onClick={() => setNovedadDetalle(null)}
                    style={{ padding: '9px 20px', background: 'var(--at-ink)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>
                    Cerrar
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Modal de verificación de acceso */}
      {showAccesosModal && (
        <div onClick={resetAccesos}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '24px 16px', overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'var(--at-surface)', borderRadius: '18px', width: '100%', maxWidth: '680px', boxShadow: '0 30px 60px -20px rgba(0,0,0,0.4)', marginBottom: '24px' }}>

            {/* Header del modal */}
            <div style={{ padding: '20px 24px', background: 'linear-gradient(135deg,var(--at-accent-hover),var(--at-accent-dark))', color: 'white', borderRadius: '18px 18px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.8, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Control de Seguridad</div>
                <div style={{ fontSize: 19, fontWeight: 800, marginTop: 2 }}>🚪 Registro de acceso</div>
                <div style={{ fontSize: 12.5, opacity: 0.88, marginTop: 4 }}>
                  {modoModal === 'dpi' ? 'Busque por DPI para ver historial o registrar entrada' : 'Seleccione una reserva STR para registrar el ingreso'}
                </div>
              </div>
              <button onClick={resetAccesos}
                style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '10px', color: 'white', cursor: 'pointer', fontSize: '20px', lineHeight: 1, padding: '6px 10px', flexShrink: 0 }}>
                ✕
              </button>
            </div>

            {/* Cuerpo del modal */}
            <div style={{ padding: '20px 24px' }}>

              {/* Tabs de modo */}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', borderBottom: '1.5px solid var(--at-chip)', paddingBottom: '16px' }}>
                <button onClick={() => cambiarModo('dpi')}
                  style={{ padding: '8px 16px', borderRadius: '9px', fontWeight: 700, fontSize: '13px', cursor: 'pointer', border: '1.5px solid', borderColor: modoModal === 'dpi' ? 'var(--at-accent-hover)' : 'var(--at-line)', background: modoModal === 'dpi' ? 'var(--at-accent-tint-2)' : 'var(--at-surface)', color: modoModal === 'dpi' ? 'var(--at-accent-hover)' : 'var(--at-ink-3)' }}>
                  🔍 Verificar por DPI
                </button>
                <button onClick={() => cambiarModo('str')}
                  style={{ padding: '8px 16px', borderRadius: '9px', fontWeight: 700, fontSize: '13px', cursor: 'pointer', border: '1.5px solid', borderColor: modoModal === 'str' ? 'var(--at-accent-hover)' : 'var(--at-line)', background: modoModal === 'str' ? 'var(--at-accent-tint-2)' : 'var(--at-surface)', color: modoModal === 'str' ? 'var(--at-accent-hover)' : 'var(--at-ink-3)' }}>
                  🏠 Renta corta
                </button>
              </div>

              {/* ── MODO DPI ── */}
              {modoModal === 'dpi' && (
                <>
              {/* Buscador DPI */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--at-ink-2)', display: 'block', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>DPI / Identificación</label>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <input
                    value={dpiSearch}
                    onChange={e => setDpiSearch(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && buscarPorDpi()}
                    placeholder="Ingrese número de DPI o identificación..."
                    autoFocus
                    style={{ flex: 1, padding: '11px 14px', border: '1.5px solid var(--at-line)', borderRadius: '10px', fontSize: '14px', background: 'var(--at-surface-2)' }}
                  />
                  <button
                    onClick={buscarPorDpi}
                    disabled={searching || !dpiSearch.trim()}
                    style={{ padding: '11px 20px', background: 'linear-gradient(135deg,var(--at-accent-hover),var(--at-accent-dark))', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: searching || !dpiSearch.trim() ? 'not-allowed' : 'pointer', opacity: searching || !dpiSearch.trim() ? 0.65 : 1, minWidth: '110px', fontSize: '13.5px' }}>
                    {searching ? 'Buscando...' : '🔍 Buscar'}
                  </button>
                  {searchResult !== 'idle' && (
                    <button onClick={() => { setDpiSearch(''); setSearchResult('idle'); setSearchResultVisitantes([]); setShowRegForm(false); }}
                      style={{ padding: '11px 14px', background: 'var(--at-chip)', color: 'var(--at-ink-3)', border: '1.5px solid var(--at-line)', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
                      Limpiar
                    </button>
                  )}
                </div>
              </div>

              {/* Resultado: visitante encontrado */}
              {searchResult === 'found' && (
                <div>
                  <div style={{ background: 'var(--at-success-tint)', border: '1.5px solid var(--at-success-border)', borderRadius: '12px', padding: '14px 16px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      {searchResultVisitantes[0]?.foto_url
                        ? <SecureImage src={searchResultVisitantes[0].foto_url} alt="" style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--at-success-border)', flexShrink: 0 }} />
                        : <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'linear-gradient(135deg,var(--at-success),var(--at-success-strong))', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--at-on-status)', fontWeight: 800, fontSize: '18px', flexShrink: 0 }}>
                            {searchResultVisitantes[0]?.nombre.charAt(0).toUpperCase()}
                          </div>
                      }
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--at-success-strong)' }}>
                          {searchResultVisitantes[0]?.nombre}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px' }}>
                          DPI: {dpiSearch} · {searchResultVisitantes.length} visita{searchResultVisitantes.length !== 1 ? 's' : ''} registrada{searchResultVisitantes.length !== 1 ? 's' : ''}
                        </div>
                      </div>
                    </div>
                    {canCreate && (
                      <button onClick={() => setShowRegForm(true)}
                        style={{ padding: '8px 16px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '9px', fontWeight: 600, cursor: 'pointer', fontSize: '13px', flexShrink: 0 }}>
                        + Registrar nueva entrada
                      </button>
                    )}
                  </div>

                  {/* Historial */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', maxHeight: showRegForm ? '160px' : '280px', overflowY: 'auto', marginBottom: showRegForm ? '16px' : '0' }}>
                    {searchResultVisitantes.map(v => {
                      const enPremisa = !v.hora_salida
                      return (
                        <div key={v.id} style={{ background: enPremisa ? 'var(--at-success-tint)' : 'var(--at-surface-2)', border: `1.5px solid ${enPremisa ? 'var(--at-success-border)' : 'var(--at-line)'}`, borderRadius: '10px', padding: '10px 14px', display: 'flex', gap: '10px', alignItems: 'center' }}>
                          {v.foto_url && <SecureImage src={v.foto_url} alt="" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--at-ink)' }}>
                              {new Date(v.hora_entrada).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}
                              {' · '}
                              {new Date(v.hora_entrada).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                            <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', display: 'flex', gap: '8px', marginTop: '1px', flexWrap: 'wrap' }}>
                              {v.unidad_nombre && <span>📍 {v.unidad_nombre}</span>}
                              {v.motivo && <span>· {v.motivo}</span>}
                              {v.placa_vehiculo && <span>· 🚗 {v.placa_vehiculo}</span>}
                              {v.project_id !== proyectoId && <span style={{ color: 'var(--at-accent-hover)', fontWeight: 600 }}>· Otro proyecto</span>}
                            </div>
                          </div>
                          <div style={{ flexShrink: 0 }}>
                            {enPremisa
                              ? <span style={{ padding: '2px 9px', borderRadius: '20px', fontSize: '11px', background: 'var(--at-success-tint)', color: 'var(--at-success)', fontWeight: 700 }}>En premisas</span>
                              : <span style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>
                                  Salida {new Date(v.hora_salida!).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            }
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Resultado: no encontrado */}
              {searchResult === 'not_found' && (
                <div style={{ background: 'var(--at-danger-tint)', border: '1.5px solid var(--at-danger-border)', borderRadius: '12px', padding: '14px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-danger)' }}>No se encontró ningún visitante con ese DPI</div>
                    <div style={{ fontSize: '12.5px', color: 'var(--at-ink-3)', marginTop: '2px' }}>Complete el formulario para registrarlo como nuevo visitante.</div>
                  </div>
                  {canCreate && !showRegForm && (
                    <button onClick={() => setShowRegForm(true)}
                      style={{ padding: '8px 16px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: '1.5px solid var(--at-danger-border)', borderRadius: '9px', fontWeight: 600, cursor: 'pointer', fontSize: '13px', flexShrink: 0 }}>
                      + Registrar nuevo
                    </button>
                  )}
                </div>
              )}

                </>
              )}

              {/* ── MODO STR ── */}
              {modoModal === 'str' && (
                <>
                  {/* Buscador de huésped */}
                  <div style={{ marginBottom: '16px' }}>
                    <input
                      value={strSearch}
                      onChange={e => setStrSearch(e.target.value)}
                      placeholder="Buscar por nombre de huésped o unidad..."
                      autoFocus
                      style={{ width: '100%', boxSizing: 'border-box', padding: '11px 14px', border: '1.5px solid var(--at-line)', borderRadius: '10px', fontSize: '14px', background: 'var(--at-surface-2)' }}
                    />
                  </div>

                  {/* Lista de reservas STR activas/próximas */}
                  {(() => {
                    const hoy = new Date().toISOString().slice(0, 10)
                    const reservasFiltradas = reservasSTR
                      .filter(r => (r.estado === 'confirmada' || r.estado === 'en_curso') && r.fecha_salida >= hoy && !strIngresados.has(r.id))
                      .filter(r => !strSearch || r.huesped_nombre.toLowerCase().includes(strSearch.toLowerCase()) || (r.unidad_nombre ?? '').toLowerCase().includes(strSearch.toLowerCase()))
                      .sort((a, b) => {
                        // Hoy y pasadas primero, luego futuras por fecha ascendente
                        const aHoy = a.fecha_entrada <= hoy
                        const bHoy = b.fecha_entrada <= hoy
                        if (aHoy !== bHoy) return aHoy ? -1 : 1
                        return a.fecha_entrada.localeCompare(b.fecha_entrada)
                      })

                    if (reservasFiltradas.length === 0) {
                      return (
                        <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--at-ink-3)' }}>
                          <div style={{ fontSize: '32px', marginBottom: '10px' }}>🏠</div>
                          <p style={{ fontWeight: 600, color: 'var(--at-ink-3)', margin: 0 }}>
                            {strSearch ? 'No se encontraron reservas con ese nombre' : 'No hay reservas STR activas o próximas'}
                          </p>
                        </div>
                      )
                    }

                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: showRegForm ? '140px' : '320px', overflowY: 'auto' }}>
                        {reservasFiltradas.map(r => {
                          const noches = Math.max(0, Math.round((new Date(r.fecha_salida).getTime() - new Date(r.fecha_entrada).getTime()) / 86400000))
                          const plat = PLATAFORMA_COLOR[r.plataforma] ?? PLATAFORMA_COLOR.otro
                          const enCurso = r.estado === 'en_curso'
                          return (
                            <div key={r.id} style={{ background: enCurso ? 'var(--at-success-tint)' : 'var(--at-surface-2)', border: `1.5px solid ${enCurso ? 'var(--at-success-border)' : 'var(--at-line)'}`, borderRadius: '12px', padding: '12px 14px', display: 'flex', gap: '12px', alignItems: 'center' }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                  <span style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>{r.huesped_nombre}</span>
                                  <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: plat.bg, color: plat.color }}>
                                    {PLATAFORMA_LABEL[r.plataforma] ?? r.plataforma}
                                  </span>
                                  {enCurso && <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: 'var(--at-success-tint)', color: 'var(--at-success)' }}>En curso</span>}
                                </div>
                                <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '3px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                  {r.unidad_nombre && <span>🏠 {r.unidad_nombre}</span>}
                                  <span>📅 {r.fecha_entrada} → {r.fecha_salida}</span>
                                  <span>· {noches} noche{noches !== 1 ? 's' : ''}</span>
                                  {r.num_adultos > 0 && <span>· 👥 {r.num_adultos + r.num_ninos}</span>}
                                </div>
                              </div>
                              {canCreate && (() => {
                                const ingresoHabilitado = r.fecha_entrada <= hoy
                                return (
                                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px', flexShrink: 0 }}>
                                    <button onClick={() => ingresoHabilitado && precargarDesdeSTR(r)}
                                      title={!ingresoHabilitado ? `Ingreso habilitado desde: ${r.fecha_entrada}` : undefined}
                                      style={{ padding: '7px 14px', background: ingresoHabilitado ? 'linear-gradient(135deg,var(--at-accent-hover),var(--at-accent-dark))' : 'var(--at-chip)', color: ingresoHabilitado ? 'white' : 'var(--at-ink-3)', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: ingresoHabilitado ? 'pointer' : 'not-allowed', fontSize: '12.5px', whiteSpace: 'nowrap' }}>
                                      Registrar ingreso
                                    </button>
                                    {!ingresoHabilitado && <span style={{ fontSize: '10.5px', color: 'var(--at-ink-3)' }}>Desde {r.fecha_entrada}</span>}
                                  </div>
                                )
                              })()}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}
                </>
              )}

              {/* Formulario de registro (compartido entre modos DPI y STR) */}
              {showRegForm && canCreate && (
                <div style={{ borderTop: '1.5px solid var(--at-line)', paddingTop: '18px', marginTop: '16px' }}>
                  <h3 style={{ margin: '0 0 14px', fontSize: '15px', fontWeight: 700, color: 'var(--at-ink)' }}>
                    {modoModal === 'str' ? 'Registrar ingreso del huésped' : searchResult === 'found' ? 'Registrar nueva entrada' : 'Registrar nuevo visitante'}
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Nombre completo *</label>
                      <input value={regForm.nombre} onChange={e => setRegForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Nombre del visitante"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Unidad a visitar *</label>
                      <select value={regForm.unidad_id} onChange={e => setRegForm(f => ({ ...f, unidad_id: e.target.value }))}
                        style={{ width: '100%', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }}>
                        <option value="">Seleccionar...</option>
                        {unidades.filter(u => u.activo).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>DPI / Identificación</label>
                      <input value={regForm.identificacion} onChange={e => setRegForm(f => ({ ...f, identificacion: e.target.value }))} placeholder="Número de documento"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Placa de vehículo</label>
                      <input value={regForm.placa_vehiculo} onChange={e => setRegForm(f => ({ ...f, placa_vehiculo: e.target.value }))} placeholder="Ej. ABC-123"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Motivo de visita</label>
                      <input value={regForm.motivo} onChange={e => setRegForm(f => ({ ...f, motivo: e.target.value }))} placeholder="Ej. Entrega, Social..."
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: '4px' }}>Notas</label>
                      <input value={regForm.notas} onChange={e => setRegForm(f => ({ ...f, notas: e.target.value }))} placeholder="Opcional"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: '8px', fontSize: '14px', background: 'var(--at-surface-2)' }} />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      {(fotosExpiradas.foto || fotosExpiradas.documento || fotosExpiradas.vehiculo) && (
                        <div style={{ background: 'var(--at-warning-tint)', border: '1px solid var(--at-warning)', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: 'var(--at-warning-strong)', marginBottom: 10 }}>
                          ⚠️ Una o más fotos tienen más de 90 días. Se recomienda renovarlas.
                        </div>
                      )}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                        <div>
                          <ImageUploader value={fotoPersonaUrl} onChange={setFotoPersonaUrl} folder="visitantes" label="Foto del visitante" capture />
                          {fotosExpiradas.foto && <div style={{ fontSize: 11, color: 'var(--at-warning)', marginTop: 3 }}>⚠️ Mayor a 90 días — renovar</div>}
                        </div>
                        <div>
                          <ImageUploader value={fotoDocumentoUrl} onChange={setFotoDocumentoUrl} folder="visitantes" label="Foto DPI / Documento" capture />
                          {fotosExpiradas.documento && <div style={{ fontSize: 11, color: 'var(--at-warning)', marginTop: 3 }}>⚠️ Mayor a 90 días — renovar</div>}
                        </div>
                        <div>
                          <ImageUploader value={fotoVehiculoUrl} onChange={setFotoVehiculoUrl} folder="visitantes" label="Foto del vehículo" capture />
                          {fotosExpiradas.vehiculo && <div style={{ fontSize: 11, color: 'var(--at-warning)', marginTop: 3 }}>⚠️ Mayor a 90 días — renovar</div>}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                    <button onClick={handleRegistrarAcceso} disabled={regSaving}
                      style={{ padding: '10px 24px', background: 'linear-gradient(135deg,var(--at-primary),var(--at-accent-2))', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: regSaving ? 'not-allowed' : 'pointer', opacity: regSaving ? 0.7 : 1 }}>
                      {regSaving ? 'Registrando...' : '✓ Registrar entrada'}
                    </button>
                    <button onClick={() => setShowRegForm(false)}
                      style={{ padding: '10px 20px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
