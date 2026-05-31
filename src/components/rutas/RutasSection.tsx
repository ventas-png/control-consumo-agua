import { useState, useEffect, useRef, type CSSProperties, type DragEvent} from 'react'
import { confirm, notify } from '../shared/Dialog'
import type { Cliente, Contador, Unidad, Proyecto, Ruta, UserRole } from '../../types'
import { supabase } from '../../lib/supabase'
import { enviarNotificacionRuta, dispararRecordatorioRuta } from '../../lib/email'
import { APP_CONFIG } from '../../lib/config'
import type { FrecuenciaRuta } from '../../types'

interface AppUser {
  id: string
  full_name: string
  role: string
  activo: boolean
}

interface Props {
  clientes: Cliente[]
  contadores: Contador[]
  unidades: Unidad[]
  proyectos: Proyecto[]
  rutas: Ruta[]
  userRole: UserRole
  companyId?: string
  onRutaAdded: (ruta: Ruta) => void
  onRutaUpdated: (id: string, partial: Partial<Ruta>) => void
  onRutaDeleted: (id: string) => void
  onEjecutarRuta: (ruta: Ruta) => void
  canCreate?: boolean
  canEdit?: boolean
}

const EMPTY_FORM = {
  nombre: '',
  descripcion: '',
  project_id: '',
  fecha_programada: '',
  asignado_a: '',
  asignado_nombre: '',
  asignado_email: '',
  asignado_telefono: '',
  // Periodicidad
  frecuencia: 'unica' as FrecuenciaRuta,
  dias_semana: [] as number[],
  intervalo_dias: '14',
  dia_mes: '1',
  fechas_especificas: [] as string[],
  hora_programada: '',
  recurrencia_activa: true,
  fecha_inicio: '',
  fecha_fin: '',
  recordatorio_anticipacion_min: 1440,
  recordatorio_canales: ['email', 'app'] as string[],
}

// ISO: 1 = lunes … 7 = domingo
const DIAS_SEMANA: { iso: number; label: string }[] = [
  { iso: 1, label: 'L' }, { iso: 2, label: 'M' }, { iso: 3, label: 'M' },
  { iso: 4, label: 'J' }, { iso: 5, label: 'V' }, { iso: 6, label: 'S' }, { iso: 7, label: 'D' },
]
const DIAS_NOMBRE: Record<number, string> = { 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie', 6: 'Sáb', 7: 'Dom' }

const FRECUENCIAS: { value: FrecuenciaRuta; label: string }[] = [
  { value: 'unica', label: 'Única' },
  { value: 'diaria', label: 'Diaria' },
  { value: 'semanal', label: 'Semanal' },
  { value: 'quincenal', label: 'Quincenal' },
  { value: 'mensual', label: 'Mensual' },
  { value: 'fechas', label: 'Fechas específicas' },
]

const ANTICIPACION_OPCIONES: { value: number; label: string }[] = [
  { value: 0, label: 'A la hora programada' },
  { value: 30, label: '30 minutos antes' },
  { value: 120, label: '2 horas antes' },
  { value: 1440, label: '1 día antes' },
  { value: 2880, label: '2 días antes' },
]

function describirRecurrencia(ruta: Ruta): string {
  const f = ruta.frecuencia ?? 'unica'
  const hora = ruta.hora_programada ? ` · ${String(ruta.hora_programada).slice(0, 5)}` : ''
  if (f === 'unica') return 'Una vez'
  if (f === 'diaria') return `Diaria${hora}`
  if (f === 'semanal') {
    const dias = (ruta.dias_semana ?? []).slice().sort((a, b) => a - b).map(d => DIAS_NOMBRE[d]).join(', ')
    return `Semanal${dias ? `: ${dias}` : ''}${hora}`
  }
  if (f === 'quincenal') return `Cada ${ruta.intervalo_dias ?? 14} días${hora}`
  if (f === 'mensual') return `Mensual · día ${ruta.dia_mes ?? 1}${hora}`
  if (f === 'fechas') return `${(ruta.fechas_especificas ?? []).length} fecha(s)${hora}`
  return 'Una vez'
}

export function RutasSection({
  clientes,
  contadores,
  unidades,
  proyectos,
  rutas,
  userRole,
  companyId,
  onRutaAdded,
  onRutaUpdated,
  onRutaDeleted,
  onEjecutarRuta,
  canCreate: _canCreate = true,
  canEdit: _canEdit = true,
}: Props) {
  const [editando, setEditando] = useState<Ruta | null>(null)
  const [creando, setCreando] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [tipoRuta, setTipoRuta] = useState<'clientes' | 'contadores' | 'unidades'>('clientes')
  const [clientesEnRuta, setClientesEnRuta] = useState<Cliente[]>([])
  const [contadoresEnRuta, setContadoresEnRuta] = useState<Contador[]>([])
  const [unidadesEnRuta, setUnidadesEnRuta] = useState<Unidad[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [saving, setSaving] = useState(false)
  const [recordandoId, setRecordandoId] = useState<string | null>(null)
  const [nuevaFecha, setNuevaFecha] = useState('')
  const [usuarios, setUsuarios] = useState<AppUser[]>([])
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null)
  const dragOver = useRef<number | null>(null)

  const canEdit = userRole !== 'viewer' && userRole !== 'operator'

  useEffect(() => {
    supabase
      .from('app_users')
      .select('id, full_name, role, activo')
      .eq('activo', true)
      .then(({ data }) => {
        if (data) setUsuarios(data as AppUser[])
      })
  }, [])

  const inputStyle: CSSProperties = {
    padding: '10px 14px',
    border: '2px solid var(--at-line)',
    borderRadius: '8px',
    fontSize: '14px',
    width: '100%',
    boxSizing: 'border-box',
  }
  const labelStyle: CSSProperties = {
    fontSize: '13px',
    fontWeight: 600,
    color: 'var(--at-ink-2)',
    marginBottom: '4px',
    display: 'block',
  }

  function abrirCrear() {
    setForm({ ...EMPTY_FORM, project_id: proyectos.length === 1 ? proyectos[0].id : '' })
    setTipoRuta('clientes')
    setClientesEnRuta([])
    setContadoresEnRuta([])
    setUnidadesEnRuta([])
    setBusqueda('')
    setEditando(null)
    setCreando(true)
  }

  function abrirEditar(ruta: Ruta) {
    setForm({
      nombre: ruta.nombre,
      descripcion: ruta.descripcion ?? '',
      project_id: ruta.project_id ?? '',
      fecha_programada: ruta.fecha_programada ?? '',
      asignado_a: ruta.asignado_a ?? '',
      asignado_nombre: ruta.asignado_nombre ?? '',
      asignado_email: ruta.asignado_email ?? '',
      asignado_telefono: ruta.asignado_telefono ?? '',
      frecuencia: ruta.frecuencia ?? 'unica',
      dias_semana: ruta.dias_semana ?? [],
      intervalo_dias: String(ruta.intervalo_dias ?? 14),
      dia_mes: String(ruta.dia_mes ?? 1),
      fechas_especificas: ruta.fechas_especificas ?? [],
      hora_programada: ruta.hora_programada ? String(ruta.hora_programada).slice(0, 5) : '',
      recurrencia_activa: ruta.recurrencia_activa ?? false,
      fecha_inicio: ruta.fecha_inicio ?? '',
      fecha_fin: ruta.fecha_fin ?? '',
      recordatorio_anticipacion_min: ruta.recordatorio_anticipacion_min ?? 1440,
      recordatorio_canales: ruta.recordatorio_canales ?? ['email', 'app'],
    })
    const tipo = ruta.tipo_ruta ?? 'clientes'
    setTipoRuta(tipo)
    if (tipo === 'contadores') {
      setClientesEnRuta([])
      setUnidadesEnRuta([])
      setContadoresEnRuta(
        (ruta.contador_ids ?? [])
          .map(id => contadores.find(c => c.id === id))
          .filter((c): c is Contador => !!c)
      )
    } else if (tipo === 'unidades') {
      setClientesEnRuta([])
      setContadoresEnRuta([])
      setUnidadesEnRuta(
        (ruta.unidad_ids ?? [])
          .map(id => unidades.find(u => u.id === id))
          .filter((u): u is Unidad => !!u)
      )
    } else {
      setContadoresEnRuta([])
      setUnidadesEnRuta([])
      setClientesEnRuta(
        (ruta.cliente_ids ?? [])
          .map(id => clientes.find(c => c.id === id))
          .filter((c): c is Cliente => !!c)
      )
    }
    setBusqueda('')
    setEditando(ruta)
    setCreando(true)
  }

  function cancelar() {
    setCreando(false)
    setEditando(null)
    setForm(EMPTY_FORM)
    setTipoRuta('clientes')
    setClientesEnRuta([])
    setContadoresEnRuta([])
    setUnidadesEnRuta([])
  }

  // Switching the route's project drops item selections from the previous
  // project so a route never mixes items the new project cannot contain. The
  // first selection (from no project, e.g. opening a legacy route) keeps them.
  function handleProjectChange(projectId: string) {
    if (form.project_id && form.project_id !== projectId) {
      setClientesEnRuta([])
      setContadoresEnRuta([])
      setUnidadesEnRuta([])
      setBusqueda('')
    }
    setForm(prev => ({ ...prev, project_id: projectId }))
  }

  function handleUsuarioChange(userId: string) {
    const usuario = usuarios.find(u => u.id === userId)
    setForm(prev => ({
      ...prev,
      asignado_a: userId,
      asignado_nombre: usuario?.full_name ?? '',
    }))
  }

  function toggleDiaSemana(iso: number) {
    setForm(prev => ({
      ...prev,
      dias_semana: prev.dias_semana.includes(iso)
        ? prev.dias_semana.filter(d => d !== iso)
        : [...prev.dias_semana, iso].sort((a, b) => a - b),
    }))
  }

  function agregarFecha() {
    if (!nuevaFecha) return
    setForm(prev => ({
      ...prev,
      fechas_especificas: prev.fechas_especificas.includes(nuevaFecha)
        ? prev.fechas_especificas
        : [...prev.fechas_especificas, nuevaFecha].sort(),
    }))
    setNuevaFecha('')
  }

  function quitarFecha(fecha: string) {
    setForm(prev => ({ ...prev, fechas_especificas: prev.fechas_especificas.filter(f => f !== fecha) }))
  }

  function toggleCanal(canal: 'email' | 'app') {
    setForm(prev => ({
      ...prev,
      recordatorio_canales: prev.recordatorio_canales.includes(canal)
        ? prev.recordatorio_canales.filter(c => c !== canal)
        : [...prev.recordatorio_canales, canal],
    }))
  }

  async function handleRecordarAhora(ruta: Ruta) {
    setRecordandoId(ruta.id)
    try {
      const r = await dispararRecordatorioRuta(ruta.id)
      notify({
        variant: 'success',
        title: 'Recordatorio enviado',
        text: `Se notificó a ${r.notified} usuario(s)${r.emailed ? ` y se enviaron ${r.emailed} correo(s)` : ''}.`,
        duration: 2600,
      })
    } catch (err) {
      notify({ variant: 'error', title: 'Error', text: err instanceof Error ? err.message : 'No se pudo enviar el recordatorio' })
    } finally {
      setRecordandoId(null)
    }
  }

  function agregarCliente(cliente: Cliente) {
    if (clientesEnRuta.find(c => c.id === cliente.id)) return
    setClientesEnRuta(prev => [...prev, cliente])
  }

  function quitarCliente(idx: number) {
    setClientesEnRuta(prev => prev.filter((_, i) => i !== idx))
  }

  function agregarContador(contador: Contador) {
    if (contadoresEnRuta.find(c => c.id === contador.id)) return
    setContadoresEnRuta(prev => [...prev, contador])
  }

  function quitarContador(idx: number) {
    setContadoresEnRuta(prev => prev.filter((_, i) => i !== idx))
  }

  function agregarUnidad(unidad: Unidad) {
    if (unidadesEnRuta.find(u => u.id === unidad.id)) return
    setUnidadesEnRuta(prev => [...prev, unidad])
  }

  function quitarUnidad(idx: number) {
    setUnidadesEnRuta(prev => prev.filter((_, i) => i !== idx))
  }

  // Drag & drop nativo para reordenar clientes en la ruta
  function handleDragStart(idx: number) {
    setDraggingIdx(idx)
  }

  function handleDragOver(e: DragEvent, idx: number) {
    e.preventDefault()
    dragOver.current = idx
  }

  function handleDrop() {
    if (draggingIdx === null || dragOver.current === null) return
    if (draggingIdx === dragOver.current) { setDraggingIdx(null); return }
    setClientesEnRuta(prev => {
      const arr = [...prev]
      const [moved] = arr.splice(draggingIdx, 1)
      arr.splice(dragOver.current!, 0, moved)
      return arr
    })
    setDraggingIdx(null)
    dragOver.current = null
  }

  async function handleGuardar(notificar: boolean) {
    if (!form.nombre.trim()) {
      notify({ variant: 'warning', title: 'Atención', text: 'El nombre de la ruta es obligatorio' })
      return
    }
    if (!form.project_id) {
      notify({ variant: 'warning', title: 'Atención', text: 'Selecciona el proyecto de la ruta' })
      return
    }
    if (tipoRuta === 'clientes' && clientesEnRuta.length === 0) {
      notify({ variant: 'warning', title: 'Atención', text: 'Agrega al menos un cliente a la ruta' })
      return
    }
    if (tipoRuta === 'contadores' && contadoresEnRuta.length === 0) {
      notify({ variant: 'warning', title: 'Atención', text: 'Agrega al menos un contador a la ruta' })
      return
    }
    if (tipoRuta === 'unidades' && unidadesEnRuta.length === 0) {
      notify({ variant: 'warning', title: 'Atención', text: 'Agrega al menos una unidad a la ruta' })
      return
    }
    // Validaciones de periodicidad
    if (form.frecuencia === 'unica' && !form.fecha_programada) {
      notify({ variant: 'warning', title: 'Atención', text: 'Indica la fecha programada de la ruta' })
      return
    }
    if (form.frecuencia === 'semanal' && form.dias_semana.length === 0) {
      notify({ variant: 'warning', title: 'Atención', text: 'Selecciona al menos un día de la semana' })
      return
    }
    if (form.frecuencia === 'quincenal' && !form.fecha_inicio) {
      notify({ variant: 'warning', title: 'Atención', text: 'Para una ruta quincenal indica la fecha de inicio' })
      return
    }
    if (form.frecuencia === 'fechas' && form.fechas_especificas.length === 0) {
      notify({ variant: 'warning', title: 'Atención', text: 'Agrega al menos una fecha específica' })
      return
    }

    const esRecurrente = form.frecuencia !== 'unica'

    setSaving(true)
    const payload = {
      nombre: form.nombre.trim(),
      descripcion: form.descripcion.trim() || null,
      project_id: form.project_id,
      tipo_ruta: tipoRuta,
      cliente_ids: tipoRuta === 'clientes' ? clientesEnRuta.map(c => c.id) : [],
      contador_ids: tipoRuta === 'contadores' ? contadoresEnRuta.map(c => c.id) : [],
      unidad_ids: tipoRuta === 'unidades' ? unidadesEnRuta.map(u => u.id) : [],
      asignado_a: form.asignado_a || null,
      asignado_nombre: form.asignado_nombre || null,
      asignado_email: form.asignado_email || null,
      asignado_telefono: form.asignado_telefono || null,
      fecha_programada: form.fecha_programada || null,
      // Periodicidad
      frecuencia: form.frecuencia,
      recurrencia_activa: esRecurrente ? form.recurrencia_activa : false,
      dias_semana: form.frecuencia === 'semanal' ? form.dias_semana : [],
      intervalo_dias: form.frecuencia === 'quincenal' ? (parseInt(form.intervalo_dias, 10) || 14) : null,
      dia_mes: form.frecuencia === 'mensual' ? (parseInt(form.dia_mes, 10) || 1) : null,
      fechas_especificas: form.frecuencia === 'fechas' ? form.fechas_especificas : [],
      hora_programada: form.hora_programada || null,
      fecha_inicio: esRecurrente ? (form.fecha_inicio || null) : null,
      fecha_fin: esRecurrente ? (form.fecha_fin || null) : null,
      recordatorio_anticipacion_min: Number(form.recordatorio_anticipacion_min) || 1440,
      recordatorio_canales: form.recordatorio_canales,
    }

    let rutaGuardada: Ruta | null = null

    if (editando) {
      const { data, error } = await supabase
        .from('rutas')
        .update(payload)
        .eq('id', editando.id)
        .select()
      if (error || !data) {
        notify({ variant: 'error', title: 'Error', text: 'No se pudo actualizar la ruta' })
        setSaving(false)
        return
      }
      rutaGuardada = data[0] as Ruta
      onRutaUpdated(editando.id, rutaGuardada)
    } else {
      const { data, error } = await supabase.from('rutas').insert(payload).select()
      if (error || !data) {
        notify({ variant: 'error', title: 'Error', text: 'No se pudo guardar la ruta' })
        setSaving(false)
        return
      }
      rutaGuardada = data[0] as Ruta
      onRutaAdded(rutaGuardada)
    }

    setSaving(false)

    if (notificar && rutaGuardada && (rutaGuardada.asignado_email || rutaGuardada.asignado_telefono)) {
      await enviarNotificaciones(rutaGuardada)
    }

    notify({
      variant: 'success',
      title: editando ? 'Ruta actualizada' : 'Ruta guardada',
      duration: 2000,
    })
    cancelar()
  }

  async function enviarNotificaciones(ruta: Ruta) {
    const promesas: Promise<void>[] = []

    // Email
    if (ruta.asignado_email) {
      promesas.push(
        enviarNotificacionRuta(ruta, companyId).catch(() => {
          /* silencioso si falla email */
        })
      )
    }

    // WhatsApp
    if (ruta.asignado_telefono) {
      let tel = ruta.asignado_telefono.replace(/[^0-9]/g, '')
      if (tel.length === 8) tel = APP_CONFIG.COUNTRY_CODE + tel
      const fecha = ruta.fecha_programada
        ? new Date(ruta.fecha_programada + 'T12:00:00').toLocaleDateString('es-GT')
        : 'Por confirmar'
      const totalItems = ruta.tipo_ruta === 'contadores'
        ? ruta.contador_ids.length
        : ruta.tipo_ruta === 'unidades'
        ? ruta.unidad_ids.length
        : ruta.cliente_ids.length
      const labelItems = ruta.tipo_ruta === 'contadores'
        ? 'contadores'
        : ruta.tipo_ruta === 'unidades'
        ? 'unidades'
        : 'clientes'
      const msg =
        `Hola ${ruta.asignado_nombre ?? ''}, se te ha asignado una ruta de lecturas:\n` +
        `📋 *${ruta.nombre}*\n` +
        `📅 Fecha programada: ${fecha}\n` +
        `📍 Total de ${labelItems}: ${totalItems}\n` +
        (ruta.descripcion ? `📝 ${ruta.descripcion}\n` : '') +
        `\nPor favor asegúrate de completarla el día indicado.`
      window.open(`https://wa.me/${tel}?text=${encodeURIComponent(msg)}`, '_blank')
    }

    await Promise.all(promesas)
  }

  async function handleEliminar(ruta: Ruta) {
    const result = await confirm({
      title: `¿Eliminar "${ruta.nombre}"?`,
      text: 'Esta acción no se puede deshacer',
      icon: 'warning',
      variant: 'danger',
      confirmText: 'Eliminar',
    })
    if (!result.isConfirmed) return
    const { error } = await supabase.from('rutas').delete().eq('id', ruta.id)
    if (error) { notify({ variant: 'error', title: 'Error', text: 'No se pudo eliminar la ruta' }); return }
    onRutaDeleted(ruta.id)
  }

  const clientesDisponibles = clientes.filter(
    c =>
      !clientesEnRuta.find(r => r.id === c.id) &&
      (c.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
        c.codigo.toLowerCase().includes(busqueda.toLowerCase()))
  )

  const contadoresDisponibles = contadores.filter(c => {
    if (!c.activo) return false
    if (contadoresEnRuta.find(r => r.id === c.id)) return false
    if (!form.project_id || c.project_id !== form.project_id) return false
    const texto = busqueda.toLowerCase()
    if (!texto) return true
    return (
      c.numero_serie.toLowerCase().includes(texto) ||
      (c.descripcion ?? '').toLowerCase().includes(texto)
    )
  })

  const unidadesDisponibles = unidades.filter(u => {
    if (!u.activo) return false
    if (unidadesEnRuta.find(r => r.id === u.id)) return false
    if (!form.project_id || u.project_id !== form.project_id) return false
    const texto = busqueda.toLowerCase()
    if (!texto) return true
    return (
      u.nombre.toLowerCase().includes(texto) ||
      u.tipo.toLowerCase().includes(texto)
    )
  })

  const hoy = new Date().toISOString().split('T')[0]

  function estadoRuta(ruta: Ruta) {
    if (ruta.completada) return { label: 'Completada', color: 'var(--at-success-strong)', bg: 'var(--at-success-tint)' }
    if (ruta.fecha_programada && ruta.fecha_programada < hoy)
      return { label: 'Vencida', color: 'var(--at-danger)', bg: 'var(--at-danger-tint)' }
    if (ruta.fecha_programada === hoy) return { label: 'Hoy', color: 'var(--at-warning)', bg: 'var(--at-warning-tint)' }
    return { label: 'Pendiente', color: 'var(--at-primary-hover)', bg: 'var(--at-primary-soft)' }
  }

  // ─── EDITOR ────────────────────────────────────────────────────────────────
  if (creando) {
    return (
      <div style={{ background: 'var(--at-surface)', borderRadius: '24px', padding: '32px', boxShadow: '0 10px 40px rgba(0,0,0,0.08)' }}>
        <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '24px', borderBottom: '2px solid var(--at-line)', paddingBottom: '12px' }}>
          {editando ? 'Editar Ruta' : 'Nueva Ruta de Lecturas'}
        </div>

        {/* Datos generales */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px', marginBottom: '24px' }}>
          <div>
            <label style={labelStyle}>Nombre de la Ruta *</label>
            <input
              style={inputStyle}
              value={form.nombre}
              onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))}
              placeholder="Ej. Zona Norte – Lunes"
            />
          </div>
          <div>
            <label style={labelStyle}>Proyecto *</label>
            <select
              style={inputStyle}
              value={form.project_id}
              onChange={e => handleProjectChange(e.target.value)}
            >
              <option value="">-- Selecciona un proyecto --</option>
              {proyectos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Fecha Programada</label>
            <input
              type="date"
              style={inputStyle}
              value={form.fecha_programada}
              onChange={e => setForm(p => ({ ...p, fecha_programada: e.target.value }))}
            />
          </div>
          <div style={{ gridColumn: '1/-1' }}>
            <label style={labelStyle}>Descripción</label>
            <input
              style={inputStyle}
              value={form.descripcion}
              onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))}
              placeholder="Opcional"
            />
          </div>
        </div>

        {/* Periodicidad y recordatorios */}
        <div style={{ background: 'var(--at-surface-2)', borderRadius: '12px', padding: '20px', marginBottom: '24px', border: '1px solid var(--at-line)' }}>
          <div style={{ fontWeight: 700, marginBottom: '16px', color: 'var(--at-ink-2)' }}>Periodicidad y Recordatorios</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', alignItems: 'start' }}>
            <div>
              <label style={labelStyle}>Frecuencia</label>
              <select
                style={inputStyle}
                value={form.frecuencia}
                onChange={e => setForm(p => ({ ...p, frecuencia: e.target.value as FrecuenciaRuta }))}
              >
                {FRECUENCIAS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Hora (opcional)</label>
              <input
                type="time"
                style={inputStyle}
                value={form.hora_programada}
                onChange={e => setForm(p => ({ ...p, hora_programada: e.target.value }))}
              />
            </div>
          </div>

          {/* Inputs condicionales por frecuencia */}
          {form.frecuencia === 'semanal' && (
            <div style={{ marginTop: '14px' }}>
              <label style={labelStyle}>Días de la semana</label>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {DIAS_SEMANA.map(d => {
                  const active = form.dias_semana.includes(d.iso)
                  return (
                    <button
                      key={d.iso}
                      type="button"
                      onClick={() => toggleDiaSemana(d.iso)}
                      title={DIAS_NOMBRE[d.iso]}
                      style={{
                        width: '38px', height: '38px', borderRadius: '8px', cursor: 'pointer', fontWeight: 700, fontSize: '13px',
                        border: active ? 'none' : '2px solid var(--at-line)',
                        background: active ? 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-accent-2) 100%)' : 'var(--at-surface)',
                        color: active ? 'white' : 'var(--at-ink-2)',
                      }}
                    >
                      {d.label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {form.frecuencia === 'quincenal' && (
            <div style={{ marginTop: '14px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
              <div>
                <label style={labelStyle}>Cada cuántos días</label>
                <input
                  type="number" min={1} style={inputStyle}
                  value={form.intervalo_dias}
                  onChange={e => setForm(p => ({ ...p, intervalo_dias: e.target.value }))}
                />
              </div>
            </div>
          )}

          {form.frecuencia === 'mensual' && (
            <div style={{ marginTop: '14px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
              <div>
                <label style={labelStyle}>Día del mes (1–31)</label>
                <input
                  type="number" min={1} max={31} style={inputStyle}
                  value={form.dia_mes}
                  onChange={e => setForm(p => ({ ...p, dia_mes: e.target.value }))}
                />
                <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '4px' }}>Si el mes no tiene ese día, se usa el último.</div>
              </div>
            </div>
          )}

          {form.frecuencia === 'fechas' && (
            <div style={{ marginTop: '14px' }}>
              <label style={labelStyle}>Fechas específicas</label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <input type="date" style={{ ...inputStyle, width: 'auto' }} value={nuevaFecha} onChange={e => setNuevaFecha(e.target.value)} />
                <button type="button" onClick={agregarFecha} style={{ padding: '10px 16px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}>Agregar</button>
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '10px' }}>
                {form.fechas_especificas.map(f => (
                  <span key={f} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', background: 'var(--at-chip)', borderRadius: '20px', fontSize: '12px', fontWeight: 600 }}>
                    {new Date(f + 'T12:00:00').toLocaleDateString('es-GT')}
                    <button type="button" onClick={() => quitarFecha(f)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--at-danger)', fontWeight: 700 }}>×</button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Ventana de vigencia (solo recurrentes) */}
          {form.frecuencia !== 'unica' && (
            <div style={{ marginTop: '14px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
              <div>
                <label style={labelStyle}>Inicia el{form.frecuencia === 'quincenal' ? ' *' : ''}</label>
                <input type="date" style={inputStyle} value={form.fecha_inicio} onChange={e => setForm(p => ({ ...p, fecha_inicio: e.target.value }))} />
              </div>
              <div>
                <label style={labelStyle}>Termina el (opcional)</label>
                <input type="date" style={inputStyle} value={form.fecha_fin} onChange={e => setForm(p => ({ ...p, fecha_fin: e.target.value }))} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '24px' }}>
                <input id="recurrencia_activa" type="checkbox" checked={form.recurrencia_activa} onChange={e => setForm(p => ({ ...p, recurrencia_activa: e.target.checked }))} style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
                <label htmlFor="recurrencia_activa" style={{ fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)', cursor: 'pointer' }}>Recurrencia activa</label>
              </div>
            </div>
          )}

          {/* Recordatorios */}
          <div style={{ marginTop: '18px', borderTop: '1px dashed var(--at-line)', paddingTop: '16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', alignItems: 'start' }}>
            <div>
              <label style={labelStyle}>Avisar</label>
              <select
                style={inputStyle}
                value={form.recordatorio_anticipacion_min}
                onChange={e => setForm(p => ({ ...p, recordatorio_anticipacion_min: Number(e.target.value) }))}
              >
                {ANTICIPACION_OPCIONES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Canales del recordatorio</label>
              <div style={{ display: 'flex', gap: '16px', paddingTop: '8px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.recordatorio_canales.includes('email')} onChange={() => toggleCanal('email')} style={{ width: '17px', height: '17px', cursor: 'pointer' }} />
                  Email
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: 'var(--at-ink-2)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.recordatorio_canales.includes('app')} onChange={() => toggleCanal('app')} style={{ width: '17px', height: '17px', cursor: 'pointer' }} />
                  Notificación en app
                </label>
              </div>
            </div>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '10px' }}>
            Los recordatorios llegan al operador asignado y a los administradores. El envío automático corre cada hora en el servidor.
          </div>
        </div>

        {/* Asignación de operador */}
        <div style={{ background: 'var(--at-surface-2)', borderRadius: '12px', padding: '20px', marginBottom: '24px', border: '1px solid var(--at-line)' }}>
          <div style={{ fontWeight: 700, marginBottom: '16px', color: 'var(--at-ink-2)' }}>Asignar Operador</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
            <div>
              <label style={labelStyle}>Operador</label>
              <select
                style={inputStyle}
                value={form.asignado_a}
                onChange={e => handleUsuarioChange(e.target.value)}
              >
                <option value="">-- Sin asignar --</option>
                {usuarios.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.full_name} ({u.role})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Email (para notificación)</label>
              <input
                type="email"
                style={inputStyle}
                value={form.asignado_email}
                onChange={e => setForm(p => ({ ...p, asignado_email: e.target.value }))}
                placeholder="operador@empresa.com"
              />
            </div>
            <div>
              <label style={labelStyle}>Teléfono (para WhatsApp)</label>
              <input
                type="tel"
                style={inputStyle}
                value={form.asignado_telefono}
                onChange={e => setForm(p => ({ ...p, asignado_telefono: e.target.value }))}
                placeholder="55551234"
              />
            </div>
          </div>
        </div>

        {/* Selector de tipo de ruta */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ fontWeight: 700, marginBottom: '10px', color: 'var(--at-ink-2)', fontSize: '14px' }}>Tipo de Ruta</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {(['clientes', 'contadores', 'unidades'] as const).map(tipo => {
              const labels = { clientes: 'Por cliente', contadores: 'Por contador', unidades: 'Por unidad' }
              const active = tipoRuta === tipo
              return (
                <button
                  key={tipo}
                  onClick={() => { setTipoRuta(tipo); setBusqueda('') }}
                  style={{
                    padding: '8px 18px',
                    border: active ? 'none' : '2px solid var(--at-line)',
                    borderRadius: '8px',
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: 'pointer',
                    background: active ? 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-accent-2) 100%)' : 'var(--at-surface-2)',
                    color: active ? 'white' : 'var(--at-ink-2)',
                    transition: 'all 0.15s',
                  }}
                >
                  {labels[tipo]}
                </button>
              )
            })}
          </div>
        </div>

        {/* Panel de selección de elementos */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>

          {/* ── MODO CLIENTES ── */}
          {tipoRuta === 'clientes' && (
            <>
              <div>
                <div style={{ fontWeight: 700, marginBottom: '10px', color: 'var(--at-ink-2)' }}>
                  Clientes disponibles ({clientesDisponibles.length})
                </div>
                <input
                  style={{ ...inputStyle, marginBottom: '10px' }}
                  placeholder="Buscar cliente..."
                  value={busqueda}
                  onChange={e => setBusqueda(e.target.value)}
                />
                <div style={{ maxHeight: '320px', overflowY: 'auto', border: '2px solid var(--at-line)', borderRadius: '10px' }}>
                  {clientesDisponibles.length === 0 && (
                    <div style={{ padding: '16px', color: 'var(--at-ink-3)', textAlign: 'center', fontSize: '13px' }}>
                      {busqueda ? 'Sin resultados' : 'Todos los clientes ya están en la ruta'}
                    </div>
                  )}
                  {clientesDisponibles.map(c => (
                    <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--at-chip)' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '13px' }}>{c.nombre}</div>
                        <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{c.codigo}</div>
                      </div>
                      <button onClick={() => agregarCliente(c)} style={{ padding: '4px 10px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, fontSize: '16px' }}>+</button>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: '10px', color: 'var(--at-ink-2)' }}>
                  En esta ruta ({clientesEnRuta.length}) — arrastra para reordenar
                </div>
                <div style={{ maxHeight: '370px', overflowY: 'auto', border: '2px solid var(--at-line)', borderRadius: '10px', minHeight: '60px' }}>
                  {clientesEnRuta.length === 0 && (
                    <div style={{ padding: '20px', color: 'var(--at-ink-3)', textAlign: 'center', fontSize: '13px' }}>Agrega clientes desde el panel izquierdo</div>
                  )}
                  {clientesEnRuta.map((c, idx) => (
                    <div
                      key={c.id}
                      draggable
                      onDragStart={() => handleDragStart(idx)}
                      onDragOver={e => handleDragOver(e, idx)}
                      onDrop={handleDrop}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--at-chip)', background: draggingIdx === idx ? 'var(--at-primary-tint)' : 'var(--at-surface)', cursor: 'grab', userSelect: 'none' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ color: 'var(--at-ink-3)', fontSize: '16px' }}>⠿</span>
                        <div>
                          <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-primary)', marginRight: '6px' }}>#{idx + 1}</span>
                          <span style={{ fontWeight: 600, fontSize: '13px' }}>{c.nombre}</span>
                          <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{c.codigo}</div>
                        </div>
                      </div>
                      <button onClick={() => quitarCliente(idx)} style={{ padding: '2px 8px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: '1px solid var(--at-danger-border)', borderRadius: '6px', cursor: 'pointer', fontWeight: 700 }}>×</button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ── MODO CONTADORES ── */}
          {tipoRuta === 'contadores' && (
            <>
              <div>
                <div style={{ fontWeight: 700, marginBottom: '10px', color: 'var(--at-ink-2)' }}>
                  Contadores disponibles ({contadoresDisponibles.length})
                </div>
                <input
                  style={{ ...inputStyle, marginBottom: '10px' }}
                  placeholder="Buscar contador..."
                  value={busqueda}
                  onChange={e => setBusqueda(e.target.value)}
                />
                <div style={{ maxHeight: '280px', overflowY: 'auto', border: '2px solid var(--at-line)', borderRadius: '10px' }}>
                  {contadoresDisponibles.length === 0 && (
                    <div style={{ padding: '16px', color: 'var(--at-ink-3)', textAlign: 'center', fontSize: '13px' }}>
                      {!form.project_id ? 'Selecciona un proyecto primero' : busqueda ? 'Sin resultados' : 'Todos los contadores ya están en la ruta'}
                    </div>
                  )}
                  {contadoresDisponibles.map(c => {
                    const proyecto = proyectos.find(p => p.id === c.project_id)
                    return (
                      <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--at-chip)' }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '13px' }}>{c.numero_serie}</div>
                          <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{proyecto?.nombre ?? ''}{c.descripcion ? ` · ${c.descripcion}` : ''} · {c.tipo_agua}</div>
                        </div>
                        <button onClick={() => agregarContador(c)} style={{ padding: '4px 10px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, fontSize: '16px' }}>+</button>
                      </div>
                    )
                  })}
                </div>
              </div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: '10px', color: 'var(--at-ink-2)' }}>
                  En esta ruta ({contadoresEnRuta.length}) — arrastra para reordenar
                </div>
                <div style={{ maxHeight: '370px', overflowY: 'auto', border: '2px solid var(--at-line)', borderRadius: '10px', minHeight: '60px' }}>
                  {contadoresEnRuta.length === 0 && (
                    <div style={{ padding: '20px', color: 'var(--at-ink-3)', textAlign: 'center', fontSize: '13px' }}>Agrega contadores desde el panel izquierdo</div>
                  )}
                  {contadoresEnRuta.map((c, idx) => (
                    <div
                      key={c.id}
                      draggable
                      onDragStart={() => handleDragStart(idx)}
                      onDragOver={e => handleDragOver(e, idx)}
                      onDrop={() => {
                        if (draggingIdx === null || dragOver.current === null || draggingIdx === dragOver.current) { setDraggingIdx(null); return }
                        setContadoresEnRuta(prev => {
                          const arr = [...prev]
                          const [moved] = arr.splice(draggingIdx, 1)
                          arr.splice(dragOver.current!, 0, moved)
                          return arr
                        })
                        setDraggingIdx(null)
                        dragOver.current = null
                      }}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--at-chip)', background: draggingIdx === idx ? 'var(--at-primary-tint)' : 'var(--at-surface)', cursor: 'grab', userSelect: 'none' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ color: 'var(--at-ink-3)', fontSize: '16px' }}>⠿</span>
                        <div>
                          <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-primary)', marginRight: '6px' }}>#{idx + 1}</span>
                          <span style={{ fontWeight: 600, fontSize: '13px' }}>{c.numero_serie}</span>
                          <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{c.tipo_agua}{c.descripcion ? ` · ${c.descripcion}` : ''}</div>
                        </div>
                      </div>
                      <button onClick={() => quitarContador(idx)} style={{ padding: '2px 8px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: '1px solid var(--at-danger-border)', borderRadius: '6px', cursor: 'pointer', fontWeight: 700 }}>×</button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* ── MODO UNIDADES ── */}
          {tipoRuta === 'unidades' && (
            <>
              <div>
                <div style={{ fontWeight: 700, marginBottom: '10px', color: 'var(--at-ink-2)' }}>
                  Unidades disponibles ({unidadesDisponibles.length})
                </div>
                <input
                  style={{ ...inputStyle, marginBottom: '10px' }}
                  placeholder="Buscar unidad..."
                  value={busqueda}
                  onChange={e => setBusqueda(e.target.value)}
                />
                <div style={{ maxHeight: '280px', overflowY: 'auto', border: '2px solid var(--at-line)', borderRadius: '10px' }}>
                  {unidadesDisponibles.length === 0 && (
                    <div style={{ padding: '16px', color: 'var(--at-ink-3)', textAlign: 'center', fontSize: '13px' }}>
                      {!form.project_id ? 'Selecciona un proyecto primero' : busqueda ? 'Sin resultados' : 'Todas las unidades ya están en la ruta'}
                    </div>
                  )}
                  {unidadesDisponibles.map(u => {
                    const proyecto = proyectos.find(p => p.id === u.project_id)
                    return (
                      <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--at-chip)' }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '13px' }}>{u.nombre}</div>
                          <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{proyecto?.nombre ?? ''} · {u.tipo}{u.piso != null ? ` · Piso ${u.piso}` : ''}</div>
                        </div>
                        <button onClick={() => agregarUnidad(u)} style={{ padding: '4px 10px', background: 'var(--at-primary)', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, fontSize: '16px' }}>+</button>
                      </div>
                    )
                  })}
                </div>
              </div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: '10px', color: 'var(--at-ink-2)' }}>
                  En esta ruta ({unidadesEnRuta.length}) — arrastra para reordenar
                </div>
                <div style={{ maxHeight: '370px', overflowY: 'auto', border: '2px solid var(--at-line)', borderRadius: '10px', minHeight: '60px' }}>
                  {unidadesEnRuta.length === 0 && (
                    <div style={{ padding: '20px', color: 'var(--at-ink-3)', textAlign: 'center', fontSize: '13px' }}>Agrega unidades desde el panel izquierdo</div>
                  )}
                  {unidadesEnRuta.map((u, idx) => (
                    <div
                      key={u.id}
                      draggable
                      onDragStart={() => handleDragStart(idx)}
                      onDragOver={e => handleDragOver(e, idx)}
                      onDrop={() => {
                        if (draggingIdx === null || dragOver.current === null || draggingIdx === dragOver.current) { setDraggingIdx(null); return }
                        setUnidadesEnRuta(prev => {
                          const arr = [...prev]
                          const [moved] = arr.splice(draggingIdx, 1)
                          arr.splice(dragOver.current!, 0, moved)
                          return arr
                        })
                        setDraggingIdx(null)
                        dragOver.current = null
                      }}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--at-chip)', background: draggingIdx === idx ? 'var(--at-primary-tint)' : 'var(--at-surface)', cursor: 'grab', userSelect: 'none' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ color: 'var(--at-ink-3)', fontSize: '16px' }}>⠿</span>
                        <div>
                          <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-primary)', marginRight: '6px' }}>#{idx + 1}</span>
                          <span style={{ fontWeight: 600, fontSize: '13px' }}>{u.nombre}</span>
                          <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{u.tipo}{u.piso != null ? ` · Piso ${u.piso}` : ''}</div>
                        </div>
                      </div>
                      <button onClick={() => quitarUnidad(idx)} style={{ padding: '2px 8px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: '1px solid var(--at-danger-border)', borderRadius: '6px', cursor: 'pointer', fontWeight: 700 }}>×</button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

        </div>

        {/* Botones */}
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button
            onClick={() => handleGuardar(false)}
            disabled={saving}
            style={{ padding: '12px 24px', background: 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-accent-2) 100%)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
          >
            {saving ? 'Guardando...' : '💾 Guardar Ruta'}
          </button>
          {(form.asignado_email || form.asignado_telefono) && (
            <button
              onClick={() => handleGuardar(true)}
              disabled={saving}
              style={{ padding: '12px 24px', background: 'linear-gradient(135deg, var(--at-success) 0%, var(--at-success-strong) 100%)', color: 'var(--at-on-status)', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
            >
              {saving ? 'Guardando...' : '💾 Guardar y Notificar'}
            </button>
          )}
          <button
            onClick={cancelar}
            style={{ padding: '12px 24px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
          >
            Cancelar
          </button>
        </div>
      </div>
    )
  }

  // ─── LISTA DE RUTAS ────────────────────────────────────────────────────────
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div style={{ fontSize: '22px', fontWeight: 700 }}>Rutas de Lectura</div>
        {canEdit && (
          <button
            onClick={abrirCrear}
            style={{ padding: '10px 20px', background: 'linear-gradient(135deg, var(--at-primary) 0%, var(--at-accent-2) 100%)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
          >
            + Nueva Ruta
          </button>
        )}
      </div>

      {rutas.length === 0 && (
        <div style={{ background: 'var(--at-surface)', borderRadius: '24px', padding: '48px', textAlign: 'center', boxShadow: '0 10px 40px rgba(0,0,0,0.08)', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>🗺️</div>
          <div style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>No hay rutas creadas</div>
          <div>Crea una ruta para planificar el orden de lecturas</div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
        {rutas.map(ruta => {
          const estado = estadoRuta(ruta)
          const tipo = ruta.tipo_ruta ?? 'clientes'
          const tipoLabel = tipo === 'contadores' ? 'Por contador' : tipo === 'unidades' ? 'Por unidad' : 'Por cliente'
          const itemCount = tipo === 'contadores'
            ? (ruta.contador_ids ?? []).length
            : tipo === 'unidades'
            ? (ruta.unidad_ids ?? []).length
            : (ruta.cliente_ids ?? []).length
          const itemLabel = tipo === 'contadores' ? 'contador' : tipo === 'unidades' ? 'unidad' : 'cliente'
          const proyectoNombre = ruta.project_id ? proyectos.find(p => p.id === ruta.project_id)?.nombre : null
          const preview = tipo === 'contadores'
            ? (ruta.contador_ids ?? []).slice(0, 4).map(id => contadores.find(c => c.id === id)?.numero_serie ?? '?')
            : tipo === 'unidades'
            ? (ruta.unidad_ids ?? []).slice(0, 4).map(id => unidades.find(u => u.id === id)?.nombre ?? '?')
            : (ruta.cliente_ids ?? []).slice(0, 4).map(id => clientes.find(c => c.id === id)?.nombre ?? '?')
          return (
            <div
              key={ruta.id}
              style={{ background: 'var(--at-surface)', borderRadius: '16px', padding: '20px', boxShadow: '0 4px 20px rgba(0,0,0,0.06)', border: '1px solid var(--at-line)' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '16px', marginBottom: '2px' }}>{ruta.nombre}</div>
                  <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginBottom: '2px' }}>{tipoLabel}{proyectoNombre ? ` · ${proyectoNombre}` : ''}</div>
                  {ruta.descripcion && (
                    <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>{ruta.descripcion}</div>
                  )}
                </div>
                <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: estado.bg, color: estado.color, whiteSpace: 'nowrap' }}>
                  {estado.label}
                </span>
              </div>

              <div style={{ fontSize: '13px', color: 'var(--at-ink-2)', marginBottom: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div>🔁 {describirRecurrencia(ruta)}</div>
                <div>📅 {ruta.fecha_programada ? new Date(ruta.fecha_programada + 'T12:00:00').toLocaleDateString('es-GT') : ((ruta.frecuencia ?? 'unica') !== 'unica' ? 'Recurrente' : 'Sin fecha')}</div>
                <div>👤 {ruta.asignado_nombre ?? 'Sin asignar'}</div>
                <div>📍 {itemCount} {itemLabel}{itemCount !== 1 ? 's' : ''}</div>
              </div>

              {preview.length > 0 && (
                <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', marginBottom: '14px', lineHeight: '1.6' }}>
                  {preview.join(' → ')}
                  {itemCount > 4 && ` → +${itemCount - 4} más`}
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {!ruta.completada && (
                  <button
                    onClick={() => onEjecutarRuta(ruta)}
                    style={{ padding: '8px 14px', background: 'linear-gradient(135deg, var(--at-success) 0%, var(--at-success-strong) 100%)', color: 'var(--at-on-status)', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}
                  >
                    ▶ Ejecutar
                  </button>
                )}
                {canEdit && (
                  <>
                    <button
                      onClick={() => handleRecordarAhora(ruta)}
                      disabled={recordandoId === ruta.id}
                      title="Enviar recordatorio al operador y administradores"
                      style={{ padding: '8px 14px', background: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)', border: '1px solid var(--at-primary-soft-2)', borderRadius: '8px', fontWeight: 600, cursor: recordandoId === ruta.id ? 'wait' : 'pointer', fontSize: '13px' }}
                    >
                      {recordandoId === ruta.id ? 'Enviando…' : '🔔 Recordar'}
                    </button>
                    <button
                      onClick={() => abrirEditar(ruta)}
                      style={{ padding: '8px 14px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => handleEliminar(ruta)}
                      style={{ padding: '8px 14px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: '1px solid var(--at-danger-border)', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}
                    >
                      Eliminar
                    </button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
