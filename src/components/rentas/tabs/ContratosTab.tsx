import { useMemo, useState } from 'react'
import type { ContratoRenta, EstadoContratoRenta, PropiedadRenta } from '../../../types'
import {
  DIAS_AVISO_VENCIMIENTO, ESTADO_CONTRATO_LABEL, ESTADOS_CONTRATO, TIPO_RENTA_LABEL,
  diasParaVencer, mensajeErrorRentas, numeroONulo,
} from '../../../domain/rentas/logica'
import { useContratosRentaMutations } from '../../../domain/rentas/mutations'
import { formatCurrency, formatFechaCalendario } from '../../../lib/format'
import { confirm, notify } from '../../shared/Dialog'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { EmptyState } from '../../shared/EmptyState'
import { FilterChips } from '../../shared/FilterChips'
import { StatusBadge } from '../../shared/StatusBadge'
import type { PermisosModulo } from '../RentasSection'
import { TONO_CONTRATO, accionesFila, barraFiltros, campo, encabezadoTab, etiqueta, fila, rejilla, td, tenue, th, thead } from '../ui'

interface Props {
  propiedades: PropiedadRenta[]
  contratos: ContratoRenta[]
  companyId: string
  moneda: string
  hoy: string
  permisos: PermisosModulo
}

interface Form {
  propiedad_id: string
  inquilino_nombre: string; inquilino_identificacion: string; inquilino_telefono: string; inquilino_email: string
  fecha_inicio: string; fecha_fin: string
  renta_mensual: string; deposito: string; dia_pago: string
  estado: EstadoContratoRenta; notas: string
}

const txt = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v))
const nulo = (v: string) => (v.trim() === '' ? null : v.trim())

function formDe(c: ContratoRenta | undefined, hoy: string): Form {
  return {
    propiedad_id: c?.propiedad_id ?? '',
    inquilino_nombre: c?.inquilino_nombre ?? '', inquilino_identificacion: txt(c?.inquilino_identificacion),
    inquilino_telefono: txt(c?.inquilino_telefono), inquilino_email: txt(c?.inquilino_email),
    fecha_inicio: c?.fecha_inicio ?? hoy, fecha_fin: txt(c?.fecha_fin),
    renta_mensual: txt(c?.renta_mensual), deposito: txt(c?.deposito), dia_pago: txt(c?.dia_pago),
    estado: c?.estado ?? 'vigente', notas: txt(c?.notas),
  }
}

type Filtro = 'todos' | EstadoContratoRenta

export default function ContratosTab({ propiedades, contratos, companyId, moneda, hoy, permisos }: Props) {
  const [filtro, setFiltro] = useState<Filtro>('vigente')
  const [editando, setEditando] = useState<ContratoRenta | 'nuevo' | null>(null)
  const [form, setForm] = useState<Form>(formDe(undefined, hoy))
  const { crear, actualizar, eliminar } = useContratosRentaMutations(companyId)
  const guardando = crear.isPending || actualizar.isPending

  const propiedadPorId = useMemo(() => new Map(propiedades.map(p => [p.id, p])), [propiedades])
  // Renta mensual: todo lo que no es corto plazo.
  const rentables = useMemo(() => propiedades.filter(p => p.tipo_renta !== 'corto_plazo'), [propiedades])
  const conVigente = useMemo(() => new Set(contratos.filter(c => c.estado === 'vigente').map(c => c.propiedad_id)), [contratos])
  const visibles = useMemo(() => contratos.filter(c => filtro === 'todos' || c.estado === filtro), [contratos, filtro])

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(prev => ({ ...prev, [k]: v }))
  const abrir = (c: ContratoRenta | 'nuevo') => { setForm(formDe(c === 'nuevo' ? undefined : c, hoy)); setEditando(c) }
  const cerrar = () => { if (!guardando) setEditando(null) }

  // Al elegir la propiedad se propone su tarifa base como renta.
  const elegirPropiedad = (id: string) => {
    const p = propiedadPorId.get(id)
    setForm(prev => ({ ...prev, propiedad_id: id, renta_mensual: prev.renta_mensual.trim() || txt(p?.tarifa_base) }))
  }

  const guardar = async () => {
    if (guardando || !editando) return
    if (!form.propiedad_id) { notify({ variant: 'error', title: 'Elige la propiedad' }); return }
    if (!form.inquilino_nombre.trim()) { notify({ variant: 'error', title: 'Falta el nombre del inquilino' }); return }
    if (!form.fecha_inicio) { notify({ variant: 'error', title: 'Falta la fecha de inicio' }); return }
    if (form.fecha_fin && form.fecha_fin <= form.fecha_inicio) { notify({ variant: 'error', title: 'La fecha de fin debe ser posterior al inicio' }); return }
    const renta = numeroONulo(form.renta_mensual)
    const deposito = numeroONulo(form.deposito)
    if (renta === undefined || renta === null) { notify({ variant: 'error', title: 'Indica la renta mensual' }); return }
    if (deposito === undefined) { notify({ variant: 'error', title: 'El depósito debe ser un número positivo' }); return }
    let dia: number | null = null
    if (form.dia_pago.trim() !== '') {
      dia = Number(form.dia_pago)
      if (!Number.isInteger(dia) || dia < 1 || dia > 31) { notify({ variant: 'error', title: 'El día de pago va del 1 al 31' }); return }
    }
    const payload = {
      company_id: companyId, propiedad_id: form.propiedad_id,
      inquilino_nombre: form.inquilino_nombre.trim(), inquilino_identificacion: nulo(form.inquilino_identificacion),
      inquilino_telefono: nulo(form.inquilino_telefono), inquilino_email: nulo(form.inquilino_email),
      fecha_inicio: form.fecha_inicio, fecha_fin: nulo(form.fecha_fin),
      renta_mensual: renta, deposito, dia_pago: dia, estado: form.estado, notas: nulo(form.notas),
    }
    try {
      if (editando === 'nuevo') await crear.mutateAsync(payload)
      else {
        const { company_id: _fija, ...patch } = payload
        await actualizar.mutateAsync({ id: editando.id, patch })
      }
      setEditando(null)
      notify({ variant: 'success', title: editando === 'nuevo' ? 'Contrato registrado' : 'Contrato actualizado', duration: 1500 })
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo guardar', text: mensajeErrorRentas(e, 'Intenta de nuevo.') })
    }
  }

  const finalizar = async (c: ContratoRenta) => {
    const { isConfirmed } = await confirm({
      title: '¿Finalizar el contrato?', text: `El contrato de ${c.inquilino_nombre} queda como finalizado y la propiedad vuelve a estar disponible.`,
      icon: 'question', confirmText: 'Finalizar',
    })
    if (!isConfirmed) return
    try {
      await actualizar.mutateAsync({ id: c.id, patch: { estado: 'finalizado' } })
      notify({ variant: 'success', title: 'Contrato finalizado', duration: 1500 })
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo finalizar', text: mensajeErrorRentas(e, 'Intenta de nuevo.') })
    }
  }

  const borrar = async (c: ContratoRenta) => {
    const { isConfirmed } = await confirm({
      title: '¿Eliminar el contrato?', text: `El contrato de ${c.inquilino_nombre} se elimina permanentemente. Si ya terminó, mejor finalízalo para conservar el historial.`,
      icon: 'warning', variant: 'danger', confirmText: 'Eliminar',
    })
    if (!isConfirmed) return
    try {
      await eliminar.mutateAsync(c.id)
      notify({ variant: 'success', title: 'Contrato eliminado', duration: 1500 })
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo eliminar', text: mensajeErrorRentas(e, 'Intenta de nuevo.') })
    }
  }

  const avisoVencimiento = (c: ContratoRenta) => {
    const d = diasParaVencer(c, hoy)
    if (d === null) return null
    if (d < 0) return <StatusBadge tone="danger">Venció hace {-d} día{d === -1 ? '' : 's'}</StatusBadge>
    if (d <= DIAS_AVISO_VENCIMIENTO) return <StatusBadge tone="warning">{d === 0 ? 'Vence hoy' : `Vence en ${d} día${d === 1 ? '' : 's'}`}</StatusBadge>
    return null
  }

  return (
    <div>
      <div style={encabezadoTab}>
        <h2 style={{ margin: 0 }}>Contratos de renta</h2>
        {permisos.crear && rentables.length > 0 && <Button onClick={() => abrir('nuevo')}>+ Nuevo contrato</Button>}
      </div>

      <div style={barraFiltros}>
        <FilterChips<Filtro>
          ariaLabel="Filtrar por estado"
          value={filtro} onChange={setFiltro}
          options={[
            ...ESTADOS_CONTRATO.map(e => ({ value: e as Filtro, label: ESTADO_CONTRATO_LABEL[e], count: contratos.filter(c => c.estado === e).length })),
            { value: 'todos', label: 'Todos', count: contratos.length },
          ]}
        />
      </div>

      {rentables.length === 0 ? (
        <EmptyState icon="📝" title="No hay propiedades de renta mensual"
          description="Registra primero una propiedad de largo plazo, un local comercial u otro tipo en la pestaña Propiedades." />
      ) : contratos.length === 0 ? (
        <EmptyState icon="📝" title="Aún no hay contratos"
          description="Registra el inquilino, la vigencia y la renta mensual de cada propiedad rentada."
          action={permisos.crear ? <Button onClick={() => abrir('nuevo')}>+ Nuevo contrato</Button> : undefined} />
      ) : visibles.length === 0 ? (
        <p style={{ ...tenue, fontStyle: 'italic' }}>Ningún contrato en este estado.</p>
      ) : (
        <div className="table-scroll-wrapper">
          <table className="table-cards-on-mobile" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={thead}>
                <th scope="col" style={th}>Propiedad</th>
                <th scope="col" style={th}>Inquilino</th>
                <th scope="col" style={th}>Vigencia</th>
                <th scope="col" style={{ ...th, textAlign: 'right' }}>Renta mensual</th>
                <th scope="col" style={th}>Estado</th>
                {(permisos.editar || permisos.eliminar) && <th scope="col" style={{ ...th, textAlign: 'center' }}>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {visibles.map(c => {
                const p = propiedadPorId.get(c.propiedad_id)
                return (
                  <tr key={c.id} style={fila}>
                    <td data-label="Propiedad" style={td}>
                      <div style={{ fontWeight: 600 }}>{p?.nombre ?? 'Propiedad'}</div>
                      {p && <div style={tenue}>{p.tipo_renta === 'otro' && p.tipo_detalle ? p.tipo_detalle : TIPO_RENTA_LABEL[p.tipo_renta]}</div>}
                    </td>
                    <td data-label="Inquilino" style={td}>
                      <div>{c.inquilino_nombre}</div>
                      <div style={tenue}>{[c.inquilino_telefono, c.inquilino_email].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td data-label="Vigencia" style={td}>
                      <div>{formatFechaCalendario(c.fecha_inicio)} → {c.fecha_fin ? formatFechaCalendario(c.fecha_fin) : 'indefinido'}</div>
                      {c.dia_pago !== null && <div style={tenue}>Paga el día {c.dia_pago}</div>}
                    </td>
                    <td data-label="Renta mensual" style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatCurrency(c.renta_mensual, moneda)}
                      {c.deposito !== null && <div style={tenue}>Depósito {formatCurrency(c.deposito, moneda)}</div>}
                    </td>
                    <td data-label="Estado" style={td}>
                      <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        <StatusBadge tone={TONO_CONTRATO[c.estado]}>{ESTADO_CONTRATO_LABEL[c.estado]}</StatusBadge>
                        {avisoVencimiento(c)}
                      </div>
                    </td>
                    {(permisos.editar || permisos.eliminar) && (
                      <td style={{ ...td, textAlign: 'center' }}>
                        <div style={accionesFila}>
                          {permisos.editar && <Button size="sm" onClick={() => abrir(c)} aria-label={`Editar el contrato de ${c.inquilino_nombre}`}>Editar</Button>}
                          {permisos.editar && c.estado === 'vigente' && (
                            <Button size="sm" variant="secondary" onClick={() => void finalizar(c)} aria-label={`Finalizar el contrato de ${c.inquilino_nombre}`}>Finalizar</Button>
                          )}
                          {permisos.eliminar && <Button size="sm" variant="danger" onClick={() => void borrar(c)} aria-label={`Eliminar el contrato de ${c.inquilino_nombre}`}>Eliminar</Button>}
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editando && (
        <EditModal
          title={editando === 'nuevo' ? 'Nuevo contrato de renta' : `Contrato de ${editando.inquilino_nombre}`}
          onClose={cerrar} size="md" fullScreenOnMobile
          closeOnBackdropClick={!guardando} closeOnEscape={!guardando}
          footer={<>
            <Button variant="secondary" onClick={cerrar} disabled={guardando}>Cancelar</Button>
            <Button type="submit" form="rentas-contrato-form" loading={guardando} loadingText="Guardando...">Guardar</Button>
          </>}
        >
          <form id="rentas-contrato-form" onSubmit={e => { e.preventDefault(); void guardar() }}
            style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
            <div>
              <label htmlFor="rc-propiedad" style={etiqueta}>Propiedad *</label>
              <select id="rc-propiedad" value={form.propiedad_id} onChange={e => elegirPropiedad(e.target.value)} style={campo}
                disabled={editando !== 'nuevo'}>
                <option value="">Elige una propiedad…</option>
                {rentables.map(p => (
                  <option key={p.id} value={p.id} disabled={editando === 'nuevo' && conVigente.has(p.id)}>
                    {p.nombre}{editando === 'nuevo' && conVigente.has(p.id) ? ' — ya tiene contrato vigente' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div style={rejilla(200)}>
              <div>
                <label htmlFor="rc-inquilino" style={etiqueta}>Inquilino *</label>
                <input id="rc-inquilino" type="text" value={form.inquilino_nombre} onChange={e => set('inquilino_nombre', e.target.value)} style={campo} maxLength={150} />
              </div>
              <div>
                <label htmlFor="rc-ident" style={etiqueta}>Identificación</label>
                <input id="rc-ident" type="text" value={form.inquilino_identificacion} onChange={e => set('inquilino_identificacion', e.target.value)} style={campo} maxLength={40} />
              </div>
              <div>
                <label htmlFor="rc-tel" style={etiqueta}>Teléfono</label>
                <input id="rc-tel" type="tel" value={form.inquilino_telefono} onChange={e => set('inquilino_telefono', e.target.value)} style={campo} maxLength={30} />
              </div>
              <div>
                <label htmlFor="rc-email" style={etiqueta}>Correo</label>
                <input id="rc-email" type="email" value={form.inquilino_email} onChange={e => set('inquilino_email', e.target.value)} style={campo} maxLength={150} />
              </div>
            </div>
            <div style={rejilla(150)}>
              <div>
                <label htmlFor="rc-inicio" style={etiqueta}>Inicio *</label>
                <input id="rc-inicio" type="date" value={form.fecha_inicio} onChange={e => set('fecha_inicio', e.target.value)} style={campo} />
              </div>
              <div>
                <label htmlFor="rc-fin" style={etiqueta}>Fin (vacío = indefinido)</label>
                <input id="rc-fin" type="date" value={form.fecha_fin} min={form.fecha_inicio || undefined} onChange={e => set('fecha_fin', e.target.value)} style={campo} />
              </div>
              <div>
                <label htmlFor="rc-estado" style={etiqueta}>Estado</label>
                <select id="rc-estado" value={form.estado} onChange={e => set('estado', e.target.value as EstadoContratoRenta)} style={campo}>
                  {ESTADOS_CONTRATO.map(e => <option key={e} value={e}>{ESTADO_CONTRATO_LABEL[e]}</option>)}
                </select>
              </div>
            </div>
            <div style={rejilla(150)}>
              <div>
                <label htmlFor="rc-renta" style={etiqueta}>Renta mensual ({moneda}) *</label>
                <input id="rc-renta" type="text" inputMode="decimal" value={form.renta_mensual} onChange={e => set('renta_mensual', e.target.value)} style={campo} />
              </div>
              <div>
                <label htmlFor="rc-deposito" style={etiqueta}>Depósito ({moneda})</label>
                <input id="rc-deposito" type="text" inputMode="decimal" value={form.deposito} onChange={e => set('deposito', e.target.value)} style={campo} />
              </div>
              <div>
                <label htmlFor="rc-dia" style={etiqueta}>Día de pago</label>
                <input id="rc-dia" type="text" inputMode="numeric" value={form.dia_pago} onChange={e => set('dia_pago', e.target.value)} placeholder="1–31" style={campo} />
              </div>
            </div>
            <div>
              <label htmlFor="rc-notas" style={etiqueta}>Notas</label>
              <textarea id="rc-notas" value={form.notas} onChange={e => set('notas', e.target.value)} rows={3} style={campo} maxLength={1000} />
            </div>
          </form>
        </EditModal>
      )}
    </div>
  )
}
