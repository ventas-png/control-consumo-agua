import { useState, useEffect } from 'react'
import Swal from 'sweetalert2'
import { supabase } from '../../../lib/supabase'
import type { Visitante, Unidad, ReservaSTR, HuespedSTR, SolicitudMudanzaUnidad, TipoSolicitudMudanza } from '../../../types'
import { ImageUploader, MultiImageUploader } from '../ImageUploader'
import { exportarPDFTabla, exportarExcel } from '../exportUtils'

const PLATAFORMA_LABEL: Record<string, string> = {
  airbnb: 'Airbnb', booking: 'Booking.com', vrbo: 'VRBO', directo: 'Directo', otro: 'Otro',
}
const PLATAFORMA_COLOR: Record<string, { bg: string; color: string }> = {
  airbnb:  { bg: '#fff1f2', color: '#e11d48' },
  booking: { bg: '#eff6ff', color: '#2563eb' },
  vrbo:    { bg: '#f0fdf4', color: '#16a34a' },
  directo: { bg: '#f5f3ff', color: '#7c3aed' },
  otro:    { bg: '#f8fafc', color: '#475569' },
}

const TIPO_MUDANZA_LABEL: Record<TipoSolicitudMudanza, string> = {
  nueva_mudanza:      'Nueva mudanza',
  ingreso_articulos:  'Ingreso de artículos',
  egreso_articulos:   'Egreso de artículos',
  mudanza_salida:     'Salida de mudanza',
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

interface Props {
  visitantes: Visitante[]
  unidades: Unidad[]
  reservasSTR: ReservaSTR[]
  solicitudesMudanza: SolicitudMudanzaUnidad[]
  proyectoId: string
  companyId: string
  userId: string
  proyectoNombre?: string
  canCreate: boolean
  onRefresh: () => void
}

type FiltroFecha = 'hoy' | 'semana' | 'mes' | 'todos'
type TipoNovedad = 'incidente' | 'observacion' | 'alarma' | 'acceso' | 'otro'
type PrioridadNovedad = 'normal' | 'alta' | 'critica'

export function VisitantesTab({ visitantes, unidades, reservasSTR, solicitudesMudanza, proyectoId, companyId, userId, proyectoNombre = 'Condominio', canCreate, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [soloActivos, setSoloActivos] = useState(false)
  const [filtroFecha, setFiltroFecha] = useState<FiltroFecha>('hoy')
  const [salidaPendiente, setSalidaPendiente] = useState<Visitante | null>(null)
  const [modoSalida, setModoSalida] = useState<'idle' | 'sin_novedad' | 'con_novedad'>('idle')
  const [guardandoSalida, setGuardandoSalida] = useState(false)
  const [novedadForm, setNovedadForm] = useState({ tipo: 'incidente' as TipoNovedad, comentarios: '', ubicacion: '', prioridad: 'normal' as PrioridadNovedad })
  const [fotosNovedad, setFotosNovedad] = useState<string[]>([])
  const [visitanteDetalle, setVisitanteDetalle] = useState<Visitante | null>(null)
  const [fotoUrl, setFotoUrl] = useState<string | null>(null)
  const [fotoDocumentoUrl, setFotoDocumentoUrl] = useState<string | null>(null)
  const [fotoVehiculoUrl, setFotoVehiculoUrl] = useState<string | null>(null)
  const [fotosExpiradas, setFotosExpiradas] = useState<{ foto: boolean; documento: boolean; vehiculo: boolean }>({ foto: false, documento: false, vehiculo: false })
  const [showStrModal, setShowStrModal] = useState(false)
  const [strSearch, setStrSearch] = useState('')
  const [strHuespedes, setStrHuespedes] = useState<Record<string, HuespedSTR[]>>({})
  const [strCtx, setStrCtx] = useState<{ reservaId: string; huespedId?: string } | null>(null)
  const [showMudanzaModal, setShowMudanzaModal] = useState(false)
  const [mudanzaSearch, setMudanzaSearch] = useState('')
  const [mudanzaCtx, setMudanzaCtx] = useState<{ solicitudId: string } | null>(null)
  const [form, setForm] = useState({ unidad_id: '', nombre: '', identificacion: '', placa_vehiculo: '', motivo: '', notas: '' })

  // Minor & companions state
  const [formEsMenor, setFormEsMenor] = useState(false)
  const [formFechaNacimiento, setFormFechaNacimiento] = useState('')
  const [acompanantes, setAcompanantes] = useState<AcompananteForm[]>([])
  const [showAcompForm, setShowAcompForm] = useState(false)
  const [acompForm, setAcompForm] = useState(defaultAcompForm())
  const [salidaConAcomp, setSalidaConAcomp] = useState(true)

  const hoy = new Date().toISOString().slice(0, 10)

  const inicioSemana = (() => {
    const d = new Date()
    const diff = d.getDay() === 0 ? -6 : 1 - d.getDay()
    d.setDate(d.getDate() + diff)
    return d.toISOString().slice(0, 10)
  })()

  const inicioMes = hoy.slice(0, 7) + '-01'

  // Fetch pre-registered guests when STR modal opens
  useEffect(() => {
    if (!showStrModal) return
    const activas = reservasSTR.filter(r => (r.estado === 'confirmada' || r.estado === 'en_curso') && r.fecha_salida >= hoy)
    if (activas.length === 0) return
    supabase
      .from('huespedes_str')
      .select('*')
      .in('reserva_str_id', activas.map(r => r.id))
      .then(({ data }) => {
        if (!data) return
        const grouped: Record<string, HuespedSTR[]> = {}
        data.forEach(h => {
          if (!grouped[h.reserva_str_id]) grouped[h.reserva_str_id] = []
          grouped[h.reserva_str_id].push(h as HuespedSTR)
        })
        setStrHuespedes(grouped)
      })
  }, [showStrModal, reservasSTR])

  // KPIs — exclude companions to avoid double-counting
  const principales = visitantes.filter(v => !v.visitante_principal_id)
  const visitasHoy = principales.filter(v => v.hora_entrada.startsWith(hoy)).length
  const enPremisas = visitantes.filter(v => !v.hora_salida).length
  const estaSemana = principales.filter(v => v.hora_entrada.slice(0, 10) >= inicioSemana).length
  const totalHistorico = principales.length

  // Suggestions for main form — matches name OR DPI
  const sugerencias = (form.nombre.length >= 3 || form.identificacion.length >= 3)
    ? [...visitantes]
        .filter(v => !v.visitante_principal_id)
        .sort((a, b) => b.hora_entrada.localeCompare(a.hora_entrada))
        .filter(v =>
          (form.nombre.length >= 3 && v.nombre.toLowerCase().includes(form.nombre.toLowerCase())) ||
          (form.identificacion.length >= 3 && (v.identificacion ?? '').includes(form.identificacion))
        )
        .reduce<Visitante[]>((acc, v) => {
          if (!acc.some(a => a.nombre === v.nombre && a.identificacion === v.identificacion)) acc.push(v)
          return acc
        }, [])
        .slice(0, 5)
    : []

  // Suggestions for companion form
  const acompSugerencias = (acompForm.nombre.length >= 3 || acompForm.identificacion.length >= 3)
    ? [...visitantes]
        .filter(v => !v.visitante_principal_id)
        .sort((a, b) => b.hora_entrada.localeCompare(a.hora_entrada))
        .filter(v =>
          (acompForm.nombre.length >= 3 && v.nombre.toLowerCase().includes(acompForm.nombre.toLowerCase())) ||
          (acompForm.identificacion.length >= 3 && (v.identificacion ?? '').includes(acompForm.identificacion))
        )
        .reduce<Visitante[]>((acc, v) => {
          if (!acc.some(a => a.nombre === v.nombre && a.identificacion === v.identificacion)) acc.push(v)
          return acc
        }, [])
        .filter(v => !acompanantes.some(a => a.nombre === v.nombre))
        .slice(0, 5)
    : []

  const filtrados = visitantes.filter(v => {
    const matchBusqueda = !busqueda
      || v.nombre.toLowerCase().includes(busqueda.toLowerCase())
      || (v.identificacion ?? '').includes(busqueda)
    const matchActivo = !soloActivos || !v.hora_salida
    const fecha = v.hora_entrada.slice(0, 10)
    const matchFecha = filtroFecha === 'todos' ? true
      : filtroFecha === 'hoy' ? fecha === hoy
      : filtroFecha === 'semana' ? fecha >= inicioSemana
      : fecha >= inicioMes
    return matchBusqueda && matchActivo && matchFecha
  })

  // Group STR visitors under their reservation, and mudanza visitors under their authorization
  const strGruposMap = new Map<string, { reserva: ReservaSTR; miembros: Visitante[] }>()
  const mudanzaGruposMap = new Map<string, { solicitud: SolicitudMudanzaUnidad; miembros: Visitante[] }>()
  const regulares: Visitante[] = []
  for (const v of filtrados) {
    if (v.reserva_str_id) {
      const reserva = reservasSTR.find(r => r.id === v.reserva_str_id)
      if (reserva) {
        if (!strGruposMap.has(v.reserva_str_id)) strGruposMap.set(v.reserva_str_id, { reserva, miembros: [] })
        strGruposMap.get(v.reserva_str_id)!.miembros.push(v)
      } else {
        regulares.push(v)
      }
    } else if (v.solicitud_mudanza_id) {
      const solicitud = solicitudesMudanza.find(s => s.id === v.solicitud_mudanza_id)
      if (solicitud) {
        if (!mudanzaGruposMap.has(v.solicitud_mudanza_id)) mudanzaGruposMap.set(v.solicitud_mudanza_id, { solicitud, miembros: [] })
        mudanzaGruposMap.get(v.solicitud_mudanza_id)!.miembros.push(v)
      } else {
        regulares.push(v)
      }
    } else {
      regulares.push(v)
    }
  }

  // Eligible mudanzas for guard check-in: aprobada / programada / en_curso
  const mudanzasElegibles = solicitudesMudanza.filter(s =>
    s.estado === 'aprobada' || s.estado === 'programada' || s.estado === 'en_curso'
  )

  function resetForm() {
    setForm({ unidad_id: '', nombre: '', identificacion: '', placa_vehiculo: '', motivo: '', notas: '' })
    setFotoUrl(null)
    setFotoDocumentoUrl(null)
    setFotoVehiculoUrl(null)
    setFotosExpiradas({ foto: false, documento: false, vehiculo: false })
    setFormEsMenor(false)
    setFormFechaNacimiento('')
    setAcompanantes([])
    setShowAcompForm(false)
    setAcompForm(defaultAcompForm())
    setStrCtx(null)
    setMudanzaCtx(null)
    setShowForm(false)
  }

  function abrirRegistroMudanza(s: SolicitudMudanzaUnidad) {
    const fechaEfectiva = s.fecha_autorizada ?? s.fecha_solicitada ?? ''
    const horaEfectiva = s.hora_autorizada ?? s.hora_solicitada ?? ''
    const notasPartes: string[] = []
    notasPartes.push(`Mudanza autorizada · ${fechaEfectiva}${horaEfectiva ? ` ${horaEfectiva}` : ''}`)
    if (s.empresa_mudanza) notasPartes.push(`Empresa: ${s.empresa_mudanza}`)
    if (s.telefono) notasPartes.push(`Tel: ${s.telefono}`)
    if (s.hora_fin) notasPartes.push(`Hora fin: ${s.hora_fin}`)
    if (s.ascensor_reservado) notasPartes.push('Ascensor reservado')
    setForm({
      nombre: s.empresa_mudanza ? `Personal mudanza (${s.empresa_mudanza})` : 'Personal de mudanza',
      unidad_id: s.unidad_id,
      placa_vehiculo: '',
      motivo: `Mudanza · ${TIPO_MUDANZA_LABEL[s.tipo_mudanza] ?? s.tipo_mudanza}`,
      notas: notasPartes.join(' · '),
      identificacion: '',
    })
    setFotoUrl(null)
    setFotoDocumentoUrl(null)
    setFotoVehiculoUrl(null)
    setFotosExpiradas({ foto: false, documento: false, vehiculo: false })
    setFormEsMenor(false)
    setFormFechaNacimiento('')
    setAcompanantes([])
    setShowAcompForm(false)
    setStrCtx(null)
    setMudanzaCtx({ solicitudId: s.id })
    setShowMudanzaModal(false)
    setMudanzaSearch('')
    setShowForm(true)
  }

  function abrirRegistroSTR(r: ReservaSTR, huesped?: HuespedSTR) {
    const noches = Math.max(0, Math.round((new Date(r.fecha_salida).getTime() - new Date(r.fecha_entrada).getTime()) / 86400000))
    setForm({
      nombre: huesped ? huesped.nombre : r.huesped_nombre,
      unidad_id: r.unidad_id ?? '',
      placa_vehiculo: '',
      motivo: `Renta corta · ${PLATAFORMA_LABEL[r.plataforma] ?? r.plataforma}`,
      notas: `Entrada: ${r.fecha_entrada} · Salida: ${r.fecha_salida} (${noches} noche${noches !== 1 ? 's' : ''})`,
      identificacion: huesped ? (huesped.identificacion ?? '') : '',
    })
    setFotoUrl(huesped?.foto_url ?? r.foto_url ?? null)
    setFotoDocumentoUrl(huesped?.foto_documento_url ?? r.foto_documento_url ?? null)
    setFormEsMenor(huesped?.es_menor ?? false)
    setFormFechaNacimiento(huesped?.fecha_nacimiento ?? '')
    setFotoVehiculoUrl(null)
    setFotosExpiradas({ foto: false, documento: false, vehiculo: false })
    setAcompanantes([])
    setShowAcompForm(false)
    setStrCtx({ reservaId: r.id, huespedId: huesped?.id })
    setMudanzaCtx(null)
    setShowStrModal(false)
    setStrSearch('')
    setShowForm(true)
  }

  function autocompletar(v: Visitante) {
    const mismoVisitante = [...visitantes]
      .filter(r => r.nombre === v.nombre && r.identificacion === v.identificacion)
      .sort((a, b) => b.hora_entrada.localeCompare(a.hora_entrada))
    const registroFoto     = mismoVisitante.find(r => r.foto_url)
    const registroDoc      = mismoVisitante.find(r => r.foto_documento_url)
    const registroVehiculo = mismoVisitante.find(r => r.foto_vehiculo_url)
    const DIAS_90 = 90 * 24 * 60 * 60 * 1000
    const ahora = Date.now()
    const esVencida = (r: Visitante | undefined) => !!r && (ahora - new Date(r.hora_entrada).getTime()) > DIAS_90
    setFotosExpiradas({
      foto:      esVencida(registroFoto),
      documento: esVencida(registroDoc),
      vehiculo:  esVencida(registroVehiculo),
    })
    setForm(f => ({
      ...f,
      nombre: v.nombre,
      identificacion: v.identificacion ?? '',
      placa_vehiculo: v.placa_vehiculo ?? '',
      unidad_id: v.unidad_id,
      motivo: v.motivo ?? '',
    }))
    setFotoUrl(registroFoto?.foto_url ?? null)
    setFotoDocumentoUrl(registroDoc?.foto_documento_url ?? null)
    setFotoVehiculoUrl(registroVehiculo?.foto_vehiculo_url ?? null)
  }

  function autocompletarAcompanante(v: Visitante) {
    setAcompForm(f => ({
      ...f,
      nombre: v.nombre,
      identificacion: v.identificacion ?? '',
      es_menor: v.es_menor ?? false,
      fecha_nacimiento: v.fecha_nacimiento ?? '',
      foto_url: v.foto_url ?? null,
      foto_documento_url: v.foto_documento_url ?? null,
    }))
  }

  function agregarAcompanante() {
    if (!acompForm.nombre.trim()) {
      Swal.fire('Error', 'Ingrese el nombre del acompañante.', 'error')
      return
    }
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

  async function handleRegistrar() {
    if (!form.nombre.trim()) { Swal.fire('Error', 'Ingrese el nombre del visitante.', 'error'); return }
    if (!form.unidad_id) { Swal.fire('Error', 'Seleccione la unidad a visitar.', 'error'); return }
    setSaving(true)
    const horaEntrada = new Date().toISOString()
    const { data, error } = await supabase.from('visitantes').insert({
      company_id: companyId,
      project_id: proyectoId,
      unidad_id: form.unidad_id,
      nombre: form.nombre.trim(),
      identificacion: form.identificacion.trim() || null,
      placa_vehiculo: form.placa_vehiculo.trim() || null,
      motivo: form.motivo.trim() || null,
      notas: form.notas.trim() || null,
      foto_url: fotoUrl,
      foto_documento_url: fotoDocumentoUrl,
      foto_vehiculo_url: fotoVehiculoUrl,
      registrado_por: userId,
      hora_entrada: horaEntrada,
      es_menor: formEsMenor,
      fecha_nacimiento: formEsMenor && formFechaNacimiento ? formFechaNacimiento : null,
      reserva_str_id: strCtx?.reservaId ?? null,
      solicitud_mudanza_id: mudanzaCtx?.solicitudId ?? null,
    }).select('id').single()

    if (error) { setSaving(false); Swal.fire('Error', error.message, 'error'); return }

    // Link pre-registered guest slot to this entry
    if (strCtx?.huespedId && data?.id) {
      await supabase.from('huespedes_str')
        .update({ visitante_id: data.id })
        .eq('id', strCtx.huespedId)
    }

    // First ingress of an approved/scheduled mudanza moves it to "en_curso"
    if (mudanzaCtx?.solicitudId) {
      const sol = solicitudesMudanza.find(s => s.id === mudanzaCtx.solicitudId)
      if (sol && (sol.estado === 'aprobada' || sol.estado === 'programada')) {
        await supabase.from('solicitud_mudanza_unidad')
          .update({ estado: 'en_curso' })
          .eq('id', mudanzaCtx.solicitudId)
      }
    }

    if (acompanantes.length > 0 && data) {
      const acompRows = acompanantes.map(a => ({
        company_id: companyId,
        project_id: proyectoId,
        unidad_id: form.unidad_id,
        nombre: a.nombre,
        identificacion: a.es_menor ? null : (a.identificacion.trim() || null),
        placa_vehiculo: form.placa_vehiculo.trim() || null,
        motivo: form.motivo.trim() || null,
        notas: a.notas.trim() || null,
        foto_url: a.foto_url,
        foto_documento_url: a.es_menor ? null : (a.foto_documento_url ?? null),
        registrado_por: userId,
        hora_entrada: horaEntrada,
        es_menor: a.es_menor,
        fecha_nacimiento: a.es_menor && a.fecha_nacimiento ? a.fecha_nacimiento : null,
        visitante_principal_id: data.id,
        reserva_str_id: strCtx?.reservaId ?? null,
        solicitud_mudanza_id: mudanzaCtx?.solicitudId ?? null,
      }))
      const { error: ae } = await supabase.from('visitantes').insert(acompRows)
      if (ae) {
        setSaving(false)
        Swal.fire('Visitante registrado', `Acompañantes no guardados: ${ae.message}`, 'warning')
        resetForm()
        onRefresh()
        return
      }
    }

    setSaving(false)
    const msg = acompanantes.length > 0
      ? `Visita registrada con ${acompanantes.length} acompañante${acompanantes.length > 1 ? 's' : ''}`
      : 'Visita registrada'
    Swal.fire({ icon: 'success', title: msg, timer: 1500, showConfirmButton: false })
    resetForm()
    onRefresh()
  }

  function iniciarSalida(v: Visitante) {
    setSalidaPendiente(v)
    setModoSalida('idle')
    setNovedadForm({ tipo: 'incidente', comentarios: '', ubicacion: v.unidad_nombre ?? '', prioridad: 'normal' })
    setFotosNovedad([])
    setSalidaConAcomp(true)
  }

  function cancelarSalida() {
    setSalidaPendiente(null)
    setModoSalida('idle')
    setFotosNovedad([])
  }

  async function confirmarSalida() {
    if (!salidaPendiente) return
    if (modoSalida === 'con_novedad' && !novedadForm.comentarios.trim()) {
      Swal.fire('Error', 'Ingrese los comentarios de la novedad.', 'error'); return
    }
    setGuardandoSalida(true)
    const horaSalida = new Date().toISOString()
    const { error } = await supabase.from('visitantes').update({ hora_salida: horaSalida }).eq('id', salidaPendiente.id)
    if (error) { setGuardandoSalida(false); Swal.fire('Error', error.message, 'error'); return }

    if (salidaConAcomp) {
      const acompsActivos = visitantes.filter(v => v.visitante_principal_id === salidaPendiente.id && !v.hora_salida)
      if (acompsActivos.length > 0) {
        await supabase.from('visitantes').update({ hora_salida: horaSalida }).in('id', acompsActivos.map(a => a.id))
      }
    }

    if (modoSalida === 'con_novedad') {
      const partes: string[] = []
      partes.push(`Visitante: ${salidaPendiente.nombre}`)
      if (salidaPendiente.identificacion) partes.push(`DPI: ${salidaPendiente.identificacion}`)
      if (salidaPendiente.unidad_nombre) partes.push(`Unidad: ${salidaPendiente.unidad_nombre}`)
      if (salidaPendiente.placa_vehiculo) partes.push(`Vehículo: ${salidaPendiente.placa_vehiculo}`)
      if (salidaPendiente.motivo) partes.push(`Motivo visita: ${salidaPendiente.motivo}`)
      partes.push(`Entrada: ${new Date(salidaPendiente.hora_entrada).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`)
      partes.push(`Salida: ${new Date(horaSalida).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`)
      const descripcion = `${partes.join(' | ')}\n\n${novedadForm.comentarios.trim()}`
      const ubicacion = novedadForm.ubicacion.trim() || salidaPendiente.unidad_nombre || null
      const { error: ne } = await supabase.from('novedades_seguridad').insert({
        company_id: companyId,
        project_id: proyectoId,
        ronda_id: null,
        tipo: novedadForm.tipo,
        descripcion,
        ubicacion,
        prioridad: novedadForm.prioridad,
        reportado_por: userId,
        foto_url: fotosNovedad[0] ?? null,
        fotos: fotosNovedad.length > 0 ? fotosNovedad : null,
      })
      if (ne) { setGuardandoSalida(false); Swal.fire('Error al registrar novedad', ne.message, 'error'); return }
    }
    setGuardandoSalida(false)
    setSalidaPendiente(null)
    setModoSalida('idle')
    setFotosNovedad([])
    onRefresh()
  }

  function exportarPDF() {
    const subtitulo = filtroFecha === 'hoy' ? `Hoy: ${hoy}`
      : filtroFecha === 'semana' ? `Semana desde ${inicioSemana}`
      : filtroFecha === 'mes' ? `Mes: ${hoy.slice(0, 7)}`
      : 'Todos los registros'
    exportarPDFTabla({
      titulo: 'Registro de Visitantes',
      subtitulo,
      proyectoNombre,
      headers: ['Nombre', 'Unidad', 'Entrada', 'Salida', 'Motivo', 'ID/DPI', 'Placa'],
      rows: filtrados.map(v => [
        v.nombre + (v.es_menor ? ' (Menor)' : '') + (v.visitante_principal_id ? ' [Acomp.]' : ''),
        v.unidad_nombre ?? '—',
        new Date(v.hora_entrada).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
        v.hora_salida ? new Date(v.hora_salida).toLocaleString('es', { hour: '2-digit', minute: '2-digit' }) : 'En premisas',
        v.motivo ?? '—',
        v.es_menor ? 'Menor de edad' : (v.identificacion ?? '—'),
        v.placa_vehiculo ?? '—',
      ]),
      filename: `visitantes-${hoy}`,
      landscape: true,
    })
  }

  function exportarXlsx() {
    exportarExcel(`visitantes-${hoy}`, [{
      name: 'Visitantes',
      headers: ['Nombre', 'Tipo', 'Unidad', 'Hora entrada', 'Hora salida', 'Motivo', 'Identificación', 'Placa'],
      rows: filtrados.map(v => [
        v.nombre,
        v.visitante_principal_id ? 'Acompañante' : (v.es_menor ? 'Menor' : 'Principal'),
        v.unidad_nombre ?? '',
        v.hora_entrada,
        v.hora_salida ?? '',
        v.motivo ?? '',
        v.es_menor ? 'Menor de edad' : (v.identificacion ?? ''),
        v.placa_vehiculo ?? '',
      ]),
    }])
  }

  function renderVisitanteCard(v: Visitante, isSTRMember = false) {
    const enPremisa = !v.hora_salida
    const esSTR = v.motivo?.startsWith('Renta corta')
    // Date restriction only applies to legacy single-person STR entries (no reserva_str_id).
    // Group members with reserva_str_id can always exit individually.
    const fechaSalidaSTR = (esSTR && !v.reserva_str_id) ? (v.notas?.match(/Salida: (\d{4}-\d{2}-\d{2})/)?.[1] ?? null) : null
    const salidaHabilitada = !fechaSalidaSTR || hoy >= fechaSalidaSTR
    const esAcompanante = !!v.visitante_principal_id
    const principal = esAcompanante ? visitantes.find(p => p.id === v.visitante_principal_id) : null
    const acompsActivos = !esAcompanante ? visitantes.filter(a => a.visitante_principal_id === v.id && !a.hora_salida) : []

    const borderColor = enPremisa
      ? (isSTRMember ? '#c4b5fd' : esAcompanante ? '#bfdbfe' : '#bbf7d0')
      : '#e2e8f0'
    const borderLeft = isSTRMember
      ? '4px solid #8b5cf6'
      : esAcompanante ? '4px solid #93c5fd' : undefined

    return (
      <div key={v.id}
        style={{
          background: 'white',
          border: `1.5px solid ${borderColor}`,
          borderRadius: '12px',
          padding: '12px 14px',
          marginLeft: isSTRMember ? 0 : esAcompanante ? '20px' : 0,
          borderLeft,
        }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          {v.foto_url
            ? <img src={v.foto_url} alt={v.nombre} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: `2px solid ${enPremisa ? (isSTRMember ? '#8b5cf6' : esAcompanante ? '#3b82f6' : '#10b981') : '#e2e8f0'}` }} />
            : <div style={{
                width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
                background: v.es_menor
                  ? (enPremisa ? '#fef9c3' : '#fef3c7')
                  : isSTRMember
                    ? (enPremisa ? 'linear-gradient(135deg,#8b5cf6,#7c3aed)' : '#ede9fe')
                    : esAcompanante
                      ? (enPremisa ? 'linear-gradient(135deg,#3b82f6,#2563eb)' : '#e0e7ff')
                      : (enPremisa ? 'linear-gradient(135deg,#10b981,#059669)' : '#e2e8f0'),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: v.es_menor ? '#854d0e' : (enPremisa ? 'white' : '#94a3b8'),
                fontWeight: 700, fontSize: '15px',
              }}>
              {v.es_menor ? '👶' : v.nombre.charAt(0).toUpperCase()}
            </div>
          }
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>{v.nombre}</span>
              {v.es_menor && (
                <span style={{ padding: '2px 7px', background: '#fef9c3', color: '#854d0e', borderRadius: '20px', fontSize: '10.5px', fontWeight: 700 }}>Menor</span>
              )}
              {esAcompanante && (
                <span style={{ padding: '2px 7px', background: '#eff6ff', color: '#1d4ed8', borderRadius: '20px', fontSize: '10.5px', fontWeight: 700 }}>Acompañante</span>
              )}
            </div>
            <div style={{ fontSize: '12px', color: '#64748b', display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '3px' }}>
              {v.unidad_nombre && <span>📍 {v.unidad_nombre}</span>}
              {v.motivo && <span>· {v.motivo}</span>}
              {!v.es_menor && v.identificacion && <span>· ID: {v.identificacion}</span>}
              {v.es_menor && v.fecha_nacimiento && <span>· Nac. {v.fecha_nacimiento}</span>}
              {v.placa_vehiculo && <span>· 🚗 {v.placa_vehiculo}</span>}
              {esAcompanante && principal && (
                <span style={{ color: '#3b82f6' }}>· De: {principal.nombre}</span>
              )}
              {!esAcompanante && acompsActivos.length > 0 && (
                <span style={{ color: '#2563eb', fontWeight: 600 }}>· {acompsActivos.length} acomp. en premisas</span>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '10px', flexWrap: 'wrap', gap: '6px' }}>
          <div style={{ fontSize: '12px', color: '#64748b', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span>Entrada: {new Date(v.hora_entrada).toLocaleString('es', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}</span>
            {v.hora_salida && <span style={{ color: '#94a3b8' }}>· Salida: {new Date(v.hora_salida).toLocaleString('es', { hour: '2-digit', minute: '2-digit' })}</span>}
            {enPremisa && <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '11px', background: isSTRMember ? '#ede9fe' : esAcompanante ? '#dbeafe' : '#dcfce7', color: isSTRMember ? '#6d28d9' : esAcompanante ? '#1d4ed8' : '#16a34a', fontWeight: 700 }}>En premisas</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
            <button onClick={() => setVisitanteDetalle(v)}
              style={{ padding: '6px 12px', background: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
              Ver detalle
            </button>
            {enPremisa && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                <button onClick={() => salidaHabilitada && iniciarSalida(v)}
                  title={!salidaHabilitada ? `Salida programada: ${fechaSalidaSTR}` : undefined}
                  style={{ padding: '6px 12px', background: salidaHabilitada ? '#fef3c7' : '#f1f5f9', color: salidaHabilitada ? '#92400e' : '#94a3b8', border: `1px solid ${salidaHabilitada ? '#fde68a' : '#e2e8f0'}`, borderRadius: '8px', cursor: salidaHabilitada ? 'pointer' : 'not-allowed', fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  Registrar salida
                </button>
                {!salidaHabilitada && <span style={{ fontSize: '10px', color: '#94a3b8' }}>Hasta {fechaSalidaSTR}</span>}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1100px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>Control de Visitantes</h2>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={exportarPDF} disabled={filtrados.length === 0}
            style={{ padding: '9px 14px', background: '#eff6ff', color: '#2563eb', border: '1.5px solid #bfdbfe', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
            📄 PDF
          </button>
          <button onClick={exportarXlsx} disabled={filtrados.length === 0}
            style={{ padding: '9px 14px', background: '#f0fdf4', color: '#16a34a', border: '1.5px solid #86efac', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
            📊 Excel
          </button>
          {canCreate && reservasSTR.some(r => (r.estado === 'confirmada' || r.estado === 'en_curso') && r.fecha_salida >= hoy) && (
            <button onClick={() => setShowStrModal(true)}
              style={{ padding: '10px 16px', background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
              🏠 Renta corta
            </button>
          )}
          {canCreate && mudanzasElegibles.length > 0 && (
            <button onClick={() => setShowMudanzaModal(true)}
              style={{ padding: '10px 16px', background: 'linear-gradient(135deg,#f97316,#ea580c)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}>
              🚛 Mudanza
            </button>
          )}
          {canCreate && (
            <button onClick={() => setShowForm(true)}
              style={{ padding: '10px 20px', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}>
              + Registrar visita
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'flex', background: 'white', borderRadius: '12px', border: '1px solid #e2e8f0', overflow: 'hidden', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', flexWrap: 'wrap' }}>
        {([
          { label: 'Hoy', value: visitasHoy, icon: '📅', color: '#2563eb' },
          { label: 'En premisas', value: enPremisas, icon: '🟢', color: '#16a34a' },
          { label: 'Esta semana', value: estaSemana, icon: '📆', color: '#7c3aed' },
          { label: 'Total histórico', value: totalHistorico, icon: '📊', color: '#475569' },
        ] as const).map((kpi, i) => (
          <div key={kpi.label} style={{ flex: '1 1 120px', padding: '10px 16px', borderRight: i < 3 ? '1px solid #f1f5f9' : undefined, display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '18px' }}>{kpi.icon}</span>
            <div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: kpi.color, lineHeight: 1.1 }}>{kpi.value}</div>
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>{kpi.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar visitante o DPI..."
          style={{ flex: 1, minWidth: '180px', padding: '9px 14px', border: '1.5px solid #e2e8f0', borderRadius: '10px', fontSize: '14px', background: '#f8fafc' }} />
        {(['hoy', 'semana', 'mes', 'todos'] as FiltroFecha[]).map(f => (
          <button key={f} onClick={() => setFiltroFecha(f)}
            style={{
              padding: '6px 12px', borderRadius: '10px', border: '1.5px solid', cursor: 'pointer', fontSize: '12.5px', fontWeight: 600,
              background: filtroFecha === f ? '#0f172a' : '#f8fafc',
              color: filtroFecha === f ? 'white' : '#374151',
              borderColor: filtroFecha === f ? '#0f172a' : '#e2e8f0',
            }}>
            {f === 'hoy' ? 'Hoy' : f === 'semana' ? 'Semana' : f === 'mes' ? 'Mes' : 'Todos'}
          </button>
        ))}
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13.5px', color: '#374151', cursor: 'pointer', padding: '9px 14px', border: '1.5px solid #e2e8f0', borderRadius: '10px', background: soloActivos ? '#f0fdf4' : '#f8fafc', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={soloActivos} onChange={e => setSoloActivos(e.target.checked)} />
          Solo en premisas
        </label>
      </div>

      {/* STR group entry modal */}
      {showStrModal && (
        <div onClick={e => { if (e.target === e.currentTarget) { setShowStrModal(false); setStrSearch('') } }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '16px', overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'white', borderRadius: '16px', width: '100%', maxWidth: '660px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', marginBottom: '16px', overflow: 'hidden' }}>
            <div style={{ background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.7)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Renta Corta</div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'white' }}>🏠 Registrar ingreso STR</h3>
              </div>
              <button onClick={() => { setShowStrModal(false); setStrSearch('') }}
                style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', border: 'none', cursor: 'pointer', fontSize: 18, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                ×
              </button>
            </div>
            <div style={{ padding: '20px 24px' }}>
              <input value={strSearch} onChange={e => setStrSearch(e.target.value)}
                placeholder="Buscar por nombre de huésped o unidad..."
                autoFocus
                style={{ width: '100%', boxSizing: 'border-box', padding: '11px 14px', border: '1.5px solid #e2e8f0', borderRadius: '10px', fontSize: '14px', background: '#f8fafc', marginBottom: '14px' }} />
              {(() => {
                const reservasFiltradas = reservasSTR
                  .filter(r => (r.estado === 'confirmada' || r.estado === 'en_curso') && r.fecha_salida >= hoy)
                  .filter(r => !strSearch || r.huesped_nombre.toLowerCase().includes(strSearch.toLowerCase()) || (r.unidad_nombre ?? '').toLowerCase().includes(strSearch.toLowerCase()))
                  .sort((a, b) => {
                    const aHoy = a.fecha_entrada <= hoy
                    const bHoy = b.fecha_entrada <= hoy
                    if (aHoy !== bHoy) return aHoy ? -1 : 1
                    return a.fecha_entrada.localeCompare(b.fecha_entrada)
                  })
                if (reservasFiltradas.length === 0) {
                  return (
                    <div style={{ textAlign: 'center', padding: '32px 16px', color: '#94a3b8' }}>
                      <div style={{ fontSize: '32px', marginBottom: '10px' }}>🏠</div>
                      <p style={{ fontWeight: 600, color: '#64748b', margin: 0 }}>
                        {strSearch ? 'No se encontraron reservas con ese nombre' : 'No hay reservas STR activas o próximas'}
                      </p>
                    </div>
                  )
                }
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '500px', overflowY: 'auto' }}>
                    {reservasFiltradas.map(r => {
                      const noches = Math.max(0, Math.round((new Date(r.fecha_salida).getTime() - new Date(r.fecha_entrada).getTime()) / 86400000))
                      const plat = PLATAFORMA_COLOR[r.plataforma] ?? PLATAFORMA_COLOR.otro
                      const capacidad = r.num_adultos + r.num_ninos
                      // Count only people currently in premises (exits and re-entries don't block capacity)
                      const enPremisasAhora = visitantes.filter(v => v.reserva_str_id === r.id && !v.hora_salida).length
                      const lleno = enPremisasAhora >= capacidad
                      const ingresoHabilitado = r.fecha_entrada <= hoy
                      const cuposLibres = Math.max(0, capacidad - enPremisasAhora)
                      const grupoHuespedes = strHuespedes[r.id] ?? []
                      // Classify pre-registered guests by current status
                      const noIngresados = grupoHuespedes.filter(h => !h.visitante_id)
                      const conVisitante = grupoHuespedes.filter(h => h.visitante_id).map(h => ({
                        h, v: visitantes.find(vv => vv.id === h.visitante_id),
                      }))
                      const enPremisasGrupo = conVisitante.filter(({ v }) => v && !v.hora_salida)
                      const salieronGrupo = conVisitante.filter(({ v }) => v && !!v.hora_salida)
                      return (
                        <div key={r.id} style={{ background: lleno ? '#f0fdf4' : '#f8fafc', border: `1.5px solid ${lleno ? '#86efac' : '#e2e8f0'}`, borderRadius: '12px', padding: '14px 16px' }}>
                          {/* Header */}
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '10px', gap: '10px' }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>{r.huesped_nombre}</span>
                                <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: plat.bg, color: plat.color }}>
                                  {PLATAFORMA_LABEL[r.plataforma] ?? r.plataforma}
                                </span>
                              </div>
                              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '3px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                {r.unidad_nombre && <span>🏠 {r.unidad_nombre}</span>}
                                <span>📅 {r.fecha_entrada} → {r.fecha_salida} · {noches}n</span>
                                <span>👥 {r.num_adultos}A{r.num_ninos > 0 ? `+${r.num_ninos}N` : ''}</span>
                              </div>
                            </div>
                            <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, flexShrink: 0, background: lleno ? '#dcfce7' : '#fef3c7', color: lleno ? '#16a34a' : '#92400e' }}>
                              {enPremisasAhora}/{capacidad} en premisas
                            </span>
                          </div>

                          {/* Currently inside */}
                          {enPremisasGrupo.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '6px' }}>
                              {enPremisasGrupo.map(({ h }) => (
                                <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px' }}>
                                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#0f172a', flex: 1 }}>{h.es_menor ? '👶 ' : ''}{h.nombre}{h.identificacion ? <span style={{ color: '#64748b', fontWeight: 400 }}> · {h.identificacion}</span> : ''}</span>
                                  <span style={{ fontSize: '11px', color: '#16a34a', fontWeight: 700 }}>✓ En premisas</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Exited — can re-enter */}
                          {salieronGrupo.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '6px' }}>
                              {salieronGrupo.map(({ h }) => (
                                <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px' }}>
                                  <div style={{ flex: 1, fontSize: '12px' }}>
                                    <span style={{ fontWeight: 600, color: '#0f172a' }}>{h.es_menor ? '👶 ' : ''}{h.nombre}</span>
                                    {h.identificacion && <span style={{ color: '#64748b' }}> · {h.identificacion}</span>}
                                    <span style={{ marginLeft: 6, fontSize: '10px', color: '#92400e', fontWeight: 600 }}>🚪 Salió</span>
                                  </div>
                                  <button
                                    onClick={() => !lleno && abrirRegistroSTR(r, h)}
                                    disabled={lleno}
                                    style={{ padding: '5px 12px', background: !lleno ? 'linear-gradient(135deg,#f59e0b,#d97706)' : '#f1f5f9', color: !lleno ? 'white' : '#94a3b8', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: !lleno ? 'pointer' : 'not-allowed', fontSize: '11px', whiteSpace: 'nowrap' }}>
                                    Reingresar
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Not yet entered */}
                          {noIngresados.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '6px' }}>
                              {noIngresados.map(h => (
                                <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px' }}>
                                  <div style={{ flex: 1, fontSize: '12px' }}>
                                    <span style={{ fontWeight: 600, color: '#0f172a' }}>{h.es_menor ? '👶 ' : ''}{h.nombre}</span>
                                    {h.identificacion && <span style={{ color: '#64748b' }}> · {h.identificacion}</span>}
                                    {h.es_menor && <span style={{ marginLeft: 4, padding: '1px 6px', background: '#fef9c3', color: '#854d0e', borderRadius: '10px', fontSize: '10px', fontWeight: 600 }}>Menor</span>}
                                  </div>
                                  <button
                                    onClick={() => ingresoHabilitado && !lleno && abrirRegistroSTR(r, h)}
                                    disabled={!ingresoHabilitado || lleno}
                                    style={{ padding: '5px 12px', background: ingresoHabilitado && !lleno ? 'linear-gradient(135deg,#7c3aed,#6d28d9)' : '#f1f5f9', color: ingresoHabilitado && !lleno ? 'white' : '#94a3b8', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: ingresoHabilitado && !lleno ? 'pointer' : 'not-allowed', fontSize: '11px', whiteSpace: 'nowrap' }}>
                                    Registrar ingreso
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Empty slots / anonymous new person */}
                          {!lleno && (
                            <button
                              onClick={() => ingresoHabilitado && abrirRegistroSTR(r)}
                              disabled={!ingresoHabilitado}
                              style={{ width: '100%', padding: '8px', background: ingresoHabilitado ? 'white' : '#f8fafc', border: `1.5px dashed ${ingresoHabilitado ? '#cbd5e1' : '#e2e8f0'}`, borderRadius: '8px', cursor: ingresoHabilitado ? 'pointer' : 'not-allowed', color: ingresoHabilitado ? '#475569' : '#94a3b8', fontSize: '12px', fontWeight: 600, boxSizing: 'border-box' }}>
                              + Nueva persona ({cuposLibres} cupo{cuposLibres !== 1 ? 's' : ''} disponible{cuposLibres !== 1 ? 's' : ''})
                            </button>
                          )}

                          {lleno && (
                            <div style={{ textAlign: 'center', padding: '8px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '8px', fontSize: '12px', color: '#15803d', fontWeight: 600 }}>
                              ✓ Capacidad completa — {enPremisasAhora}/{capacidad} en premisas
                            </div>
                          )}

                          {!ingresoHabilitado && (
                            <div style={{ fontSize: '10px', color: '#94a3b8', textAlign: 'center', marginTop: '6px' }}>
                              Ingreso habilitado desde: {r.fecha_entrada}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Mudanza authorization selection modal */}
      {showMudanzaModal && (
        <div onClick={e => { if (e.target === e.currentTarget) { setShowMudanzaModal(false); setMudanzaSearch('') } }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '16px', overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'white', borderRadius: '16px', width: '100%', maxWidth: '660px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', marginBottom: '16px', overflow: 'hidden' }}>
            <div style={{ background: 'linear-gradient(135deg,#f97316,#ea580c)', padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.7)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Mudanza autorizada</div>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: 'white' }}>🚛 Registrar ingreso de mudanza</h3>
              </div>
              <button onClick={() => { setShowMudanzaModal(false); setMudanzaSearch('') }}
                style={{ width: 32, height: 32, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', border: 'none', cursor: 'pointer', fontSize: 18, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                ×
              </button>
            </div>
            <div style={{ padding: '20px 24px' }}>
              <input value={mudanzaSearch} onChange={e => setMudanzaSearch(e.target.value)}
                placeholder="Buscar por unidad o empresa de mudanza..."
                autoFocus
                style={{ width: '100%', boxSizing: 'border-box', padding: '11px 14px', border: '1.5px solid #e2e8f0', borderRadius: '10px', fontSize: '14px', background: '#f8fafc', marginBottom: '14px' }} />
              {(() => {
                const lista = mudanzasElegibles
                  .filter(s => {
                    if (!mudanzaSearch) return true
                    const q = mudanzaSearch.toLowerCase()
                    return (s.unidad_nombre ?? '').toLowerCase().includes(q)
                      || (s.empresa_mudanza ?? '').toLowerCase().includes(q)
                  })
                  .sort((a, b) => {
                    const fa = a.fecha_autorizada ?? a.fecha_solicitada ?? ''
                    const fb = b.fecha_autorizada ?? b.fecha_solicitada ?? ''
                    return fa.localeCompare(fb)
                  })
                if (lista.length === 0) {
                  return (
                    <div style={{ textAlign: 'center', padding: '32px 16px', color: '#94a3b8' }}>
                      <div style={{ fontSize: '32px', marginBottom: '10px' }}>🚛</div>
                      <p style={{ fontWeight: 600, color: '#64748b', margin: 0 }}>
                        {mudanzaSearch ? 'No se encontraron mudanzas con ese criterio' : 'No hay mudanzas autorizadas pendientes'}
                      </p>
                    </div>
                  )
                }
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '500px', overflowY: 'auto' }}>
                    {lista.map(s => {
                      const fechaEfectiva = s.fecha_autorizada ?? s.fecha_solicitada ?? ''
                      const horaEfectiva = s.hora_autorizada ?? s.hora_solicitada ?? ''
                      const ingresoHabilitado = fechaEfectiva === hoy || s.estado === 'en_curso'
                      const enCurso = s.estado === 'en_curso'
                      const personasDentro = visitantes.filter(v => v.solicitud_mudanza_id === s.id && !v.hora_salida).length
                      return (
                        <div key={s.id} style={{ background: '#fffbeb', border: '1.5px solid #fde68a', borderRadius: '12px', padding: '14px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '10px', gap: '10px' }}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a' }}>
                                  {TIPO_MUDANZA_LABEL[s.tipo_mudanza] ?? s.tipo_mudanza}
                                </span>
                                <span style={{ padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: enCurso ? '#dcfce7' : '#ffedd5', color: enCurso ? '#16a34a' : '#c2410c' }}>
                                  {enCurso ? 'En curso' : (s.estado === 'programada' ? 'Programada' : 'Aprobada')}
                                </span>
                              </div>
                              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '3px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                {s.unidad_nombre && <span>🏠 {s.unidad_nombre}</span>}
                                <span>📅 {fechaEfectiva}{horaEfectiva ? ` ${horaEfectiva}` : ''}{s.hora_fin ? ` → ${s.hora_fin}` : ''}</span>
                                {s.empresa_mudanza && <span>🚚 {s.empresa_mudanza}</span>}
                              </div>
                              {(s.telefono || s.ascensor_reservado) && (
                                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '3px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                  {s.telefono && <span>📞 {s.telefono}</span>}
                                  {s.ascensor_reservado && <span>🛗 Ascensor reservado</span>}
                                </div>
                              )}
                            </div>
                            {personasDentro > 0 && (
                              <span style={{ padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, flexShrink: 0, background: '#dcfce7', color: '#16a34a' }}>
                                {personasDentro} en premisas
                              </span>
                            )}
                          </div>

                          <button
                            onClick={() => ingresoHabilitado && abrirRegistroMudanza(s)}
                            disabled={!ingresoHabilitado}
                            style={{ width: '100%', padding: '8px', background: ingresoHabilitado ? 'linear-gradient(135deg,#f97316,#ea580c)' : '#f1f5f9', color: ingresoHabilitado ? 'white' : '#94a3b8', border: 'none', borderRadius: '8px', cursor: ingresoHabilitado ? 'pointer' : 'not-allowed', fontWeight: 700, fontSize: '12px', boxSizing: 'border-box' }}>
                            {ingresoHabilitado ? '+ Registrar ingreso de mudanza' : `Habilitado el ${fechaEfectiva}`}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Registration form modal */}
      {showForm && (
        <div
          onClick={e => { if (e.target === e.currentTarget) resetForm() }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '16px', overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'white', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '640px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>Registrar visitante</h3>
                {strCtx && (
                  <div style={{ fontSize: '11px', color: '#7c3aed', fontWeight: 600, marginTop: '2px' }}>🏠 Renta corta — ingreso al grupo</div>
                )}
                {mudanzaCtx && (
                  <div style={{ fontSize: '11px', color: '#ea580c', fontWeight: 600, marginTop: '2px' }}>🚛 Mudanza autorizada — ingreso al grupo</div>
                )}
              </div>
              <button onClick={resetForm}
                style={{ width: 28, height: 28, borderRadius: '50%', background: '#f1f5f9', border: 'none', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', lineHeight: 1 }}>
                ×
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Nombre completo *</label>
                <input value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                  placeholder="Nombre del visitante"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                {sugerencias.length > 0 && (
                  <div style={{ marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', color: '#64748b' }}>Frecuente:</span>
                    {sugerencias.map((v, i) => (
                      <button key={i} type="button" onClick={() => autocompletar(v)}
                        style={{ padding: '3px 10px', background: '#f0f9ff', color: '#0369a1', border: '1px solid #bae6fd', borderRadius: '20px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                        {v.nombre}{v.identificacion ? ` · ${v.identificacion}` : ''}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Unidad a visitar *</label>
                <select value={form.unidad_id} onChange={e => setForm(f => ({ ...f, unidad_id: e.target.value }))}
                  style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }}>
                  <option value="">Seleccionar...</option>
                  {unidades.filter(u => u.activo).map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                </select>
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={formEsMenor} onChange={e => setFormEsMenor(e.target.checked)} />
                    Es menor de edad
                  </label>
                  {formEsMenor && (
                    <span style={{ padding: '2px 8px', background: '#fef9c3', color: '#854d0e', borderRadius: '20px', fontSize: '11px', fontWeight: 700 }}>Menor</span>
                  )}
                </div>
                {formEsMenor ? (
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Fecha de nacimiento (opcional)</label>
                    <input type="date" value={formFechaNacimiento} onChange={e => setFormFechaNacimiento(e.target.value)}
                      style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                  </div>
                ) : (
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>DPI / Identificación</label>
                    <input value={form.identificacion} onChange={e => setForm(f => ({ ...f, identificacion: e.target.value }))}
                      placeholder="Número de documento"
                      style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
                    {sugerencias.length > 0 && (
                      <div style={{ marginTop: '6px', display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                        <span style={{ fontSize: '11px', color: '#64748b' }}>Frecuente:</span>
                        {sugerencias.map((v, i) => (
                          <button key={i} type="button" onClick={() => autocompletar(v)}
                            style={{ padding: '3px 10px', background: '#f0f9ff', color: '#0369a1', border: '1px solid #bae6fd', borderRadius: '20px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                            {v.nombre}{v.identificacion ? ` · ${v.identificacion}` : ''}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Placa de vehículo</label>
                <input value={form.placa_vehiculo} onChange={e => setForm(f => ({ ...f, placa_vehiculo: e.target.value }))}
                  placeholder="Ej. ABC-123"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Motivo de visita</label>
                <input value={form.motivo} onChange={e => setForm(f => ({ ...f, motivo: e.target.value }))}
                  placeholder="Ej. Entrega, Social, Mantenimiento..."
                  style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Notas</label>
                <input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                  placeholder="Opcional"
                  style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', background: '#f8fafc' }} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                {(fotosExpiradas.foto || fotosExpiradas.documento || fotosExpiradas.vehiculo) && (
                  <div style={{ background: '#fffbeb', border: '1px solid #f59e0b', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#92400e', marginBottom: 10 }}>
                    ⚠️ Una o más fotos tienen más de 90 días. Se recomienda renovarlas.
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
                  <div>
                    <ImageUploader value={fotoUrl} onChange={setFotoUrl} folder="visitantes" label="Foto del visitante" capture />
                    {fotosExpiradas.foto && <div style={{ fontSize: 11, color: '#d97706', marginTop: 3 }}>⚠️ Mayor a 90 días — renovar</div>}
                  </div>
                  <div>
                    {!formEsMenor && (
                      <>
                        <ImageUploader value={fotoDocumentoUrl} onChange={setFotoDocumentoUrl} folder="visitantes" label="Foto del DPI / Documento" capture />
                        {fotosExpiradas.documento && <div style={{ fontSize: 11, color: '#d97706', marginTop: 3 }}>⚠️ Mayor a 90 días — renovar</div>}
                      </>
                    )}
                  </div>
                  <div>
                    <ImageUploader value={fotoVehiculoUrl} onChange={setFotoVehiculoUrl} folder="visitantes" label="Foto del vehículo" capture />
                    {fotosExpiradas.vehiculo && <div style={{ fontSize: 11, color: '#d97706', marginTop: 3 }}>⚠️ Mayor a 90 días — renovar</div>}
                  </div>
                </div>
              </div>
            </div>

            {/* Companions section */}
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
                      style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', background: 'white' }} />
                    {acompSugerencias.length > 0 && (
                      <div style={{ marginTop: '5px', display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center' }}>
                        <span style={{ fontSize: '11px', color: '#64748b' }}>Frecuente:</span>
                        {acompSugerencias.map((v, i) => (
                          <button key={i} type="button" onClick={() => autocompletarAcompanante(v)}
                            style={{ padding: '3px 10px', background: '#f0f9ff', color: '#0369a1', border: '1px solid #bae6fd', borderRadius: '20px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                            {v.nombre}{v.identificacion ? ` · ${v.identificacion}` : ''}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: '#374151', cursor: 'pointer', fontWeight: 600 }}>
                    <input type="checkbox" checked={acompForm.es_menor} onChange={e => setAcompForm(f => ({ ...f, es_menor: e.target.checked, identificacion: '' }))} />
                    Es menor de edad
                    {acompForm.es_menor && <span style={{ padding: '2px 8px', background: '#fef9c3', color: '#854d0e', borderRadius: '20px', fontSize: '11px' }}>Menor</span>}
                  </label>
                  {acompForm.es_menor ? (
                    <div>
                      <label style={{ fontSize: '11.5px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '3px' }}>Fecha de nacimiento (opcional)</label>
                      <input type="date" value={acompForm.fecha_nacimiento} onChange={e => setAcompForm(f => ({ ...f, fecha_nacimiento: e.target.value }))}
                        style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', background: 'white' }} />
                    </div>
                  ) : (
                    <div>
                      <label style={{ fontSize: '11.5px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '3px' }}>DPI / Identificación (opcional)</label>
                      <input value={acompForm.identificacion} onChange={e => setAcompForm(f => ({ ...f, identificacion: e.target.value }))}
                        placeholder="Número de documento"
                        style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', background: 'white' }} />
                      {acompSugerencias.length > 0 && (
                        <div style={{ marginTop: '5px', display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center' }}>
                          <span style={{ fontSize: '11px', color: '#64748b' }}>Frecuente:</span>
                          {acompSugerencias.map((v, i) => (
                            <button key={i} type="button" onClick={() => autocompletarAcompanante(v)}
                              style={{ padding: '3px 10px', background: '#f0f9ff', color: '#0369a1', border: '1px solid #bae6fd', borderRadius: '20px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}>
                              {v.nombre}{v.identificacion ? ` · ${v.identificacion}` : ''}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  <div>
                    <label style={{ fontSize: '11.5px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Fotografías (opcional)</label>
                    <div style={{ display: 'grid', gridTemplateColumns: acompForm.es_menor ? '1fr' : '1fr 1fr', gap: '10px' }}>
                      <div>
                        <div style={{ fontSize: '10.5px', color: '#64748b', marginBottom: '3px' }}>Foto de la persona</div>
                        <ImageUploader value={acompForm.foto_url} onChange={v => setAcompForm(f => ({ ...f, foto_url: v }))} folder="visitantes" label="Foto" capture />
                      </div>
                      {!acompForm.es_menor && (
                        <div>
                          <div style={{ fontSize: '10.5px', color: '#64748b', marginBottom: '3px' }}>Foto del documento / DPI</div>
                          <ImageUploader value={acompForm.foto_documento_url} onChange={v => setAcompForm(f => ({ ...f, foto_documento_url: v }))} folder="visitantes" label="DPI" capture />
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="button" onClick={agregarAcompanante}
                      style={{ padding: '7px 16px', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}>
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
              <button onClick={handleRegistrar} disabled={saving}
                style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#0ea5e9,#0d9488)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
                {saving ? 'Registrando...' : `✓ Registrar entrada${acompanantes.length > 0 ? ` (+${acompanantes.length})` : ''}`}
              </button>
              <button onClick={resetForm} style={{ padding: '10px 20px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {/* Visitor list */}
      {filtrados.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#94a3b8' }}>
          <div style={{ fontSize: '36px', marginBottom: '8px' }}>🚪</div>
          <div style={{ fontWeight: 600, color: '#475569' }}>Sin visitantes{filtroFecha !== 'todos' ? ' en este período' : ' registrados'}</div>
          {canCreate && <div style={{ fontSize: '13px', marginTop: '4px' }}>Usa &quot;+ Registrar visita&quot; para añadir el primero</div>}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {/* Regular visitors */}
          {regulares.map(v => renderVisitanteCard(v))}

          {/* STR group blocks */}
          {[...strGruposMap.values()].map(({ reserva, miembros }) => {
            const enPremisasAhora = miembros.filter(m => !m.hora_salida).length
            const capacidad = reserva.num_adultos + reserva.num_ninos
            return (
              <div key={reserva.id}>
                {/* Group header */}
                <div style={{ background: 'linear-gradient(to right,#f5f3ff,#ede9fe)', border: '1.5px solid #c4b5fd', borderRadius: '12px', padding: '12px 16px', marginBottom: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '14px', color: '#5b21b6' }}>
                        🏠 {reserva.huesped_nombre}
                        {reserva.unidad_nombre && <span style={{ fontWeight: 400, color: '#7c3aed', marginLeft: 6 }}>— {reserva.unidad_nombre}</span>}
                      </div>
                      <div style={{ fontSize: '12px', color: '#7c3aed', marginTop: '2px' }}>
                        Renta corta · {reserva.fecha_entrada} → {reserva.fecha_salida}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', flexShrink: 0 }}>
                      <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: enPremisasAhora >= capacidad ? '#dcfce7' : '#ede9fe', color: enPremisasAhora >= capacidad ? '#16a34a' : '#6d28d9' }}>
                        {enPremisasAhora}/{capacidad} en premisas
                      </span>
                    </div>
                  </div>
                </div>
                {/* Group members */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '16px' }}>
                  {miembros.map(v => renderVisitanteCard(v, true))}
                </div>
              </div>
            )
          })}

          {/* Mudanza group blocks */}
          {[...mudanzaGruposMap.values()].map(({ solicitud, miembros }) => {
            const enPremisasAhora = miembros.filter(m => !m.hora_salida).length
            const fechaEfectiva = solicitud.fecha_autorizada ?? solicitud.fecha_solicitada ?? ''
            const horaEfectiva = solicitud.hora_autorizada ?? solicitud.hora_solicitada ?? ''
            return (
              <div key={solicitud.id}>
                <div style={{ background: 'linear-gradient(to right,#fff7ed,#ffedd5)', border: '1.5px solid #fdba74', borderRadius: '12px', padding: '12px 16px', marginBottom: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '14px', color: '#9a3412' }}>
                        🚛 {TIPO_MUDANZA_LABEL[solicitud.tipo_mudanza] ?? solicitud.tipo_mudanza}
                        {solicitud.unidad_nombre && <span style={{ fontWeight: 400, color: '#c2410c', marginLeft: 6 }}>— {solicitud.unidad_nombre}</span>}
                      </div>
                      <div style={{ fontSize: '12px', color: '#c2410c', marginTop: '2px' }}>
                        {fechaEfectiva}{horaEfectiva ? ` ${horaEfectiva}` : ''}{solicitud.hora_fin ? ` → ${solicitud.hora_fin}` : ''}
                        {solicitud.empresa_mudanza ? ` · ${solicitud.empresa_mudanza}` : ''}
                      </div>
                    </div>
                    <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: '#ffedd5', color: '#c2410c' }}>
                      {enPremisasAhora} en premisas
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '16px' }}>
                  {miembros.map(v => renderVisitanteCard(v, true))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Detail modal */}
      {visitanteDetalle && (
        <div onClick={() => setVisitanteDetalle(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '16px', overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'white', borderRadius: '16px', width: '100%', maxWidth: '500px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '18px 20px', borderBottom: '1px solid #f1f5f9' }}>
              {visitanteDetalle.foto_url
                ? <img src={visitanteDetalle.foto_url} alt={visitanteDetalle.nombre} style={{ width: 52, height: 52, borderRadius: '50%', objectFit: 'cover', border: '2px solid #e2e8f0', flexShrink: 0 }} />
                : <div style={{ width: 52, height: 52, borderRadius: '50%', background: !visitanteDetalle.hora_salida ? 'linear-gradient(135deg,#10b981,#059669)' : '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: !visitanteDetalle.hora_salida ? 'white' : '#94a3b8', fontWeight: 800, fontSize: '20px', flexShrink: 0 }}>
                    {visitanteDetalle.es_menor ? '👶' : visitanteDetalle.nombre.charAt(0).toUpperCase()}
                  </div>
              }
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '17px', fontWeight: 800, color: '#0f172a' }}>{visitanteDetalle.nombre}</span>
                  {visitanteDetalle.es_menor && (
                    <span style={{ padding: '2px 8px', background: '#fef9c3', color: '#854d0e', borderRadius: '20px', fontSize: '11px', fontWeight: 700 }}>Menor</span>
                  )}
                  {visitanteDetalle.visitante_principal_id && (
                    <span style={{ padding: '2px 8px', background: '#eff6ff', color: '#1d4ed8', borderRadius: '20px', fontSize: '11px', fontWeight: 700 }}>Acompañante</span>
                  )}
                  {visitanteDetalle.reserva_str_id && (
                    <span style={{ padding: '2px 8px', background: '#f5f3ff', color: '#7c3aed', borderRadius: '20px', fontSize: '11px', fontWeight: 700 }}>STR</span>
                  )}
                  {visitanteDetalle.solicitud_mudanza_id && (
                    <span style={{ padding: '2px 8px', background: '#fff7ed', color: '#ea580c', borderRadius: '20px', fontSize: '11px', fontWeight: 700 }}>Mudanza</span>
                  )}
                </div>
                {visitanteDetalle.unidad_nombre && <div style={{ fontSize: '13px', color: '#64748b', marginTop: '2px' }}>📍 {visitanteDetalle.unidad_nombre}</div>}
              </div>
              <button onClick={() => setVisitanteDetalle(null)}
                style={{ background: '#f1f5f9', border: 'none', borderRadius: '8px', color: '#64748b', cursor: 'pointer', fontSize: '18px', padding: '6px 10px', flexShrink: 0 }}>
                ✕
              </button>
            </div>
            <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                {[
                  { label: 'Entrada', value: new Date(visitanteDetalle.hora_entrada).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) },
                  { label: 'Salida', value: visitanteDetalle.hora_salida ? new Date(visitanteDetalle.hora_salida).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '— En premisas' },
                  ...(visitanteDetalle.es_menor
                    ? [{ label: 'Tipo', value: 'Menor de edad' }]
                    : visitanteDetalle.identificacion ? [{ label: 'DPI / ID', value: visitanteDetalle.identificacion }] : []),
                  ...(visitanteDetalle.fecha_nacimiento ? [{ label: 'Fecha nac.', value: visitanteDetalle.fecha_nacimiento }] : []),
                  ...(visitanteDetalle.placa_vehiculo ? [{ label: 'Vehículo', value: `🚗 ${visitanteDetalle.placa_vehiculo}` }] : []),
                  ...(visitanteDetalle.motivo ? [{ label: 'Motivo', value: visitanteDetalle.motivo }] : []),
                  ...(visitanteDetalle.notas ? [{ label: 'Notas', value: visitanteDetalle.notas }] : []),
                  ...(visitanteDetalle.visitante_principal_id ? (() => {
                    const p = visitantes.find(x => x.id === visitanteDetalle.visitante_principal_id)
                    return p ? [{ label: 'Acompañante de', value: p.nombre }] : []
                  })() : []),
                ].map(({ label, value }) => (
                  <div key={label} style={{ background: '#f8fafc', borderRadius: '10px', padding: '10px 12px', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '3px' }}>{label}</div>
                    <div style={{ fontSize: '13px', color: '#374151', fontWeight: 600, wordBreak: 'break-word' }}>{value}</div>
                  </div>
                ))}
              </div>
              {(visitanteDetalle.foto_url || visitanteDetalle.foto_documento_url || visitanteDetalle.foto_vehiculo_url) && (
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>Fotografías registradas</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                    {[
                      { url: visitanteDetalle.foto_url, label: 'Persona' },
                      { url: visitanteDetalle.foto_documento_url, label: 'DPI' },
                      { url: visitanteDetalle.foto_vehiculo_url, label: 'Vehículo' },
                    ].filter(f => f.url).map(f => (
                      <a key={f.label} href={f.url!} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                        <img src={f.url!} alt={f.label} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'block' }} />
                        <div style={{ fontSize: '10px', color: '#94a3b8', textAlign: 'center', marginTop: '3px' }}>{f.label}</div>
                      </a>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', paddingTop: '4px', borderTop: '1px solid #f1f5f9' }}>
                {!visitanteDetalle.hora_salida && (() => {
                  const esSTR = visitanteDetalle.motivo?.startsWith('Renta corta')
                  const fechaSalidaSTR = (esSTR && !visitanteDetalle.reserva_str_id) ? (visitanteDetalle.notas?.match(/Salida: (\d{4}-\d{2}-\d{2})/)?.[1] ?? null) : null
                  const salidaHabilitada = !fechaSalidaSTR || hoy >= fechaSalidaSTR
                  return salidaHabilitada ? (
                    <button onClick={() => { setVisitanteDetalle(null); iniciarSalida(visitanteDetalle) }}
                      style={{ padding: '9px 18px', background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>
                      Registrar salida
                    </button>
                  ) : null
                })()}
                <button onClick={() => setVisitanteDetalle(null)}
                  style={{ padding: '9px 20px', background: '#0f172a', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Exit modal */}
      {salidaPendiente && (() => {
        const acompsActivos = visitantes.filter(v => v.visitante_principal_id === salidaPendiente.id && !v.hora_salida)
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(3px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
            <div style={{ background: 'white', borderRadius: '16px', width: '100%', maxWidth: '480px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
              <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #f1f5f9' }}>
                <div style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>Registrar salida</div>
                <div style={{ fontSize: '13px', color: '#64748b', marginTop: '2px' }}>
                  {salidaPendiente.nombre}
                  {salidaPendiente.unidad_nombre ? ` · ${salidaPendiente.unidad_nombre}` : ''}
                  {salidaPendiente.es_menor && <span style={{ marginLeft: 6, padding: '1px 7px', background: '#fef9c3', color: '#854d0e', borderRadius: '20px', fontSize: '11px', fontWeight: 700 }}>Menor</span>}
                  {salidaPendiente.visitante_principal_id && <span style={{ marginLeft: 6, padding: '1px 7px', background: '#eff6ff', color: '#1d4ed8', borderRadius: '20px', fontSize: '11px', fontWeight: 700 }}>Acompañante</span>}
                  {salidaPendiente.reserva_str_id && <span style={{ marginLeft: 6, padding: '1px 7px', background: '#f5f3ff', color: '#7c3aed', borderRadius: '20px', fontSize: '11px', fontWeight: 700 }}>STR</span>}
                  {salidaPendiente.solicitud_mudanza_id && <span style={{ marginLeft: 6, padding: '1px 7px', background: '#fff7ed', color: '#ea580c', borderRadius: '20px', fontSize: '11px', fontWeight: 700 }}>Mudanza</span>}
                </div>
              </div>
              <div style={{ padding: '20px 24px' }}>
                <p style={{ margin: '0 0 14px', fontSize: '13.5px', color: '#374151', fontWeight: 600 }}>¿Cómo fue la salida?</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
                  <button onClick={() => setModoSalida('sin_novedad')}
                    style={{ padding: '14px 12px', borderRadius: '10px', border: `2px solid ${modoSalida === 'sin_novedad' ? '#16a34a' : '#e2e8f0'}`, background: modoSalida === 'sin_novedad' ? '#f0fdf4' : '#f8fafc', color: modoSalida === 'sin_novedad' ? '#15803d' : '#374151', fontWeight: 700, fontSize: '13px', cursor: 'pointer', textAlign: 'center' }}>
                    ✅ Sin novedad
                    <div style={{ fontSize: '11px', fontWeight: 400, marginTop: '4px', color: modoSalida === 'sin_novedad' ? '#16a34a' : '#94a3b8' }}>Todo en orden</div>
                  </button>
                  <button onClick={() => setModoSalida('con_novedad')}
                    style={{ padding: '14px 12px', borderRadius: '10px', border: `2px solid ${modoSalida === 'con_novedad' ? '#dc2626' : '#e2e8f0'}`, background: modoSalida === 'con_novedad' ? '#fff1f2' : '#f8fafc', color: modoSalida === 'con_novedad' ? '#dc2626' : '#374151', fontWeight: 700, fontSize: '13px', cursor: 'pointer', textAlign: 'center' }}>
                    ⚠️ Con novedad
                    <div style={{ fontSize: '11px', fontWeight: 400, marginTop: '4px', color: modoSalida === 'con_novedad' ? '#ef4444' : '#94a3b8' }}>Registrar incidencia</div>
                  </button>
                </div>

                {acompsActivos.length > 0 && (
                  <div style={{ marginBottom: '16px', padding: '12px 14px', background: '#eff6ff', border: '1.5px solid #bfdbfe', borderRadius: '10px' }}>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', fontSize: '13px', color: '#1d4ed8', fontWeight: 600 }}>
                      <input type="checkbox" checked={salidaConAcomp} onChange={e => setSalidaConAcomp(e.target.checked)} style={{ marginTop: '2px' }} />
                      <span>
                        También dar salida a {acompsActivos.length} acompañante{acompsActivos.length > 1 ? 's' : ''} en premisas
                        <div style={{ fontWeight: 400, fontSize: '11.5px', color: '#3b82f6', marginTop: '2px' }}>
                          {acompsActivos.map(a => a.nombre + (a.es_menor ? ' (menor)' : '')).join(', ')}
                        </div>
                      </span>
                    </label>
                  </div>
                )}

                {modoSalida === 'con_novedad' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '16px', background: '#fff7ed', border: '1.5px solid #fed7aa', borderRadius: '10px', marginBottom: '16px' }}>
                    <div style={{ fontSize: '12.5px', fontWeight: 700, color: '#c2410c' }}>Detalle de la novedad</div>
                    <div style={{ background: 'white', border: '1px solid #fed7aa', borderRadius: '8px', padding: '10px 12px' }}>
                      <div style={{ fontSize: '10.5px', fontWeight: 700, color: '#9a3412', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Datos del registro (incluidos automáticamente)</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
                        <span style={{ fontSize: '12px', color: '#374151' }}>👤 <b>{salidaPendiente.nombre}</b></span>
                        {salidaPendiente.identificacion && <span style={{ fontSize: '12px', color: '#374151' }}>🪪 {salidaPendiente.identificacion}</span>}
                        {salidaPendiente.unidad_nombre && <span style={{ fontSize: '12px', color: '#374151' }}>📍 {salidaPendiente.unidad_nombre}</span>}
                        {salidaPendiente.placa_vehiculo && <span style={{ fontSize: '12px', color: '#374151' }}>🚗 {salidaPendiente.placa_vehiculo}</span>}
                        {salidaPendiente.motivo && <span style={{ fontSize: '12px', color: '#374151' }}>· {salidaPendiente.motivo}</span>}
                        <span style={{ fontSize: '12px', color: '#64748b' }}>
                          Entrada: {new Date(salidaPendiente.hora_entrada).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <div>
                        <label style={{ fontSize: '11.5px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Tipo</label>
                        <select value={novedadForm.tipo} onChange={e => setNovedadForm(f => ({ ...f, tipo: e.target.value as TipoNovedad }))}
                          style={{ width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', background: 'white' }}>
                          <option value="incidente">Incidente</option>
                          <option value="observacion">Observación</option>
                          <option value="alarma">Alarma</option>
                          <option value="acceso">Acceso</option>
                          <option value="otro">Otro</option>
                        </select>
                      </div>
                      <div>
                        <label style={{ fontSize: '11.5px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Prioridad</label>
                        <select value={novedadForm.prioridad} onChange={e => setNovedadForm(f => ({ ...f, prioridad: e.target.value as PrioridadNovedad }))}
                          style={{ width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', background: 'white' }}>
                          <option value="normal">Normal</option>
                          <option value="alta">Alta</option>
                          <option value="critica">Crítica</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: '11.5px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Ubicación</label>
                      <input value={novedadForm.ubicacion} onChange={e => setNovedadForm(f => ({ ...f, ubicacion: e.target.value }))}
                        placeholder={`Ej. ${salidaPendiente.unidad_nombre ?? 'Entrada principal'}`}
                        style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', background: 'white' }} />
                    </div>
                    <div>
                      <label style={{ fontSize: '11.5px', fontWeight: 600, color: '#374151', display: 'block', marginBottom: '4px' }}>Comentarios / descripción *</label>
                      <textarea value={novedadForm.comentarios} onChange={e => setNovedadForm(f => ({ ...f, comentarios: e.target.value }))}
                        placeholder="Describe con detalle lo ocurrido durante la salida..."
                        rows={3}
                        style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', background: 'white', resize: 'vertical' }} />
                    </div>
                    <div>
                      <MultiImageUploader values={fotosNovedad} onChange={setFotosNovedad} folder="novedades" label="Fotografías de evidencia" capture maxFiles={10} />
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                  <button onClick={cancelarSalida} disabled={guardandoSalida}
                    style={{ padding: '9px 18px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}>
                    Cancelar
                  </button>
                  <button onClick={confirmarSalida} disabled={guardandoSalida || modoSalida === 'idle'}
                    style={{ padding: '9px 20px', background: modoSalida === 'idle' ? '#e2e8f0' : modoSalida === 'sin_novedad' ? 'linear-gradient(135deg,#16a34a,#15803d)' : 'linear-gradient(135deg,#dc2626,#b91c1c)', color: modoSalida === 'idle' ? '#94a3b8' : 'white', border: 'none', borderRadius: '8px', cursor: modoSalida === 'idle' ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: '13px' }}>
                    {guardandoSalida ? 'Registrando...' : modoSalida === 'con_novedad' ? '⚠️ Registrar salida y novedad' : '✓ Confirmar salida'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
