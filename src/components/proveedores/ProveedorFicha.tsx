// Ficha del proveedor — la MISMA en Contabilidad y en Operaciones.
//
// Reúne lo que de un proveedor se necesita saber y a dónde se puede llegar desde
// él: contactos, en qué proyectos opera y con qué habilitación, sus contratos,
// órdenes, recepciones, facturas y pagos. Cada sección se muestra SOLO si el
// usuario tiene permiso para ella, y su consulta ni siquiera se hace si no lo
// tiene (la RLS de cada tabla decide además qué filas llegan).
//
// Lo que esta ficha NO muestra a quien solo consulta información operativa: la
// papelería del proveedor (RTU, DPI del representante, referencia bancaria),
// ni facturas ni pagos. Eso es de Contabilidad.
import { useMemo } from 'react'
import { EditModal } from '../shared'
import { StatusBadge } from '../shared/StatusBadge'
import { notify } from '../shared/Dialog'
import { openPromptDialog } from '../shared/PromptDialog'
import {
  useActividadProveedorQuery,
  useAsignacionesDeProveedorQuery,
  useContactosProveedorQuery,
  useContratosDeProveedorQuery,
} from '../../domain/proveedores/queries'
import {
  useActualizarHabilitacionMutation,
  useEliminarContactoMutation,
  useGuardarContactoMutation,
  useVincularProveedorProyectoMutation,
} from '../../domain/proveedores/mutations'
import { contactoFormSchema } from '../../domain/proveedores/schemas'
import { etiquetaProveedor, identificacionDe } from '../../domain/proveedores/identidad'
import { ESTADO_PROVEEDOR_LABELS } from '../../types/compras'
import {
  ABASTECIMIENTO_LABELS,
  ALCANCE_LABELS,
  ESTADO_CONTRATO_LABELS,
  HABILITACION_LABELS,
  type EstadoHabilitacionProyecto,
  type ProveedorCatalogo,
} from '../../types/proveedores'
import type { Proyecto } from '../../types/plataforma'
import { formatCurrency, formatDateShort } from '../../lib/format'
import { btnLink, btnSecundario } from '../contabilidad/ui'
import { usePermisosProveedor } from './permisos'

interface Props {
  proveedor: ProveedorCatalogo
  companyId: string
  proyectos: Proyecto[]
  onClose: () => void
}

const TONO_HAB: Record<EstadoHabilitacionProyecto, 'success' | 'warning' | 'neutral' | 'danger'> = {
  habilitado: 'success', pendiente: 'warning', suspendido: 'danger', retirado: 'neutral',
}

const seccion = { margin: '16px 0 0' } as const
const h3 = { margin: '0 0 6px', fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--at-ink-soft)' } as const
const vacio = { margin: 0, fontSize: 12, color: 'var(--at-ink-soft)' } as const

export function ProveedorFicha({ proveedor: p, companyId, proyectos, onClose }: Props) {
  const permisos = usePermisosProveedor()
  const { data: contactos = [] } = useContactosProveedorQuery(p.id)
  const { data: vinculos = [] } = useAsignacionesDeProveedorQuery(p.id)
  const { data: contratos = [] } = useContratosDeProveedorQuery(p.id, permisos.verContratos)
  const { data: actividad } = useActividadProveedorQuery(p.id, {
    ordenes: permisos.verCompras,
    recepciones: permisos.verCompras,
    facturas: permisos.verContabilidad,
    pagos: permisos.verContabilidad,
  })

  const guardarContacto = useGuardarContactoMutation(companyId)
  const eliminarContacto = useEliminarContactoMutation()
  const vincular = useVincularProveedorProyectoMutation(companyId)
  const habilitacion = useActualizarHabilitacionMutation()

  const nombreProyecto = (id: string) => proyectos.find((x) => x.id === id)?.nombre ?? 'Proyecto'
  const sinVincular = useMemo(
    () => proyectos.filter((x) => !vinculos.some((v) => v.project_id === x.id)),
    [proyectos, vinculos],
  )
  const estadoProv = p.estado ?? (p.activo ? 'autorizado' : 'suspendido')

  async function intentar(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn()
      notify({ variant: 'success', title: 'Listo', text: ok })
    } catch (e) {
      // Los mensajes de los triggers (CODIGO: texto) se muestran tal cual.
      notify({ variant: 'error', title: 'No se pudo', text: e instanceof Error ? e.message : 'Error inesperado.' })
    }
  }

  async function nuevoContacto(existente?: (typeof contactos)[number]) {
    const r = await openPromptDialog({
      title: existente ? 'Editar contacto' : 'Nuevo contacto',
      fields: [
        { name: 'nombre', label: 'Nombre', required: true, initialValue: existente?.nombre ?? '' },
        { name: 'cargo', label: 'Cargo', initialValue: existente?.cargo ?? '' },
        { name: 'email', label: 'Correo', type: 'email', initialValue: existente?.email ?? '' },
        { name: 'telefono', label: 'Teléfono', initialValue: existente?.telefono ?? '' },
        { name: 'principal', label: 'Contacto principal', control: 'checkbox', initialValue: existente?.es_principal ? 'true' : '' },
      ],
      submitText: 'Guardar',
    })
    if (!r) return
    const parsed = contactoFormSchema.safeParse({
      nombre: r.nombre, cargo: r.cargo, email: r.email, telefono: r.telefono,
      es_principal: r.principal === 'true', notas: null,
    })
    if (!parsed.success) {
      notify({ variant: 'warning', title: 'Atención', text: parsed.error.issues[0]?.message ?? 'Datos inválidos.' })
      return
    }
    await intentar(() => guardarContacto.mutateAsync({ id: existente?.id, proveedorId: p.id, input: parsed.data }), 'Contacto guardado.')
  }

  async function cambiarHabilitacion(id: string, estado: EstadoHabilitacionProyecto, proyecto: string) {
    let motivo: string | null = null
    if (estado === 'suspendido' || estado === 'retirado') {
      const r = await openPromptDialog({
        title: `${estado === 'suspendido' ? 'Suspender' : 'Retirar'} a ${p.nombre} en ${proyecto}`,
        description: 'No se borra nada de lo que ya existe: solo deja de poder recibir órdenes y contratos nuevos en este proyecto.',
        fields: [{ name: 'motivo', label: '¿Por qué?', control: 'textarea', rows: 2, required: true }],
        submitText: estado === 'suspendido' ? 'Suspender' : 'Retirar',
      })
      motivo = r?.motivo?.trim() || null
      if (!motivo) return
    }
    const v = vinculos.find((x) => x.id === id)
    await intentar(
      () => habilitacion.mutateAsync({
        id,
        input: {
          estado, motivo_estado: motivo, vigente_hasta: v?.vigente_hasta ?? null,
          dias_credito: v?.dias_credito ?? null, condiciones_pago: v?.condiciones_pago ?? null, notas: v?.notas ?? null,
        },
      }),
      `Proveedor ${HABILITACION_LABELS[estado].toLowerCase()} en ${proyecto}.`,
    )
  }

  return (
    <EditModal
      title={etiquetaProveedor(p)}
      subtitle={`Ficha del proveedor · ${ALCANCE_LABELS[p.alcance ?? 'empresa']}`}
      onClose={onClose}
      size="lg"
      footer={<div style={{ display: 'flex', justifyContent: 'flex-end' }}><button style={btnSecundario} onClick={onClose}>Cerrar</button></div>}
    >
      {/* ── Datos ── */}
      <section aria-label="Datos del proveedor">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, fontSize: 13 }}>
          <Dato k="Código" v={p.codigo ?? '—'} />
          <Dato k="Identificación fiscal" v={identificacionDe(p) ? `${p.nit ?? p.rfc}${p.pais ? ` (${p.pais})` : ''}` : 'Sin identificación'} />
          <Dato k="Qué provee" v={(p.abastece ?? []).map((a) => ABASTECIMIENTO_LABELS[a]).join(', ') || '—'} />
          <Dato k="Crédito" v={`${p.dias_credito} días`} />
          <Dato k="Correo" v={p.email ?? '—'} />
          <Dato k="Teléfono" v={p.telefono ?? '—'} />
          <div>
            <div style={{ fontSize: 11, color: 'var(--at-ink-soft)' }}>Autorización (empresa)</div>
            <StatusBadge tone={estadoProv === 'autorizado' ? 'success' : estadoProv === 'vetado' ? 'danger' : 'warning'}>
              {ESTADO_PROVEEDOR_LABELS[estadoProv] ?? estadoProv}
            </StatusBadge>
          </div>
        </div>
      </section>

      {/* ── Contactos ── */}
      <section style={seccion} aria-label="Contactos">
        <h3 style={h3}>Contactos</h3>
        {contactos.length === 0 && <p style={vacio}>Sin contactos registrados{p.contacto_nombre ? ` (contacto histórico: ${p.contacto_nombre})` : ''}.</p>}
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
          {contactos.map((c) => (
            <li key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
              <strong>{c.nombre}</strong>
              {c.es_principal && <StatusBadge tone="info">Principal</StatusBadge>}
              <span style={{ color: 'var(--at-ink-soft)' }}>{[c.cargo, c.email, c.telefono].filter(Boolean).join(' · ')}</span>
              {permisos.escribirCatalogo && (
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
                  <button style={btnLink} onClick={() => void nuevoContacto(c)}>Editar</button>
                  <button style={btnLink} onClick={() => void intentar(() => eliminarContacto.mutateAsync(c.id), 'Contacto eliminado.')}>Quitar</button>
                </span>
              )}
            </li>
          ))}
        </ul>
        {permisos.escribirCatalogo && <button style={{ ...btnLink, marginTop: 6 }} onClick={() => void nuevoContacto()}>+ Agregar contacto</button>}
      </section>

      {/* ── Proyectos ── */}
      <section style={seccion} aria-label="Proyectos">
        <h3 style={h3}>Proyectos donde opera</h3>
        <p style={{ ...vacio, marginBottom: 6 }}>
          La autorización es de la empresa; la HABILITACIÓN es por proyecto. Vincular no habilita.
        </p>
        {vinculos.length === 0 && <p style={vacio}>No está vinculado a ningún proyecto{(p.alcance ?? 'empresa') === 'empresa' ? ' (alcance de empresa: puede operar en todos, salvo veto)' : ''}.</p>}
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
          {vinculos.map((v) => (
            <li key={v.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
              <strong>{nombreProyecto(v.project_id)}</strong>
              <StatusBadge tone={TONO_HAB[v.estado]}>{HABILITACION_LABELS[v.estado]}</StatusBadge>
              <span style={{ color: 'var(--at-ink-soft)' }}>
                {[v.dias_credito != null ? `${v.dias_credito} días de crédito` : null, v.condiciones_pago, v.vigente_hasta ? `hasta ${formatDateShort(v.vigente_hasta)}` : null]
                  .filter(Boolean).join(' · ')}
              </span>
              {v.motivo_estado && <span style={{ fontSize: 12, color: 'var(--at-danger)' }}>Motivo: {v.motivo_estado}</span>}
              {permisos.cambiarEstado && (
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
                  {v.estado !== 'habilitado' && <button style={btnLink} onClick={() => void cambiarHabilitacion(v.id, 'habilitado', nombreProyecto(v.project_id))}>Habilitar</button>}
                  {v.estado === 'habilitado' && <button style={btnLink} onClick={() => void cambiarHabilitacion(v.id, 'suspendido', nombreProyecto(v.project_id))}>Suspender</button>}
                  {v.estado !== 'retirado' && <button style={btnLink} onClick={() => void cambiarHabilitacion(v.id, 'retirado', nombreProyecto(v.project_id))}>Retirar</button>}
                </span>
              )}
            </li>
          ))}
        </ul>
        {permisos.escribirCatalogo && sinVincular.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12 }}>
              Vincular a un proyecto{' '}
              <select
                defaultValue=""
                aria-label="Vincular a un proyecto"
                onChange={(e) => {
                  const id = e.target.value
                  e.target.value = ''
                  if (id) void intentar(() => vincular.mutateAsync({ proveedorId: p.id, projectId: id }), 'Vinculado como pendiente: habilítalo cuando corresponda.')
                }}
                style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--at-line)' }}
              >
                <option value="">Elige…</option>
                {sinVincular.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
              </select>
            </label>
          </div>
        )}
      </section>

      {/* ── Contratos (Operaciones) ── */}
      {permisos.verContratos && (
        <section style={seccion} aria-label="Contratos">
          <h3 style={h3}>Contratos</h3>
          {contratos.length === 0 && <p style={vacio}>Sin contratos vinculados que puedas ver.</p>}
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
            {contratos.map((c) => (
              <li key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
                <strong>{c.referencia ?? c.servicio}</strong>
                <StatusBadge tone={c.estado === 'activo' ? 'success' : c.estado === 'borrador' ? 'info' : 'neutral'}>{ESTADO_CONTRATO_LABELS[c.estado] ?? c.estado}</StatusBadge>
                <span style={{ color: 'var(--at-ink-soft)' }}>{nombreProyecto(c.project_id)} · desde {formatDateShort(c.fecha_inicio)}{c.fecha_fin ? ` hasta ${formatDateShort(c.fecha_fin)}` : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Compras y contabilidad (según permisos) ── */}
      {permisos.verCompras && (
        <section style={seccion} aria-label="Órdenes y recepciones">
          <h3 style={h3}>Órdenes de compra</h3>
          {(actividad?.ordenes.length ?? 0) === 0 && <p style={vacio}>Sin órdenes de compra.</p>}
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 3, fontSize: 13 }}>
            {actividad?.ordenes.map((o) => (
              <li key={o.id}>
                <strong>{o.numero ?? 'Borrador'}</strong> · {o.concepto} · {o.estado.replace(/_/g, ' ')} · {formatCurrency(o.total, o.moneda ?? 'GTQ')}
                {o.project_id ? ` · ${nombreProyecto(o.project_id)}` : ' · Contabilidad de la empresa'}
              </li>
            ))}
          </ul>
          <h3 style={{ ...h3, marginTop: 12 }}>Recepciones</h3>
          {(actividad?.recepciones.length ?? 0) === 0 && <p style={vacio}>Sin recepciones.</p>}
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 3, fontSize: 13 }}>
            {actividad?.recepciones.map((r) => (
              <li key={r.id}><strong>{r.numero ?? 'Borrador'}</strong> · {formatDateShort(r.fecha)} · {r.estado}{r.orden_numero ? ` · contra ${r.orden_numero}` : ''}</li>
            ))}
          </ul>
        </section>
      )}
      {permisos.verContabilidad && (
        <section style={seccion} aria-label="Facturas y pagos">
          <h3 style={h3}>Facturas</h3>
          {(actividad?.facturas.length ?? 0) === 0 && <p style={vacio}>Sin facturas.</p>}
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 3, fontSize: 13 }}>
            {actividad?.facturas.map((f) => (
              <li key={f.id}>
                <strong>{f.numero_factura ?? 's/n'}</strong> · {f.concepto} · {f.estado.replace(/_/g, ' ')} · {formatCurrency(f.monto_total, f.moneda ?? 'GTQ')} (pagado {formatCurrency(f.monto_pagado, f.moneda ?? 'GTQ')})
              </li>
            ))}
          </ul>
          <h3 style={{ ...h3, marginTop: 12 }}>Pagos</h3>
          {(actividad?.pagos.length ?? 0) === 0 && <p style={vacio}>Sin pagos.</p>}
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 3, fontSize: 13 }}>
            {actividad?.pagos.map((x) => (
              <li key={x.id}>{formatCurrency(x.monto, 'GTQ')} · {x.estado} · {x.metodo_pago}{x.fecha_pago ? ` · ${formatDateShort(x.fecha_pago)}` : ''}</li>
            ))}
          </ul>
        </section>
      )}
      {!permisos.verContabilidad && (
        <p style={{ ...vacio, marginTop: 16 }}>
          La papelería del proveedor, sus facturas y sus pagos son de Contabilidad y no se muestran con tu permiso.
        </p>
      )}
    </EditModal>
  )
}

function Dato({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--at-ink-soft)' }}>{k}</div>
      <div>{v}</div>
    </div>
  )
}
