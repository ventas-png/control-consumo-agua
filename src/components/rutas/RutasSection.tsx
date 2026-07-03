import { useState, useEffect, useRef, type DragEvent } from 'react'
import { confirm, notify } from '../shared/Dialog'
import type { Cliente, Contador, Unidad, Proyecto, Ruta, UserRole } from '../../types'
import { fetchActiveAppUsers, type AppUser } from '../../domain/usuarios/queries'
import { createRuta, updateRuta, deleteRuta } from '../../domain/rutas/mutations'
import { enviarNotificacionRuta, dispararRecordatorioRuta } from '../../lib/email'
import { APP_CONFIG } from '../../lib/config'
import {
  construirPayloadRuta,
  construirWhatsAppRuta,
  filtrarClientesDisponibles,
  filtrarContadoresDisponibles,
  filtrarUnidadesDisponibles,
  validarRuta,
  type RutaForm,
  type TipoRuta,
} from '../../lib/rutasReglas'
import { EMPTY_FORM, type RutasCtx } from './ctx'
import { RutaEditor } from './RutaEditor'
import { RutaCard } from './RutaCard'

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
  canDelete?: boolean
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
  canDelete: canDeleteProp = true,
}: Props) {
  const [editando, setEditando] = useState<Ruta | null>(null)
  const [creando, setCreando] = useState(false)
  const [form, setForm] = useState<RutaForm>(EMPTY_FORM)
  const [tipoRuta, setTipoRuta] = useState<TipoRuta>('clientes')
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
  // Eliminar conserva la condición de rol y además exige el permiso granular (RBAC)
  const canDelete = canEdit && canDeleteProp

  useEffect(() => {
    void fetchActiveAppUsers().then(setUsuarios)
  }, [])

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
    const aviso = validarRuta(form, tipoRuta, {
      clientes: clientesEnRuta.length,
      contadores: contadoresEnRuta.length,
      unidades: unidadesEnRuta.length,
    })
    if (aviso) {
      notify({ variant: 'warning', title: 'Atención', text: aviso })
      return
    }

    setSaving(true)
    const payload = construirPayloadRuta(
      form,
      tipoRuta,
      clientesEnRuta.map(c => c.id),
      contadoresEnRuta.map(c => c.id),
      unidadesEnRuta.map(u => u.id)
    )

    let rutaGuardada: Ruta | null = null

    if (editando) {
      const { data, error } = await updateRuta(editando.id, payload)
      if (error || !data) {
        notify({ variant: 'error', title: 'Error', text: 'No se pudo actualizar la ruta' })
        setSaving(false)
        return
      }
      rutaGuardada = data
      onRutaUpdated(editando.id, rutaGuardada)
    } else {
      const { data, error } = await createRuta(payload)
      if (error || !data) {
        notify({ variant: 'error', title: 'Error', text: 'No se pudo guardar la ruta' })
        setSaving(false)
        return
      }
      rutaGuardada = data
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
    const wa = construirWhatsAppRuta(ruta, APP_CONFIG.COUNTRY_CODE)
    if (wa) {
      window.open(`https://wa.me/${wa.tel}?text=${encodeURIComponent(wa.msg)}`, '_blank')
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
    const { error } = await deleteRuta(ruta.id)
    if (error) { notify({ variant: 'error', title: 'Error', text: 'No se pudo eliminar la ruta' }); return }
    onRutaDeleted(ruta.id)
  }

  const clientesDisponibles = filtrarClientesDisponibles(clientes, clientesEnRuta, busqueda)
  const contadoresDisponibles = filtrarContadoresDisponibles(contadores, contadoresEnRuta, busqueda, form.project_id)
  const unidadesDisponibles = filtrarUnidadesDisponibles(unidades, unidadesEnRuta, busqueda, form.project_id)

  const hoy = new Date().toISOString().split('T')[0]

  const ctx: RutasCtx = {
    clientes, contadores, unidades, proyectos, canEdit, canDelete, onEjecutarRuta,
    editando, form, setForm, tipoRuta, setTipoRuta,
    clientesEnRuta, contadoresEnRuta, setContadoresEnRuta,
    unidadesEnRuta, setUnidadesEnRuta,
    busqueda, setBusqueda, saving, recordandoId,
    nuevaFecha, setNuevaFecha, usuarios, draggingIdx, setDraggingIdx, dragOver,
    hoy, clientesDisponibles, contadoresDisponibles, unidadesDisponibles,
    abrirEditar, cancelar, handleProjectChange, handleUsuarioChange,
    toggleDiaSemana, agregarFecha, quitarFecha, toggleCanal, handleRecordarAhora,
    agregarCliente, quitarCliente, agregarContador, quitarContador,
    agregarUnidad, quitarUnidad,
    handleDragStart, handleDragOver, handleDrop, handleGuardar, handleEliminar,
  }

  // ─── EDITOR ────────────────────────────────────────────────────────────────
  if (creando) {
    return <RutaEditor ctx={ctx} />
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
        {rutas.map(ruta => <RutaCard key={ruta.id} ruta={ruta} ctx={ctx} />)}
      </div>
    </div>
  )
}
