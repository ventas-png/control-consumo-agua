import { hoyLocalISO, diasEntreFechasCalendario } from '../../../lib/format'
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
import { calcularFotosExpiradas, progresoRonda } from '../../../lib/seguridadReglas'
import type {
  RondaSeguridad, NovedadSeguridad, TipoNovedad, PrioridadNovedad, EstadoRonda,
  RutaRonda, PuntoControlRuta, VisitaControl, EstadoVisitaControl,
  Visitante, Unidad, ReservaSTR,
} from '../../../types'
import type { NovedadFormState, RegFormState, SeguridadCtx } from './seguridad/ctx'
import { PLATAFORMA_LABEL } from './seguridad/ui'
import { RondaEnCursoBanner } from './seguridad/RondaEnCursoBanner'
import { NovedadForm, RondaForm } from './seguridad/formularios'
import { VistaNovedades, VistaRondas } from './seguridad/vistas'
import { NovedadDetalleModal } from './seguridad/NovedadDetalleModal'
import { AccesosModal } from './seguridad/AccesosModal'

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

  const [novedadForm, setNovedadForm] = useState<NovedadFormState>({
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
  const [regForm, setRegForm] = useState<RegFormState>({
    nombre: '', unidad_id: '', placa_vehiculo: '', motivo: '', notas: '', identificacion: '',
  })
  const [strReservaId, setStrReservaId] = useState<string | null>(null)
  const [strIngresados, setStrIngresados] = useState<Set<string>>(new Set())

  const novedadesFiltradas = novedades.filter(n =>
    filtroPrioridad === 'todos' || n.prioridad === filtroPrioridad
  )

  const rondaEnCurso = rondas.find(r => r.estado === 'en_curso')
  const hoy = hoyLocalISO()
  const novedadesHoy = novedades.filter(n => n.created_at.startsWith(hoy))
  const criticas = novedades.filter(n => n.prioridad === 'critica').length

  // Checklist de la ronda en curso
  const visitasRondaActual = rondaEnCurso
    ? visitasControl.filter(v => v.ronda_id === rondaEnCurso.id)
    : []
  const puntosRondaActual = rondaEnCurso?.ruta_id
    ? puntosControl.filter(p => p.ruta_id === rondaEnCurso.ruta_id).sort((a, b) => a.orden - b.orden)
    : []
  const { completados: puntosCompletados, progreso } = progresoRonda(puntosRondaActual, visitasRondaActual)

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
    const noches = Math.max(0, diasEntreFechasCalendario(r.fecha_entrada, r.fecha_salida) ?? 0)
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
      setFotosExpiradas(calcularFotosExpiradas(mapped, Date.now()))
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

  const ctx: SeguridadCtx = {
    rondas, novedades, rutas, puntosControl, visitasControl, unidades, reservasSTR,
    proyectoId, canCreate, canEdit,
    saving, filtroPrioridad, setFiltroPrioridad, novedadDetalle, setNovedadDetalle,
    novedadForm, setNovedadForm, fotosNovedadForm, setFotosNovedadForm,
    rondaForm, setRondaForm, setShowNovedadForm, setShowRondaForm,
    modoModal, strSearch, setStrSearch, dpiSearch, setDpiSearch,
    searchResult, setSearchResult, searchResultVisitantes, setSearchResultVisitantes,
    searching, showRegForm, setShowRegForm, regSaving,
    fotoPersonaUrl, setFotoPersonaUrl, fotoDocumentoUrl, setFotoDocumentoUrl,
    fotoVehiculoUrl, setFotoVehiculoUrl, fotosExpiradas, regForm, setRegForm,
    strIngresados,
    rondaEnCurso, novedadesFiltradas, visitasRondaActual, puntosRondaActual,
    puntosCompletados, progreso, rutasActivas,
    iniciarRonda, finalizarRonda, marcarVisita, marcarVisitaConNovedad,
    registrarNovedad, eliminarNovedad, resetAccesos, cambiarModo,
    precargarDesdeSTR, buscarPorDpi, handleRegistrarAcceso,
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
      {rondaEnCurso && <RondaEnCursoBanner ctx={ctx} />}

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
      {showNovedadForm && <NovedadForm ctx={ctx} />}

      {/* Form ronda */}
      {showRondaForm && <RondaForm ctx={ctx} />}

      {/* Novedades view */}
      {vista === 'novedades' && <VistaNovedades ctx={ctx} />}

      {/* Rondas view */}
      {vista === 'rondas' && <VistaRondas ctx={ctx} />}

      {/* Modal detalle de novedad */}
      {novedadDetalle && <NovedadDetalleModal ctx={ctx} />}

      {/* Modal de verificación de acceso */}
      {showAccesosModal && <AccesosModal ctx={ctx} />}
    </div>
  )
}
