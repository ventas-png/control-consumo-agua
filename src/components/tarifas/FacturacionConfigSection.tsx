// T4 · agua:C4 — Editores de configuración de facturación del tenant.
//   1. Tasa de IVA por defecto (companies.iva_tasa_default).
//   2. CRUD de reglas de mora (reglas_mora_config), por proyecto.
// Vive en `tarifas/` (config del módulo de cobranza), NO en `empresa/` (T7).
// Gating por permisos admin/owner como el resto del módulo de tarifas.
import { useState, useEffect, useMemo, type CSSProperties } from 'react'
import { confirm, notify } from '../shared/Dialog'
import { useSession } from '../shared/SessionContext'
import { usePermissionsContext } from '../shared/PermissionsContext'
import type { Proyecto } from '../../types'
import type { ReglaMoraConfig } from '../../domain/facturacion/queries'
import {
  useIvaTasaDefaultQuery,
  useActualizarIvaTasaDefaultMutation,
  useReglasMoraConfigQuery,
  useCrearReglaMoraMutation,
  useActualizarReglaMoraMutation,
  useToggleReglaMoraMutation,
  useEliminarReglaMoraMutation,
  type ReglaMoraInput,
} from '../../domain/facturacion/mutations'

interface Props {
  proyectos: Proyecto[]
  moneda?: string
}

const TIPO_LABEL: Record<ReglaMoraConfig['tipo'], string> = {
  porcentaje: 'Porcentaje (%)',
  monto_fijo: 'Monto fijo',
}
const SOBRE_LABEL: Record<ReglaMoraConfig['aplicar_sobre'], string> = {
  saldo_vencido: 'Saldo vencido',
  monto_cuota: 'Monto de cuota',
}

const BLANK_REGLA = {
  nombre: '',
  dias_vencimiento: '30',
  tipo: 'porcentaje' as ReglaMoraConfig['tipo'],
  valor: '',
  aplicar_sobre: 'saldo_vencido' as ReglaMoraConfig['aplicar_sobre'],
  periodo_gracia: '0',
  notas: '',
}

export function FacturacionConfigSection({ proyectos, moneda = 'Q' }: Props) {
  const currentUser = useSession()
  const perms = usePermissionsContext()
  const companyId = currentUser.company_id
  // Mismo gating que TarifasSection: admin/owner (o roles exentos) que pueden
  // editar tarifas gestionan también la configuración de facturación.
  const canEdit = perms.canEdit('tarifas') && currentUser.role !== 'viewer'

  // ── IVA por defecto ────────────────────────────────────────────────────────
  const { data: ivaTasa, isLoading: ivaLoading } = useIvaTasaDefaultQuery(companyId)
  const actualizarIva = useActualizarIvaTasaDefaultMutation(companyId)
  // El input captura un porcentaje (12 = 12%); la tasa se persiste como fracción.
  const [ivaPct, setIvaPct] = useState('')
  useEffect(() => {
    if (ivaTasa != null) setIvaPct((ivaTasa * 100).toString())
  }, [ivaTasa])

  async function guardarIva() {
    const pct = parseFloat(ivaPct)
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      notify({ variant: 'warning', title: 'IVA inválido', text: 'Ingresa un porcentaje entre 0 y 100.' })
      return
    }
    try {
      await actualizarIva.mutateAsync(pct / 100)
      notify({ variant: 'success', title: 'IVA actualizado', text: `Tasa por defecto: ${pct}%`, duration: 1800 })
    } catch (err) {
      notify({ variant: 'error', title: 'Error', text: (err as Error).message })
    }
  }

  // ── Reglas de mora ─────────────────────────────────────────────────────────
  const { data: reglas = [] } = useReglasMoraConfigQuery(companyId)
  const crearRegla = useCrearReglaMoraMutation(companyId)
  const actualizarRegla = useActualizarReglaMoraMutation(companyId)
  const toggleRegla = useToggleReglaMoraMutation(companyId)
  const eliminarRegla = useEliminarReglaMoraMutation(companyId)

  const [projectId, setProjectId] = useState('')
  const [mostrarForm, setMostrarForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(BLANK_REGLA)

  // Selecciona el primer proyecto por defecto una vez que cargan.
  useEffect(() => {
    if (!projectId && proyectos.length > 0) setProjectId(proyectos[0].id)
  }, [proyectos, projectId])

  const reglasDelProyecto = useMemo(
    () => reglas.filter(r => r.project_id === projectId),
    [reglas, projectId],
  )

  function abrirNueva() { setForm(BLANK_REGLA); setEditId(null); setMostrarForm(true) }
  function abrirEditar(r: ReglaMoraConfig) {
    setForm({
      nombre: r.nombre,
      dias_vencimiento: String(r.dias_vencimiento),
      tipo: r.tipo,
      valor: String(r.valor),
      aplicar_sobre: r.aplicar_sobre,
      periodo_gracia: String(r.periodo_gracia),
      notas: r.notas ?? '',
    })
    setEditId(r.id)
    setMostrarForm(true)
  }
  function cancelar() { setMostrarForm(false); setEditId(null); setForm(BLANK_REGLA) }

  async function guardarRegla() {
    if (!form.nombre.trim() || !form.valor) {
      notify({ variant: 'warning', title: 'Faltan datos', text: 'Nombre y valor son obligatorios.' })
      return
    }
    if (!projectId || !companyId) {
      notify({ variant: 'warning', title: 'Selecciona un proyecto', text: 'Las reglas de mora se configuran por proyecto.' })
      return
    }
    const input: ReglaMoraInput = {
      company_id: companyId,
      project_id: projectId,
      nombre: form.nombre.trim(),
      dias_vencimiento: parseInt(form.dias_vencimiento) || 30,
      tipo: form.tipo,
      valor: parseFloat(form.valor) || 0,
      aplicar_sobre: form.aplicar_sobre,
      periodo_gracia: parseInt(form.periodo_gracia) || 0,
      notas: form.notas.trim() || null,
    }
    try {
      if (editId) {
        await actualizarRegla.mutateAsync({ id: editId, patch: input })
      } else {
        await crearRegla.mutateAsync(input)
      }
      cancelar()
      notify({ variant: 'success', title: editId ? 'Regla actualizada' : 'Regla creada', duration: 1600 })
    } catch (err) {
      notify({ variant: 'error', title: 'Error', text: (err as Error).message })
    }
  }

  async function handleToggle(r: ReglaMoraConfig) {
    try {
      await toggleRegla.mutateAsync({ id: r.id, activa: !r.activa })
    } catch (err) {
      notify({ variant: 'error', title: 'Error', text: (err as Error).message })
    }
  }

  async function handleEliminar(id: string) {
    const { isConfirmed } = await confirm({
      title: '¿Eliminar regla?',
      text: 'La regla de mora se eliminará permanentemente.',
      icon: 'warning',
      variant: 'danger',
      confirmText: 'Sí, eliminar',
    })
    if (!isConfirmed) return
    try {
      await eliminarRegla.mutateAsync(id)
      notify({ variant: 'success', title: 'Regla eliminada', duration: 1400 })
    } catch (err) {
      notify({ variant: 'error', title: 'Error', text: (err as Error).message })
    }
  }

  const inp: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid var(--at-line-strong)', borderRadius: 6, fontSize: 13 }
  const lbl: CSSProperties = { fontSize: 12, color: 'var(--at-ink-3)', marginBottom: 3, display: 'block' }

  const ivaSaving = actualizarIva.isPending

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* ── Editor de IVA ── */}
      <section style={{ background: 'var(--at-surface)', borderRadius: 14, padding: 20, boxShadow: '0 4px 16px rgba(0,0,0,0.06)' }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 700, color: 'var(--at-ink)' }}>Impuesto (IVA) por defecto</h3>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--at-ink-3)' }}>
          Tasa que se aplica al emitir facturas. Guatemala: 12%. Una tasa de 0% marca el servicio como exento.
        </p>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ width: 160 }}>
            <label style={lbl}>Tasa de IVA (%)</label>
            <input
              type="number" min={0} max={100} step="0.01"
              style={inp}
              value={ivaLoading ? '' : ivaPct}
              disabled={!canEdit || ivaLoading}
              onChange={e => setIvaPct(e.target.value)}
              placeholder={ivaLoading ? 'Cargando…' : '12'}
            />
          </div>
          {canEdit && (
            <button
              onClick={() => void guardarIva()}
              disabled={ivaSaving || ivaLoading}
              style={{
                padding: '9px 20px', borderRadius: 8, border: 'none',
                background: ivaSaving ? 'var(--at-ink-3)' : 'linear-gradient(135deg, var(--at-primary), var(--at-accent-2))',
                color: 'white', fontWeight: 600, fontSize: 14, cursor: ivaSaving || ivaLoading ? 'not-allowed' : 'pointer',
              }}
            >
              {ivaSaving ? 'Guardando…' : 'Guardar IVA'}
            </button>
          )}
        </div>
      </section>

      {/* ── Reglas de mora ── */}
      <section style={{ background: 'var(--at-surface)', borderRadius: 14, padding: 20, boxShadow: '0 4px 16px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
          <div>
            <h3 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 700, color: 'var(--at-ink)' }}>Reglas de mora</h3>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--at-ink-3)' }}>
              Definen el recargo cuando una factura supera su vencimiento. Se aplican por proyecto.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              style={{ ...inp, width: 'auto', minWidth: 200 }}
              value={projectId}
              onChange={e => { setProjectId(e.target.value); cancelar() }}
            >
              {proyectos.length === 0 && <option value="">Sin proyectos</option>}
              {proyectos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
            {canEdit && projectId && (
              <button
                onClick={mostrarForm && !editId ? cancelar : abrirNueva}
                style={{ padding: '8px 16px', background: 'var(--at-danger)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
              >
                {mostrarForm && !editId ? '✕ Cancelar' : '+ Nueva regla'}
              </button>
            )}
          </div>
        </div>

        {/* Formulario */}
        {mostrarForm && canEdit && (
          <div style={{ background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>{editId ? 'Editar regla' : 'Nueva regla de mora'}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 12 }}>
              <div style={{ gridColumn: 'span 3' }}>
                <label style={lbl}>Nombre de la regla *</label>
                <input style={inp} value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} placeholder="Ej. Mora del 5% a los 30 días" />
              </div>
              <div>
                <label style={lbl}>Días de vencimiento *</label>
                <input type="number" min={1} style={inp} value={form.dias_vencimiento} onChange={e => setForm(p => ({ ...p, dias_vencimiento: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Período de gracia (días)</label>
                <input type="number" min={0} style={inp} value={form.periodo_gracia} onChange={e => setForm(p => ({ ...p, periodo_gracia: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Tipo de recargo</label>
                <select style={inp} value={form.tipo} onChange={e => setForm(p => ({ ...p, tipo: e.target.value as ReglaMoraConfig['tipo'] }))}>
                  {(Object.keys(TIPO_LABEL) as ReglaMoraConfig['tipo'][]).map(t => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Valor {form.tipo === 'porcentaje' ? '(%)' : `(${moneda})`} *</label>
                <input type="number" step="0.01" min={0} style={inp} value={form.valor} onChange={e => setForm(p => ({ ...p, valor: e.target.value }))} />
              </div>
              <div>
                <label style={lbl}>Aplicar sobre</label>
                <select style={inp} value={form.aplicar_sobre} onChange={e => setForm(p => ({ ...p, aplicar_sobre: e.target.value as ReglaMoraConfig['aplicar_sobre'] }))}>
                  {(Object.keys(SOBRE_LABEL) as ReglaMoraConfig['aplicar_sobre'][]).map(s => <option key={s} value={s}>{SOBRE_LABEL[s]}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Notas</label>
                <input style={inp} value={form.notas} onChange={e => setForm(p => ({ ...p, notas: e.target.value }))} placeholder="Opcional" />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => void guardarRegla()} disabled={crearRegla.isPending || actualizarRegla.isPending}
                style={{ padding: '8px 20px', background: 'var(--at-danger)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                {(crearRegla.isPending || actualizarRegla.isPending) ? 'Guardando…' : editId ? 'Actualizar' : 'Crear regla'}
              </button>
              <button onClick={cancelar} style={{ padding: '8px 16px', background: 'var(--at-chip)', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>Cancelar</button>
            </div>
          </div>
        )}

        {/* Lista */}
        {!projectId ? (
          <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '32px 0', fontSize: 13 }}>
            Selecciona un proyecto para ver sus reglas de mora.
          </div>
        ) : reglasDelProyecto.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--at-ink-3)', padding: '32px 0', fontSize: 13 }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}>📏</div>
            Sin reglas de mora para este proyecto.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {reglasDelProyecto.map(r => (
              <div key={r.id} style={{ background: 'var(--at-surface-2)', border: `1px solid ${r.activa ? 'var(--at-line)' : 'var(--at-chip)'}`, borderRadius: 10, padding: '12px 16px', opacity: r.activa ? 1 : 0.65 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{r.nombre}</span>
                      <span style={{ padding: '1px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: r.activa ? 'var(--at-success-tint)' : 'var(--at-chip)', color: r.activa ? 'var(--at-success-strong)' : 'var(--at-ink-3)' }}>
                        {r.activa ? 'Activa' : 'Inactiva'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--at-ink-3)', flexWrap: 'wrap' }}>
                      <span>⏱ A los <strong>{r.dias_vencimiento}</strong> días</span>
                      {r.periodo_gracia > 0 && <span>🕊 Gracia: <strong>{r.periodo_gracia}d</strong></span>}
                      <span>💸 {r.tipo === 'porcentaje' ? `${r.valor}%` : `${moneda} ${r.valor}`} sobre {SOBRE_LABEL[r.aplicar_sobre]}</span>
                    </div>
                    {r.notas && <div style={{ fontSize: 11, color: 'var(--at-ink-3)', marginTop: 4 }}>{r.notas}</div>}
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button onClick={() => void handleToggle(r)}
                        style={{ padding: '5px 10px', background: r.activa ? 'var(--at-warning-tint)' : 'var(--at-success-tint)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 600, color: r.activa ? 'var(--at-warning-strong)' : 'var(--at-success-strong)' }}>
                        {r.activa ? 'Pausar' : 'Activar'}
                      </button>
                      <button onClick={() => abrirEditar(r)}
                        style={{ padding: '5px 10px', background: 'var(--at-primary-tint)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, color: 'var(--at-primary-hover)', fontWeight: 600 }}>
                        Editar
                      </button>
                      <button onClick={() => void handleEliminar(r.id)}
                        style={{ padding: '5px 10px', background: 'var(--at-danger-tint)', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, color: 'var(--at-danger)', fontWeight: 600 }}>
                        Eliminar
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
