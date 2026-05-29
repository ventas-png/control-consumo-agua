import { useState, useEffect } from 'react'
import Swal from 'sweetalert2'
import { notify } from '../shared/Dialog'
import { supabase } from '../../lib/supabase'
import type {
  Cliente, Unidad, ContratoArrendamiento, ReservaSTR,
  EstadoContrato, EstadoSTR, PlataformaSTR,
} from '../../types'
import { EditModal } from '../shared/EditModal'

interface Props {
  cliente: Cliente
  unidades: Unidad[]
  companyId: string
  canEdit: boolean
  onClose: () => void
}

type Tab = 'arrendamiento' | 'str'

const ESTADO_CONTRATO_CONFIG: Record<EstadoContrato, { label: string; bg: string; color: string }> = {
  activo:    { label: 'Activo',    bg: 'var(--at-success-tint)', color: 'var(--at-success)' },
  vencido:   { label: 'Vencido',   bg: 'var(--at-danger-tint)', color: 'var(--at-danger)' },
  terminado: { label: 'Terminado', bg: 'var(--at-surface-2)', color: 'var(--at-ink-3)' },
}

const ESTADO_STR_CONFIG: Record<EstadoSTR, { label: string; color: string; bg: string }> = {
  confirmada: { label: 'Confirmada', color: 'var(--at-primary)', bg: 'var(--at-primary-soft)' },
  en_curso:   { label: 'En curso',   color: 'var(--at-accent)', bg: 'var(--at-accent-tint)' },
  completada: { label: 'Completada', color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  cancelada:  { label: 'Cancelada',  color: 'var(--at-danger)', bg: 'var(--at-danger-tint)' },
}

const PLATAFORMA_LABEL: Record<PlataformaSTR, string> = {
  airbnb: '🏠 Airbnb', booking: '🌐 Booking.com', vrbo: '🏡 VRBO',
  directo: '📱 Directo', otro: '📋 Otro',
}

const EMPTY_CONTRATO = {
  unidad_id: '', arrendatario_nombre: '', arrendatario_identificacion: '',
  arrendatario_telefono: '', arrendatario_email: '',
  monto_renta: '', dia_pago: '5', fecha_inicio: '', fecha_fin: '', deposito: '', notas: '',
}

const EMPTY_STR = {
  unidad_id: '', huesped_nombre: '', huesped_email: '', huesped_telefono: '',
  fecha_entrada: '', fecha_salida: '', num_adultos: '1', num_ninos: '0',
  plataforma: 'directo' as PlataformaSTR, monto_noche: '', monto_total: '',
  estado: 'confirmada' as EstadoSTR, notas: '',
}

function calcNoches(entrada: string, salida: string) {
  if (!entrada || !salida) return 0
  return Math.max(0, Math.round((new Date(salida).getTime() - new Date(entrada).getTime()) / 86400000))
}

export function ClienteRentasModal({ cliente, unidades, companyId, canEdit, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('arrendamiento')
  const [contratos, setContratos] = useState<ContratoArrendamiento[]>([])
  const [reservas, setReservas] = useState<ReservaSTR[]>([])
  const [loading, setLoading] = useState(true)

  // Arrendamiento form state
  const [showContratoForm, setShowContratoForm] = useState(false)
  const [editingContratoId, setEditingContratoId] = useState<string | null>(null)
  const [contratoForm, setContratoForm] = useState(EMPTY_CONTRATO)
  const [savingContrato, setSavingContrato] = useState(false)

  // STR form state
  const [showSTRForm, setShowSTRForm] = useState(false)
  const [editingSTRId, setEditingSTRId] = useState<string | null>(null)
  const [strForm, setStrForm] = useState(EMPTY_STR)
  const [savingSTR, setSavingSTR] = useState(false)

  // Filter units that belong to this client
  const clienteUnidades = unidades.filter(u => u.cliente_id === cliente.id && u.activo)

  useEffect(() => {
    fetchData()
  }, [cliente.id])

  async function fetchData() {
    if (clienteUnidades.length === 0) { setLoading(false); return }
    const unidadIds = clienteUnidades.map(u => u.id)
    setLoading(true)
    const [contratosRes, reservasRes] = await Promise.all([
      supabase
        .from('contratos_arrendamiento')
        .select('*')
        .in('unidad_id', unidadIds)
        .order('created_at', { ascending: false }),
      supabase
        .from('reservas_str')
        .select('*')
        .in('unidad_id', unidadIds)
        .order('fecha_entrada', { ascending: false }),
    ])
    if (contratosRes.data) setContratos(contratosRes.data as ContratoArrendamiento[])
    if (reservasRes.data) setReservas(reservasRes.data as ReservaSTR[])
    setLoading(false)
  }

  // ── Arrendamiento CRUD ──────────────────────────────────────────────────────

  function startNewContrato() {
    setContratoForm({
      ...EMPTY_CONTRATO,
      unidad_id: clienteUnidades.length === 1 ? clienteUnidades[0].id : '',
    })
    setEditingContratoId(null)
    setShowContratoForm(true)
  }

  function startEditContrato(c: ContratoArrendamiento) {
    setContratoForm({
      unidad_id: c.unidad_id,
      arrendatario_nombre: c.arrendatario_nombre,
      arrendatario_identificacion: c.arrendatario_identificacion ?? '',
      arrendatario_telefono: c.arrendatario_telefono ?? '',
      arrendatario_email: c.arrendatario_email ?? '',
      monto_renta: String(c.monto_renta),
      dia_pago: String(c.dia_pago),
      fecha_inicio: c.fecha_inicio,
      fecha_fin: c.fecha_fin ?? '',
      deposito: c.deposito != null ? String(c.deposito) : '',
      notas: c.notas ?? '',
    })
    setEditingContratoId(c.id)
    setShowContratoForm(true)
  }

  function cancelContratoForm() {
    setShowContratoForm(false)
    setEditingContratoId(null)
    setContratoForm(EMPTY_CONTRATO)
  }

  async function handleGuardarContrato() {
    if (!contratoForm.arrendatario_nombre.trim()) {
      notify({ variant: 'error', title: 'Error', text: 'Ingrese el nombre del arrendatario.' }); return
    }
    if (!contratoForm.unidad_id) {
      notify({ variant: 'error', title: 'Error', text: 'Seleccione la unidad.' }); return
    }
    if (!contratoForm.monto_renta || isNaN(Number(contratoForm.monto_renta))) {
      notify({ variant: 'error', title: 'Error', text: 'Ingrese el monto de renta.' }); return
    }
    if (!contratoForm.fecha_inicio) {
      notify({ variant: 'error', title: 'Error', text: 'Ingrese la fecha de inicio.' }); return
    }

    const unidad = clienteUnidades.find(u => u.id === contratoForm.unidad_id)
    if (!unidad) { notify({ variant: 'error', title: 'Error', text: 'Unidad no encontrada.' }); return }

    setSavingContrato(true)
    const payload = {
      company_id: companyId,
      project_id: unidad.project_id,
      unidad_id: contratoForm.unidad_id,
      arrendatario_nombre: contratoForm.arrendatario_nombre.trim(),
      arrendatario_identificacion: contratoForm.arrendatario_identificacion.trim() || null,
      arrendatario_telefono: contratoForm.arrendatario_telefono.trim() || null,
      arrendatario_email: contratoForm.arrendatario_email.trim() || null,
      monto_renta: Number(contratoForm.monto_renta),
      dia_pago: Number(contratoForm.dia_pago) || 5,
      fecha_inicio: contratoForm.fecha_inicio,
      fecha_fin: contratoForm.fecha_fin || null,
      deposito: contratoForm.deposito ? Number(contratoForm.deposito) : null,
      notas: contratoForm.notas.trim() || null,
      estado: 'activo' as EstadoContrato,
    }

    let error
    if (editingContratoId) {
      ;({ error } = await supabase.from('contratos_arrendamiento').update(payload).eq('id', editingContratoId))
    } else {
      ;({ error } = await supabase.from('contratos_arrendamiento').insert(payload))
    }

    setSavingContrato(false)
    if (error) {
      notify({ variant: 'error', title: 'Error', text: error.message ?? 'No se pudo guardar el contrato.' })
    } else {
      Swal.fire({ icon: 'success', title: editingContratoId ? 'Contrato actualizado' : 'Contrato creado', timer: 1800, showConfirmButton: false })
      cancelContratoForm()
      await fetchData()
    }
  }

  async function handleEliminarContrato(c: ContratoArrendamiento) {
    const result = await Swal.fire({
      title: '¿Eliminar contrato?',
      text: `Arrendatario: ${c.arrendatario_nombre}`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: 'var(--at-danger)',
      cancelButtonColor: 'var(--at-ink-3)',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
    })
    if (!result.isConfirmed) return
    const { error } = await supabase.from('contratos_arrendamiento').delete().eq('id', c.id)
    if (error) {
      notify({ variant: 'error', title: 'Error', text: error.message })
    } else {
      setContratos((prev: ContratoArrendamiento[]) => prev.filter((x: ContratoArrendamiento) => x.id !== c.id))
    }
  }

  // ── STR CRUD ────────────────────────────────────────────────────────────────

  function startNewSTR() {
    setStrForm({
      ...EMPTY_STR,
      unidad_id: clienteUnidades.length === 1 ? clienteUnidades[0].id : '',
    })
    setEditingSTRId(null)
    setShowSTRForm(true)
  }

  function startEditSTR(r: ReservaSTR) {
    setStrForm({
      unidad_id: r.unidad_id ?? '',
      huesped_nombre: r.huesped_nombre,
      huesped_email: r.huesped_email ?? '',
      huesped_telefono: r.huesped_telefono ?? '',
      fecha_entrada: r.fecha_entrada,
      fecha_salida: r.fecha_salida,
      num_adultos: String(r.num_adultos),
      num_ninos: String(r.num_ninos),
      plataforma: r.plataforma,
      monto_noche: r.monto_noche != null ? String(r.monto_noche) : '',
      monto_total: r.monto_total != null ? String(r.monto_total) : '',
      estado: r.estado,
      notas: r.notas ?? '',
    })
    setEditingSTRId(r.id)
    setShowSTRForm(true)
  }

  function cancelSTRForm() {
    setShowSTRForm(false)
    setEditingSTRId(null)
    setStrForm(EMPTY_STR)
  }

  function recalcSTRTotal(f: typeof EMPTY_STR) {
    const noches = calcNoches(f.fecha_entrada, f.fecha_salida)
    if (f.monto_noche && noches > 0) {
      return { ...f, monto_total: String(Number(f.monto_noche) * noches) }
    }
    return f
  }

  async function handleGuardarSTR() {
    if (!strForm.huesped_nombre.trim()) {
      notify({ variant: 'warning', title: 'Campo requerido', text: 'Ingresa el nombre del huésped.' }); return
    }
    if (!strForm.fecha_entrada || !strForm.fecha_salida) {
      notify({ variant: 'warning', title: 'Campo requerido', text: 'Ingresa las fechas de entrada y salida.' }); return
    }
    if (!strForm.unidad_id) {
      notify({ variant: 'warning', title: 'Campo requerido', text: 'Selecciona la unidad.' }); return
    }

    const unidad = clienteUnidades.find(u => u.id === strForm.unidad_id)
    if (!unidad) { notify({ variant: 'error', title: 'Error', text: 'Unidad no encontrada.' }); return }

    setSavingSTR(true)
    const payload = {
      company_id: companyId,
      project_id: unidad.project_id,
      unidad_id: strForm.unidad_id || null,
      huesped_nombre: strForm.huesped_nombre.trim(),
      huesped_email: strForm.huesped_email.trim() || null,
      huesped_telefono: strForm.huesped_telefono.trim() || null,
      fecha_entrada: strForm.fecha_entrada,
      fecha_salida: strForm.fecha_salida,
      num_adultos: Number(strForm.num_adultos) || 1,
      num_ninos: Number(strForm.num_ninos) || 0,
      plataforma: strForm.plataforma,
      monto_noche: strForm.monto_noche ? Number(strForm.monto_noche) : null,
      monto_total: strForm.monto_total ? Number(strForm.monto_total) : null,
      estado: strForm.estado,
      notas: strForm.notas.trim() || null,
    }

    let error
    if (editingSTRId) {
      ;({ error } = await supabase.from('reservas_str').update(payload).eq('id', editingSTRId))
    } else {
      ;({ error } = await supabase.from('reservas_str').insert(payload))
    }

    setSavingSTR(false)
    if (error) {
      notify({ variant: 'error', title: 'Error', text: error.message ?? 'No se pudo guardar la reserva.' })
    } else {
      Swal.fire({ icon: 'success', title: editingSTRId ? 'Reserva actualizada' : 'Reserva creada', timer: 1800, showConfirmButton: false })
      cancelSTRForm()
      await fetchData()
    }
  }

  async function handleEliminarSTR(r: ReservaSTR) {
    const result = await Swal.fire({
      title: '¿Eliminar reserva?',
      text: `Huésped: ${r.huesped_nombre}`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: 'var(--at-danger)',
      cancelButtonColor: 'var(--at-ink-3)',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
    })
    if (!result.isConfirmed) return
    const { error } = await supabase.from('reservas_str').delete().eq('id', r.id)
    if (error) {
      notify({ variant: 'error', title: 'Error', text: error.message })
    } else {
      setReservas((prev: ReservaSTR[]) => prev.filter((x: ReservaSTR) => x.id !== r.id))
    }
  }

  // ── Styles ──────────────────────────────────────────────────────────────────

  const inputStyle = {
    padding: '9px 12px', border: '2px solid var(--at-line)', borderRadius: '8px',
    fontSize: '14px', width: '100%', boxSizing: 'border-box' as const, outline: 'none',
  }
  const labelStyle = {
    fontSize: '13px', fontWeight: 600 as const, color: 'var(--at-ink-2)',
    marginBottom: '4px', display: 'block',
  }
  const btnPrimary = {
    padding: '9px 20px', background: 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
    color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600 as const,
    fontSize: '14px', cursor: 'pointer',
  }
  const btnSecondary = {
    padding: '9px 20px', background: 'var(--at-chip)', color: 'var(--at-ink-2)',
    border: 'none', borderRadius: '8px', fontWeight: 600 as const,
    fontSize: '14px', cursor: 'pointer',
  }

  const unidadNombre = (id: string) =>
    clienteUnidades.find(u => u.id === id)?.nombre ?? id

  return (
    <EditModal
      title={`Rentas — ${cliente.nombre}`}
      onClose={onClose}
      maxWidth="860px"
    >
      {/* Client units summary */}
      {clienteUnidades.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '36px', marginBottom: '12px' }}>🏠</div>
          <div style={{ fontWeight: 600, fontSize: '15px', marginBottom: '6px' }}>
            Este cliente no tiene unidades asignadas
          </div>
          <div style={{ fontSize: '13px' }}>
            Asigna unidades a este cliente desde el módulo de Unidades para gestionar sus rentas.
          </div>
        </div>
      ) : (
        <>
          {/* Unit chips */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '20px' }}>
            {clienteUnidades.map(u => (
              <span
                key={u.id}
                style={{
                  padding: '4px 12px', borderRadius: '20px', fontSize: '12px',
                  fontWeight: 600, background: 'var(--at-primary-soft)', color: 'var(--at-primary-hover)',
                }}
              >
                🏠 {u.nombre}
              </span>
            ))}
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '2px solid var(--at-line)', marginBottom: '20px' }}>
            {(['arrendamiento', 'str'] as Tab[]).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: '10px 20px', border: 'none', cursor: 'pointer',
                  fontWeight: 600, fontSize: '14px', background: 'transparent',
                  borderBottom: activeTab === tab ? '3px solid var(--at-primary)' : '3px solid transparent',
                  color: activeTab === tab ? 'var(--at-primary)' : 'var(--at-ink-3)',
                  marginBottom: '-2px',
                }}
              >
                {tab === 'arrendamiento' ? '📄 Arrendamiento' : '🏨 STR / Corto Plazo'}
              </button>
            ))}
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--at-ink-3)' }}>
              Cargando información...
            </div>
          ) : (
            <>
              {/* ── ARRENDAMIENTO TAB ── */}
              {activeTab === 'arrendamiento' && (
                <div>
                  {canEdit && !showContratoForm && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '14px' }}>
                      <button onClick={startNewContrato} style={btnPrimary}>
                        + Nuevo Contrato
                      </button>
                    </div>
                  )}

                  {showContratoForm && (
                    <div style={{
                      background: 'var(--at-surface-2)', border: '1px solid var(--at-line)',
                      borderRadius: '12px', padding: '20px', marginBottom: '20px',
                    }}>
                      <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--at-ink)', marginBottom: '16px' }}>
                        {editingContratoId ? 'Editar Contrato' : 'Nuevo Contrato de Arrendamiento'}
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                        {clienteUnidades.length > 1 && (
                          <div>
                            <label style={labelStyle}>Unidad *</label>
                            <select
                              style={inputStyle}
                              value={contratoForm.unidad_id}
                              onChange={e => setContratoForm(f => ({ ...f, unidad_id: e.target.value }))}
                            >
                              <option value="">— Seleccionar —</option>
                              {clienteUnidades.map(u => (
                                <option key={u.id} value={u.id}>{u.nombre}</option>
                              ))}
                            </select>
                          </div>
                        )}
                        <div style={{ gridColumn: clienteUnidades.length > 1 ? 'auto' : '1 / -1' }}>
                          <label style={labelStyle}>Nombre del Arrendatario *</label>
                          <input
                            style={inputStyle}
                            value={contratoForm.arrendatario_nombre}
                            onChange={e => setContratoForm(f => ({ ...f, arrendatario_nombre: e.target.value }))}
                            placeholder="Nombre completo"
                            maxLength={150}
                          />
                        </div>
                        <div>
                          <label style={labelStyle}>Identificación (DPI/DUI)</label>
                          <input
                            style={inputStyle}
                            value={contratoForm.arrendatario_identificacion}
                            onChange={e => setContratoForm(f => ({ ...f, arrendatario_identificacion: e.target.value }))}
                            placeholder="Número de identificación"
                            maxLength={30}
                          />
                        </div>
                        <div>
                          <label style={labelStyle}>Teléfono</label>
                          <input
                            style={inputStyle}
                            value={contratoForm.arrendatario_telefono}
                            onChange={e => setContratoForm(f => ({ ...f, arrendatario_telefono: e.target.value }))}
                            placeholder="Ej. 55551234"
                            maxLength={20}
                          />
                        </div>
                        <div>
                          <label style={labelStyle}>Correo Electrónico</label>
                          <input
                            style={inputStyle}
                            type="email"
                            value={contratoForm.arrendatario_email}
                            onChange={e => setContratoForm(f => ({ ...f, arrendatario_email: e.target.value }))}
                            placeholder="arrendatario@email.com"
                            maxLength={150}
                          />
                        </div>
                        <div>
                          <label style={labelStyle}>Monto de Renta *</label>
                          <input
                            style={inputStyle}
                            type="number"
                            min="0"
                            step="0.01"
                            value={contratoForm.monto_renta}
                            onChange={e => setContratoForm(f => ({ ...f, monto_renta: e.target.value }))}
                            placeholder="0.00"
                          />
                        </div>
                        <div>
                          <label style={labelStyle}>Día de Pago</label>
                          <input
                            style={inputStyle}
                            type="number"
                            min="1" max="31"
                            value={contratoForm.dia_pago}
                            onChange={e => setContratoForm(f => ({ ...f, dia_pago: e.target.value }))}
                          />
                        </div>
                        <div>
                          <label style={labelStyle}>Fecha de Inicio *</label>
                          <input
                            style={inputStyle}
                            type="date"
                            value={contratoForm.fecha_inicio}
                            onChange={e => setContratoForm(f => ({ ...f, fecha_inicio: e.target.value }))}
                          />
                        </div>
                        <div>
                          <label style={labelStyle}>Fecha de Fin</label>
                          <input
                            style={inputStyle}
                            type="date"
                            value={contratoForm.fecha_fin}
                            onChange={e => setContratoForm(f => ({ ...f, fecha_fin: e.target.value }))}
                          />
                        </div>
                        <div>
                          <label style={labelStyle}>Depósito</label>
                          <input
                            style={inputStyle}
                            type="number"
                            min="0"
                            step="0.01"
                            value={contratoForm.deposito}
                            onChange={e => setContratoForm(f => ({ ...f, deposito: e.target.value }))}
                            placeholder="0.00"
                          />
                        </div>
                        <div style={{ gridColumn: '1 / -1' }}>
                          <label style={labelStyle}>Notas</label>
                          <input
                            style={inputStyle}
                            value={contratoForm.notas}
                            onChange={e => setContratoForm(f => ({ ...f, notas: e.target.value }))}
                            placeholder="Notas adicionales..."
                            maxLength={500}
                          />
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                        <button onClick={handleGuardarContrato} disabled={savingContrato} style={{ ...btnPrimary, opacity: savingContrato ? 0.7 : 1 }}>
                          {savingContrato ? 'Guardando...' : editingContratoId ? 'Actualizar' : 'Guardar Contrato'}
                        </button>
                        <button onClick={cancelContratoForm} style={btnSecondary}>Cancelar</button>
                      </div>
                    </div>
                  )}

                  {contratos.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: 'var(--at-ink-3)' }}>
                      <div style={{ fontSize: '32px', marginBottom: '8px' }}>📄</div>
                      <div style={{ fontWeight: 600 }}>Sin contratos de arrendamiento</div>
                      {canEdit && <div style={{ fontSize: '13px', marginTop: '4px' }}>Agrega el primer contrato con el botón de arriba</div>}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {contratos.map(c => {
                        const cfg = ESTADO_CONTRATO_CONFIG[c.estado]
                        return (
                          <div
                            key={c.id}
                            style={{
                              background: 'var(--at-surface)', border: '1px solid var(--at-line)',
                              borderRadius: '10px', padding: '14px 16px',
                              display: 'flex', justifyContent: 'space-between',
                              alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap',
                            }}
                          >
                            <div style={{ flex: 1, minWidth: '200px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                <span style={{ fontWeight: 700, fontSize: '15px', color: 'var(--at-ink)' }}>
                                  {c.arrendatario_nombre}
                                </span>
                                <span style={{
                                  padding: '2px 8px', borderRadius: '12px', fontSize: '11px',
                                  fontWeight: 600, background: cfg.bg, color: cfg.color,
                                }}>
                                  {cfg.label}
                                </span>
                              </div>
                              <div style={{ fontSize: '13px', color: 'var(--at-ink-3)' }}>
                                🏠 {unidadNombre(c.unidad_id)}
                                {c.arrendatario_telefono && <span style={{ marginLeft: '12px' }}>📞 {c.arrendatario_telefono}</span>}
                                {c.arrendatario_email && <span style={{ marginLeft: '12px' }}>✉️ {c.arrendatario_email}</span>}
                              </div>
                              <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '4px' }}>
                                Renta: <b style={{ color: 'var(--at-accent-2)' }}>{c.monto_renta.toLocaleString()}</b>
                                {' · '}Día {c.dia_pago}
                                {' · '}{c.fecha_inicio}{c.fecha_fin ? ` → ${c.fecha_fin}` : ' (sin vencimiento)'}
                                {c.arrendatario_identificacion && <> · ID: {c.arrendatario_identificacion}</>}
                              </div>
                              {c.notas && (
                                <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px', fontStyle: 'italic' }}>
                                  {c.notas}
                                </div>
                              )}
                            </div>
                            {canEdit && (
                              <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                                <button
                                  onClick={() => startEditContrato(c)}
                                  style={{ padding: '5px 12px', background: 'var(--at-primary-tint)', color: 'var(--at-primary-hover)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}
                                >
                                  Editar
                                </button>
                                <button
                                  onClick={() => handleEliminarContrato(c)}
                                  style={{ padding: '5px 12px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}
                                >
                                  Eliminar
                                </button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ── STR TAB ── */}
              {activeTab === 'str' && (
                <div>
                  {canEdit && !showSTRForm && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '14px' }}>
                      <button onClick={startNewSTR} style={btnPrimary}>
                        + Nueva Reserva
                      </button>
                    </div>
                  )}

                  {showSTRForm && (
                    <div style={{
                      background: 'var(--at-surface-2)', border: '1px solid var(--at-line)',
                      borderRadius: '12px', padding: '20px', marginBottom: '20px',
                    }}>
                      <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--at-ink)', marginBottom: '16px' }}>
                        {editingSTRId ? 'Editar Reserva' : 'Nueva Reserva STR'}
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                        {clienteUnidades.length > 1 && (
                          <div>
                            <label style={labelStyle}>Unidad *</label>
                            <select
                              style={inputStyle}
                              value={strForm.unidad_id}
                              onChange={e => setStrForm(f => ({ ...f, unidad_id: e.target.value }))}
                            >
                              <option value="">— Seleccionar —</option>
                              {clienteUnidades.map(u => (
                                <option key={u.id} value={u.id}>{u.nombre}</option>
                              ))}
                            </select>
                          </div>
                        )}
                        <div style={{ gridColumn: clienteUnidades.length > 1 ? 'auto' : '1 / -1' }}>
                          <label style={labelStyle}>Nombre del Huésped *</label>
                          <input
                            style={inputStyle}
                            value={strForm.huesped_nombre}
                            onChange={e => setStrForm(f => ({ ...f, huesped_nombre: e.target.value }))}
                            placeholder="Nombre completo"
                            maxLength={150}
                          />
                        </div>
                        <div>
                          <label style={labelStyle}>Correo Electrónico</label>
                          <input
                            style={inputStyle}
                            type="email"
                            value={strForm.huesped_email}
                            onChange={e => setStrForm(f => ({ ...f, huesped_email: e.target.value }))}
                            placeholder="huesped@email.com"
                            maxLength={150}
                          />
                        </div>
                        <div>
                          <label style={labelStyle}>Teléfono</label>
                          <input
                            style={inputStyle}
                            value={strForm.huesped_telefono}
                            onChange={e => setStrForm(f => ({ ...f, huesped_telefono: e.target.value }))}
                            placeholder="Ej. 55551234"
                            maxLength={20}
                          />
                        </div>
                        <div>
                          <label style={labelStyle}>Plataforma</label>
                          <select
                            style={inputStyle}
                            value={strForm.plataforma}
                            onChange={e => setStrForm(f => ({ ...f, plataforma: e.target.value as PlataformaSTR }))}
                          >
                            {(Object.keys(PLATAFORMA_LABEL) as PlataformaSTR[]).map(p => (
                              <option key={p} value={p}>{PLATAFORMA_LABEL[p]}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label style={labelStyle}>Fecha de Entrada *</label>
                          <input
                            style={inputStyle}
                            type="date"
                            value={strForm.fecha_entrada}
                            onChange={e => {
                              const updated = { ...strForm, fecha_entrada: e.target.value }
                              setStrForm(recalcSTRTotal(updated))
                            }}
                          />
                        </div>
                        <div>
                          <label style={labelStyle}>Fecha de Salida *</label>
                          <input
                            style={inputStyle}
                            type="date"
                            value={strForm.fecha_salida}
                            onChange={e => {
                              const updated = { ...strForm, fecha_salida: e.target.value }
                              setStrForm(recalcSTRTotal(updated))
                            }}
                          />
                        </div>
                        <div>
                          <label style={labelStyle}>Adultos</label>
                          <input
                            style={inputStyle}
                            type="number" min="1"
                            value={strForm.num_adultos}
                            onChange={e => setStrForm(f => ({ ...f, num_adultos: e.target.value }))}
                          />
                        </div>
                        <div>
                          <label style={labelStyle}>Niños</label>
                          <input
                            style={inputStyle}
                            type="number" min="0"
                            value={strForm.num_ninos}
                            onChange={e => setStrForm(f => ({ ...f, num_ninos: e.target.value }))}
                          />
                        </div>
                        <div>
                          <label style={labelStyle}>Monto por Noche</label>
                          <input
                            style={inputStyle}
                            type="number" min="0" step="0.01"
                            value={strForm.monto_noche}
                            onChange={e => {
                              const updated = { ...strForm, monto_noche: e.target.value }
                              setStrForm(recalcSTRTotal(updated))
                            }}
                            placeholder="0.00"
                          />
                        </div>
                        <div>
                          <label style={labelStyle}>
                            Monto Total
                            {strForm.fecha_entrada && strForm.fecha_salida && (
                              <span style={{ fontWeight: 400, color: 'var(--at-ink-3)', marginLeft: '6px' }}>
                                ({calcNoches(strForm.fecha_entrada, strForm.fecha_salida)} noches)
                              </span>
                            )}
                          </label>
                          <input
                            style={inputStyle}
                            type="number" min="0" step="0.01"
                            value={strForm.monto_total}
                            onChange={e => setStrForm(f => ({ ...f, monto_total: e.target.value }))}
                            placeholder="0.00"
                          />
                        </div>
                        <div>
                          <label style={labelStyle}>Estado</label>
                          <select
                            style={inputStyle}
                            value={strForm.estado}
                            onChange={e => setStrForm(f => ({ ...f, estado: e.target.value as EstadoSTR }))}
                          >
                            {(Object.keys(ESTADO_STR_CONFIG) as EstadoSTR[]).map(s => (
                              <option key={s} value={s}>{ESTADO_STR_CONFIG[s].label}</option>
                            ))}
                          </select>
                        </div>
                        <div style={{ gridColumn: '1 / -1' }}>
                          <label style={labelStyle}>Notas</label>
                          <input
                            style={inputStyle}
                            value={strForm.notas}
                            onChange={e => setStrForm(f => ({ ...f, notas: e.target.value }))}
                            placeholder="Notas adicionales..."
                            maxLength={500}
                          />
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
                        <button onClick={handleGuardarSTR} disabled={savingSTR} style={{ ...btnPrimary, opacity: savingSTR ? 0.7 : 1 }}>
                          {savingSTR ? 'Guardando...' : editingSTRId ? 'Actualizar' : 'Guardar Reserva'}
                        </button>
                        <button onClick={cancelSTRForm} style={btnSecondary}>Cancelar</button>
                      </div>
                    </div>
                  )}

                  {reservas.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: 'var(--at-ink-3)' }}>
                      <div style={{ fontSize: '32px', marginBottom: '8px' }}>🏨</div>
                      <div style={{ fontWeight: 600 }}>Sin reservas STR registradas</div>
                      {canEdit && <div style={{ fontSize: '13px', marginTop: '4px' }}>Agrega la primera reserva con el botón de arriba</div>}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {reservas.map(r => {
                        const cfg = ESTADO_STR_CONFIG[r.estado]
                        const noches = calcNoches(r.fecha_entrada, r.fecha_salida)
                        return (
                          <div
                            key={r.id}
                            style={{
                              background: 'var(--at-surface)', border: '1px solid var(--at-line)',
                              borderRadius: '10px', padding: '14px 16px',
                              display: 'flex', justifyContent: 'space-between',
                              alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap',
                            }}
                          >
                            <div style={{ flex: 1, minWidth: '200px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                <span style={{ fontWeight: 700, fontSize: '15px', color: 'var(--at-ink)' }}>
                                  {r.huesped_nombre}
                                </span>
                                <span style={{
                                  padding: '2px 8px', borderRadius: '12px', fontSize: '11px',
                                  fontWeight: 600, background: cfg.bg, color: cfg.color,
                                }}>
                                  {cfg.label}
                                </span>
                                <span style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>
                                  {PLATAFORMA_LABEL[r.plataforma]}
                                </span>
                              </div>
                              <div style={{ fontSize: '13px', color: 'var(--at-ink-3)' }}>
                                {r.unidad_id && <span>🏠 {unidadNombre(r.unidad_id)}{' · '}</span>}
                                📅 {r.fecha_entrada} → {r.fecha_salida} ({noches} noche{noches !== 1 ? 's' : ''})
                                {' · '}👥 {r.num_adultos} adulto{r.num_adultos !== 1 ? 's' : ''}
                                {r.num_ninos > 0 && `, ${r.num_ninos} niño${r.num_ninos !== 1 ? 's' : ''}`}
                              </div>
                              <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '4px' }}>
                                {r.huesped_telefono && <span>📞 {r.huesped_telefono}{' · '}</span>}
                                {r.huesped_email && <span>✉️ {r.huesped_email}{' · '}</span>}
                                {r.monto_total != null && (
                                  <span>Total: <b style={{ color: 'var(--at-accent-2)' }}>{r.monto_total.toLocaleString()}</b></span>
                                )}
                              </div>
                              {r.notas && (
                                <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginTop: '2px', fontStyle: 'italic' }}>
                                  {r.notas}
                                </div>
                              )}
                            </div>
                            {canEdit && (
                              <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                                <button
                                  onClick={() => startEditSTR(r)}
                                  style={{ padding: '5px 12px', background: 'var(--at-primary-tint)', color: 'var(--at-primary-hover)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}
                                >
                                  Editar
                                </button>
                                <button
                                  onClick={() => handleEliminarSTR(r)}
                                  style={{ padding: '5px 12px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '12px' }}
                                >
                                  Eliminar
                                </button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </EditModal>
  )
}
