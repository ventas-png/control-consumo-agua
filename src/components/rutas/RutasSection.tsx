import { useState, useEffect, useRef, type CSSProperties, type DragEvent} from 'react'
import Swal from 'sweetalert2'
import type { Cliente, Contador, Unidad, Proyecto, Ruta, UserRole } from '../../types'
import { supabase } from '../../lib/supabase'
import { enviarNotificacionRuta } from '../../lib/email'
import { APP_CONFIG } from '../../lib/config'

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
  fecha_programada: '',
  asignado_a: '',
  asignado_nombre: '',
  asignado_email: '',
  asignado_telefono: '',
}

export function RutasSection({
  clientes,
  contadores,
  unidades,
  proyectos,
  rutas,
  userRole,
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
  const [proyectoFiltro, setProyectoFiltro] = useState('')
  const [clientesEnRuta, setClientesEnRuta] = useState<Cliente[]>([])
  const [contadoresEnRuta, setContadoresEnRuta] = useState<Contador[]>([])
  const [unidadesEnRuta, setUnidadesEnRuta] = useState<Unidad[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [saving, setSaving] = useState(false)
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
    border: '2px solid #e2e8f0',
    borderRadius: '8px',
    fontSize: '14px',
    width: '100%',
    boxSizing: 'border-box',
  }
  const labelStyle: CSSProperties = {
    fontSize: '13px',
    fontWeight: 600,
    color: '#4a5568',
    marginBottom: '4px',
    display: 'block',
  }

  function abrirCrear() {
    setForm(EMPTY_FORM)
    setTipoRuta('clientes')
    setProyectoFiltro('')
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
      fecha_programada: ruta.fecha_programada ?? '',
      asignado_a: ruta.asignado_a ?? '',
      asignado_nombre: ruta.asignado_nombre ?? '',
      asignado_email: ruta.asignado_email ?? '',
      asignado_telefono: ruta.asignado_telefono ?? '',
    })
    const tipo = ruta.tipo_ruta ?? 'clientes'
    setTipoRuta(tipo)
    setProyectoFiltro('')
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
    setProyectoFiltro('')
    setClientesEnRuta([])
    setContadoresEnRuta([])
    setUnidadesEnRuta([])
  }

  function handleUsuarioChange(userId: string) {
    const usuario = usuarios.find(u => u.id === userId)
    setForm(prev => ({
      ...prev,
      asignado_a: userId,
      asignado_nombre: usuario?.full_name ?? '',
    }))
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
      Swal.fire('Atención', 'El nombre de la ruta es obligatorio', 'warning')
      return
    }
    if (tipoRuta === 'clientes' && clientesEnRuta.length === 0) {
      Swal.fire('Atención', 'Agrega al menos un cliente a la ruta', 'warning')
      return
    }
    if (tipoRuta === 'contadores' && contadoresEnRuta.length === 0) {
      Swal.fire('Atención', 'Agrega al menos un contador a la ruta', 'warning')
      return
    }
    if (tipoRuta === 'unidades' && unidadesEnRuta.length === 0) {
      Swal.fire('Atención', 'Agrega al menos una unidad a la ruta', 'warning')
      return
    }

    setSaving(true)
    const payload = {
      nombre: form.nombre.trim(),
      descripcion: form.descripcion.trim() || null,
      tipo_ruta: tipoRuta,
      cliente_ids: tipoRuta === 'clientes' ? clientesEnRuta.map(c => c.id) : [],
      contador_ids: tipoRuta === 'contadores' ? contadoresEnRuta.map(c => c.id) : [],
      unidad_ids: tipoRuta === 'unidades' ? unidadesEnRuta.map(u => u.id) : [],
      asignado_a: form.asignado_a || null,
      asignado_nombre: form.asignado_nombre || null,
      asignado_email: form.asignado_email || null,
      asignado_telefono: form.asignado_telefono || null,
      fecha_programada: form.fecha_programada || null,
    }

    let rutaGuardada: Ruta | null = null

    if (editando) {
      const { data, error } = await supabase
        .from('rutas')
        .update(payload)
        .eq('id', editando.id)
        .select()
      if (error || !data) {
        Swal.fire('Error', 'No se pudo actualizar la ruta', 'error')
        setSaving(false)
        return
      }
      rutaGuardada = data[0] as Ruta
      onRutaUpdated(editando.id, rutaGuardada)
    } else {
      const { data, error } = await supabase.from('rutas').insert(payload).select()
      if (error || !data) {
        Swal.fire('Error', 'No se pudo guardar la ruta', 'error')
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

    Swal.fire({
      icon: 'success',
      title: editando ? 'Ruta actualizada' : 'Ruta guardada',
      timer: 2000,
      showConfirmButton: false,
    })
    cancelar()
  }

  async function enviarNotificaciones(ruta: Ruta) {
    const promesas: Promise<void>[] = []

    // Email
    if (ruta.asignado_email) {
      promesas.push(
        enviarNotificacionRuta(ruta).catch(() => {
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
    const result = await Swal.fire({
      title: `¿Eliminar "${ruta.nombre}"?`,
      text: 'Esta acción no se puede deshacer',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#64748b',
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar',
    })
    if (!result.isConfirmed) return
    const { error } = await supabase.from('rutas').delete().eq('id', ruta.id)
    if (error) { Swal.fire('Error', 'No se pudo eliminar la ruta', 'error'); return }
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
    if (proyectoFiltro && c.project_id !== proyectoFiltro) return false
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
    if (proyectoFiltro && u.project_id !== proyectoFiltro) return false
    const texto = busqueda.toLowerCase()
    if (!texto) return true
    return (
      u.nombre.toLowerCase().includes(texto) ||
      u.tipo.toLowerCase().includes(texto)
    )
  })

  const hoy = new Date().toISOString().split('T')[0]

  function estadoRuta(ruta: Ruta) {
    if (ruta.completada) return { label: 'Completada', color: '#166534', bg: '#dcfce7' }
    if (ruta.fecha_programada && ruta.fecha_programada < hoy)
      return { label: 'Vencida', color: '#dc2626', bg: '#fef2f2' }
    if (ruta.fecha_programada === hoy) return { label: 'Hoy', color: '#d97706', bg: '#fef9c3' }
    return { label: 'Pendiente', color: '#0369a1', bg: '#e0f2fe' }
  }

  // ─── EDITOR ────────────────────────────────────────────────────────────────
  if (creando) {
    return (
      <div style={{ background: 'white', borderRadius: '24px', padding: '32px', boxShadow: '0 10px 40px rgba(0,0,0,0.08)' }}>
        <div style={{ fontSize: '20px', fontWeight: 700, marginBottom: '24px', borderBottom: '2px solid #e2e8f0', paddingBottom: '12px' }}>
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

        {/* Asignación de operador */}
        <div style={{ background: '#f8fafc', borderRadius: '12px', padding: '20px', marginBottom: '24px', border: '1px solid #e2e8f0' }}>
          <div style={{ fontWeight: 700, marginBottom: '16px', color: '#374151' }}>Asignar Operador</div>
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
          <div style={{ fontWeight: 700, marginBottom: '10px', color: '#374151', fontSize: '14px' }}>Tipo de Ruta</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {(['clientes', 'contadores', 'unidades'] as const).map(tipo => {
              const labels = { clientes: 'Por cliente', contadores: 'Por contador', unidades: 'Por unidad' }
              const active = tipoRuta === tipo
              return (
                <button
                  key={tipo}
                  onClick={() => { setTipoRuta(tipo); setBusqueda(''); setProyectoFiltro('') }}
                  style={{
                    padding: '8px 18px',
                    border: active ? 'none' : '2px solid #e2e8f0',
                    borderRadius: '8px',
                    fontWeight: 600,
                    fontSize: '13px',
                    cursor: 'pointer',
                    background: active ? 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%)' : '#f8fafc',
                    color: active ? 'white' : '#475569',
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
                <div style={{ fontWeight: 700, marginBottom: '10px', color: '#374151' }}>
                  Clientes disponibles ({clientesDisponibles.length})
                </div>
                <input
                  style={{ ...inputStyle, marginBottom: '10px' }}
                  placeholder="Buscar cliente..."
                  value={busqueda}
                  onChange={e => setBusqueda(e.target.value)}
                />
                <div style={{ maxHeight: '320px', overflowY: 'auto', border: '2px solid #e2e8f0', borderRadius: '10px' }}>
                  {clientesDisponibles.length === 0 && (
                    <div style={{ padding: '16px', color: '#94a3b8', textAlign: 'center', fontSize: '13px' }}>
                      {busqueda ? 'Sin resultados' : 'Todos los clientes ya están en la ruta'}
                    </div>
                  )}
                  {clientesDisponibles.map(c => (
                    <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #f1f5f9' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '13px' }}>{c.nombre}</div>
                        <div style={{ fontSize: '11px', color: '#94a3b8' }}>{c.codigo}</div>
                      </div>
                      <button onClick={() => agregarCliente(c)} style={{ padding: '4px 10px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, fontSize: '16px' }}>+</button>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: '10px', color: '#374151' }}>
                  En esta ruta ({clientesEnRuta.length}) — arrastra para reordenar
                </div>
                <div style={{ maxHeight: '370px', overflowY: 'auto', border: '2px solid #e2e8f0', borderRadius: '10px', minHeight: '60px' }}>
                  {clientesEnRuta.length === 0 && (
                    <div style={{ padding: '20px', color: '#94a3b8', textAlign: 'center', fontSize: '13px' }}>Agrega clientes desde el panel izquierdo</div>
                  )}
                  {clientesEnRuta.map((c, idx) => (
                    <div
                      key={c.id}
                      draggable
                      onDragStart={() => handleDragStart(idx)}
                      onDragOver={e => handleDragOver(e, idx)}
                      onDrop={handleDrop}
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #f1f5f9', background: draggingIdx === idx ? '#f0f9ff' : 'white', cursor: 'grab', userSelect: 'none' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ color: '#94a3b8', fontSize: '16px' }}>⠿</span>
                        <div>
                          <span style={{ fontSize: '11px', fontWeight: 700, color: '#0ea5e9', marginRight: '6px' }}>#{idx + 1}</span>
                          <span style={{ fontWeight: 600, fontSize: '13px' }}>{c.nombre}</span>
                          <div style={{ fontSize: '11px', color: '#94a3b8' }}>{c.codigo}</div>
                        </div>
                      </div>
                      <button onClick={() => quitarCliente(idx)} style={{ padding: '2px 8px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: '6px', cursor: 'pointer', fontWeight: 700 }}>×</button>
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
                <div style={{ fontWeight: 700, marginBottom: '10px', color: '#374151' }}>
                  Contadores disponibles ({contadoresDisponibles.length})
                </div>
                <select
                  style={{ ...inputStyle, marginBottom: '8px' }}
                  value={proyectoFiltro}
                  onChange={e => setProyectoFiltro(e.target.value)}
                >
                  <option value="">-- Todos los proyectos --</option>
                  {proyectos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
                <input
                  style={{ ...inputStyle, marginBottom: '10px' }}
                  placeholder="Buscar contador..."
                  value={busqueda}
                  onChange={e => setBusqueda(e.target.value)}
                />
                <div style={{ maxHeight: '280px', overflowY: 'auto', border: '2px solid #e2e8f0', borderRadius: '10px' }}>
                  {contadoresDisponibles.length === 0 && (
                    <div style={{ padding: '16px', color: '#94a3b8', textAlign: 'center', fontSize: '13px' }}>
                      {busqueda || proyectoFiltro ? 'Sin resultados' : 'Todos los contadores ya están en la ruta'}
                    </div>
                  )}
                  {contadoresDisponibles.map(c => {
                    const proyecto = proyectos.find(p => p.id === c.project_id)
                    return (
                      <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #f1f5f9' }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '13px' }}>{c.numero_serie}</div>
                          <div style={{ fontSize: '11px', color: '#94a3b8' }}>{proyecto?.nombre ?? ''}{c.descripcion ? ` · ${c.descripcion}` : ''} · {c.tipo_agua}</div>
                        </div>
                        <button onClick={() => agregarContador(c)} style={{ padding: '4px 10px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, fontSize: '16px' }}>+</button>
                      </div>
                    )
                  })}
                </div>
              </div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: '10px', color: '#374151' }}>
                  En esta ruta ({contadoresEnRuta.length}) — arrastra para reordenar
                </div>
                <div style={{ maxHeight: '370px', overflowY: 'auto', border: '2px solid #e2e8f0', borderRadius: '10px', minHeight: '60px' }}>
                  {contadoresEnRuta.length === 0 && (
                    <div style={{ padding: '20px', color: '#94a3b8', textAlign: 'center', fontSize: '13px' }}>Agrega contadores desde el panel izquierdo</div>
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
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #f1f5f9', background: draggingIdx === idx ? '#f0f9ff' : 'white', cursor: 'grab', userSelect: 'none' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ color: '#94a3b8', fontSize: '16px' }}>⠿</span>
                        <div>
                          <span style={{ fontSize: '11px', fontWeight: 700, color: '#0ea5e9', marginRight: '6px' }}>#{idx + 1}</span>
                          <span style={{ fontWeight: 600, fontSize: '13px' }}>{c.numero_serie}</span>
                          <div style={{ fontSize: '11px', color: '#94a3b8' }}>{c.tipo_agua}{c.descripcion ? ` · ${c.descripcion}` : ''}</div>
                        </div>
                      </div>
                      <button onClick={() => quitarContador(idx)} style={{ padding: '2px 8px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: '6px', cursor: 'pointer', fontWeight: 700 }}>×</button>
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
                <div style={{ fontWeight: 700, marginBottom: '10px', color: '#374151' }}>
                  Unidades disponibles ({unidadesDisponibles.length})
                </div>
                <select
                  style={{ ...inputStyle, marginBottom: '8px' }}
                  value={proyectoFiltro}
                  onChange={e => setProyectoFiltro(e.target.value)}
                >
                  <option value="">-- Todos los proyectos --</option>
                  {proyectos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
                <input
                  style={{ ...inputStyle, marginBottom: '10px' }}
                  placeholder="Buscar unidad..."
                  value={busqueda}
                  onChange={e => setBusqueda(e.target.value)}
                />
                <div style={{ maxHeight: '280px', overflowY: 'auto', border: '2px solid #e2e8f0', borderRadius: '10px' }}>
                  {unidadesDisponibles.length === 0 && (
                    <div style={{ padding: '16px', color: '#94a3b8', textAlign: 'center', fontSize: '13px' }}>
                      {busqueda || proyectoFiltro ? 'Sin resultados' : 'Todas las unidades ya están en la ruta'}
                    </div>
                  )}
                  {unidadesDisponibles.map(u => {
                    const proyecto = proyectos.find(p => p.id === u.project_id)
                    return (
                      <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #f1f5f9' }}>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '13px' }}>{u.nombre}</div>
                          <div style={{ fontSize: '11px', color: '#94a3b8' }}>{proyecto?.nombre ?? ''} · {u.tipo}{u.piso != null ? ` · Piso ${u.piso}` : ''}</div>
                        </div>
                        <button onClick={() => agregarUnidad(u)} style={{ padding: '4px 10px', background: '#0ea5e9', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 700, fontSize: '16px' }}>+</button>
                      </div>
                    )
                  })}
                </div>
              </div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: '10px', color: '#374151' }}>
                  En esta ruta ({unidadesEnRuta.length}) — arrastra para reordenar
                </div>
                <div style={{ maxHeight: '370px', overflowY: 'auto', border: '2px solid #e2e8f0', borderRadius: '10px', minHeight: '60px' }}>
                  {unidadesEnRuta.length === 0 && (
                    <div style={{ padding: '20px', color: '#94a3b8', textAlign: 'center', fontSize: '13px' }}>Agrega unidades desde el panel izquierdo</div>
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
                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #f1f5f9', background: draggingIdx === idx ? '#f0f9ff' : 'white', cursor: 'grab', userSelect: 'none' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ color: '#94a3b8', fontSize: '16px' }}>⠿</span>
                        <div>
                          <span style={{ fontSize: '11px', fontWeight: 700, color: '#0ea5e9', marginRight: '6px' }}>#{idx + 1}</span>
                          <span style={{ fontWeight: 600, fontSize: '13px' }}>{u.nombre}</span>
                          <div style={{ fontSize: '11px', color: '#94a3b8' }}>{u.tipo}{u.piso != null ? ` · Piso ${u.piso}` : ''}</div>
                        </div>
                      </div>
                      <button onClick={() => quitarUnidad(idx)} style={{ padding: '2px 8px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: '6px', cursor: 'pointer', fontWeight: 700 }}>×</button>
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
            style={{ padding: '12px 24px', background: 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
          >
            {saving ? 'Guardando...' : '💾 Guardar Ruta'}
          </button>
          {(form.asignado_email || form.asignado_telefono) && (
            <button
              onClick={() => handleGuardar(true)}
              disabled={saving}
              style={{ padding: '12px 24px', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
            >
              {saving ? 'Guardando...' : '💾 Guardar y Notificar'}
            </button>
          )}
          <button
            onClick={cancelar}
            style={{ padding: '12px 24px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
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
            style={{ padding: '10px 20px', background: 'linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%)', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
          >
            + Nueva Ruta
          </button>
        )}
      </div>

      {rutas.length === 0 && (
        <div style={{ background: 'white', borderRadius: '24px', padding: '48px', textAlign: 'center', boxShadow: '0 10px 40px rgba(0,0,0,0.08)', color: '#94a3b8' }}>
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
          const preview = tipo === 'contadores'
            ? (ruta.contador_ids ?? []).slice(0, 4).map(id => contadores.find(c => c.id === id)?.numero_serie ?? '?')
            : tipo === 'unidades'
            ? (ruta.unidad_ids ?? []).slice(0, 4).map(id => unidades.find(u => u.id === id)?.nombre ?? '?')
            : (ruta.cliente_ids ?? []).slice(0, 4).map(id => clientes.find(c => c.id === id)?.nombre ?? '?')
          return (
            <div
              key={ruta.id}
              style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 4px 20px rgba(0,0,0,0.06)', border: '1px solid #e2e8f0' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '16px', marginBottom: '2px' }}>{ruta.nombre}</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '2px' }}>{tipoLabel}</div>
                  {ruta.descripcion && (
                    <div style={{ fontSize: '12px', color: '#64748b' }}>{ruta.descripcion}</div>
                  )}
                </div>
                <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, background: estado.bg, color: estado.color, whiteSpace: 'nowrap' }}>
                  {estado.label}
                </span>
              </div>

              <div style={{ fontSize: '13px', color: '#475569', marginBottom: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div>📅 {ruta.fecha_programada ? new Date(ruta.fecha_programada + 'T12:00:00').toLocaleDateString('es-GT') : 'Sin fecha'}</div>
                <div>👤 {ruta.asignado_nombre ?? 'Sin asignar'}</div>
                <div>📍 {itemCount} {itemLabel}{itemCount !== 1 ? 's' : ''}</div>
              </div>

              {preview.length > 0 && (
                <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '14px', lineHeight: '1.6' }}>
                  {preview.join(' → ')}
                  {itemCount > 4 && ` → +${itemCount - 4} más`}
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {!ruta.completada && (
                  <button
                    onClick={() => onEjecutarRuta(ruta)}
                    style={{ padding: '8px 14px', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}
                  >
                    ▶ Ejecutar
                  </button>
                )}
                {canEdit && (
                  <>
                    <button
                      onClick={() => abrirEditar(ruta)}
                      style={{ padding: '8px 14px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => handleEliminar(ruta)}
                      style={{ padding: '8px 14px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', fontSize: '13px' }}
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
