import { useMemo, useState } from 'react'
import { DataTable, type DataTableColumn } from '../shared'
import { EditModal } from '../shared'
import { StatusBadge } from '../shared/StatusBadge'
import { confirm, notify } from '../shared/Dialog'
import { openPromptDialog } from '../shared/PromptDialog'
import { useProveedoresQuery } from '../../domain/cxp/queries'
import { useGuardarProveedorMutation } from '../../domain/cxp/mutations'
import { proveedorFormSchema } from '../../domain/cxp/schemas'
import {
  useCambiarEstadoProveedorMutation,
  useEliminarDocumentoProveedorMutation,
  useGuardarDocumentoProveedorMutation,
} from '../../domain/compras/mutations'
import { useDocumentosProveedorQuery } from '../../domain/compras/queries'
import { proveedorDocumentoSchema, proveedorEstadoSchema } from '../../domain/compras/schemas'
import { formatDateShort, hoyLocalISO } from '../../lib/format'
import { CATEGORIAS_GASTO_CXP, type Proveedor } from '../../types/cxp'
import {
  ESTADO_PROVEEDOR_LABELS,
  TIPO_DOC_PROVEEDOR_LABELS,
  proveedorHabilitado,
  type EstadoProveedor,
  type TipoDocumentoProveedor,
} from '../../types/compras'
import { Campo, btnLink, btnPrimario, btnSecundario, input, usePermisosContabilidad } from './ui'

interface Props {
  companyId: string
}

/** El proveedor trae `estado` desde la Fase 6; el tipo base de CxP aún no. */
type ProveedorConEstado = Proveedor & {
  estado?: EstadoProveedor
  autorizacion_vence?: string | null
  motivo_estado?: string | null
}

interface FormState {
  id: string | null
  nombre: string
  nit: string
  rfc: string
  email: string
  telefono: string
  contacto_nombre: string
  dias_credito: string
  categoria_default: string
  direccion: string
  notas: string
}

const FORM_VACIO: FormState = {
  id: null, nombre: '', nit: '', rfc: '', email: '', telefono: '',
  contacto_nombre: '', dias_credito: '0', categoria_default: '', direccion: '', notas: '',
}

const TONO_ESTADO: Record<EstadoProveedor, 'success' | 'warning' | 'info' | 'neutral' | 'danger'> = {
  autorizado: 'success',
  en_revision: 'warning',
  borrador: 'info',
  suspendido: 'neutral',
  vetado: 'danger',
}

export function ProveedoresTab({ companyId }: Props) {
  const { puedeCrear, puedeEditar, puedeAutorizar } = usePermisosContabilidad()
  const { data: proveedores = [], isLoading } = useProveedoresQuery(companyId)
  const guardar = useGuardarProveedorMutation(companyId)
  const cambiarEstado = useCambiarEstadoProveedorMutation()
  const [form, setForm] = useState<FormState | null>(null)
  const [documentosDe, setDocumentosDe] = useState<ProveedorConEstado | null>(null)

  const hoy = hoyLocalISO()
  const lista = proveedores as ProveedorConEstado[]

  const sinAutorizar = useMemo(
    () => lista.filter((p) => !proveedorHabilitado(p, hoy)).length,
    [lista, hoy],
  )

  function abrirEdicion(p: Proveedor) {
    setForm({
      id: p.id,
      nombre: p.nombre,
      nit: p.nit ?? '',
      rfc: p.rfc ?? '',
      email: p.email ?? '',
      telefono: p.telefono ?? '',
      contacto_nombre: p.contacto_nombre ?? '',
      dias_credito: String(p.dias_credito),
      categoria_default: p.categoria_default ?? '',
      direccion: p.direccion ?? '',
      notas: p.notas ?? '',
    })
  }

  async function onGuardar() {
    if (!form) return
    const limpio = (v: string) => (v.trim() === '' ? null : v.trim())
    const parsed = proveedorFormSchema.safeParse({
      nombre: form.nombre,
      nit: limpio(form.nit),
      rfc: limpio(form.rfc),
      email: form.email.trim(),
      telefono: limpio(form.telefono),
      direccion: limpio(form.direccion),
      contacto_nombre: limpio(form.contacto_nombre),
      dias_credito: parseInt(form.dias_credito, 10) || 0,
      categoria_default: limpio(form.categoria_default),
      notas: limpio(form.notas),
    })
    if (!parsed.success) {
      notify({ variant: 'warning', title: 'Atención', text: parsed.error.issues[0]?.message ?? 'Datos inválidos.' })
      return
    }
    try {
      await guardar.mutateAsync({ id: form.id ?? undefined, input: parsed.data })
      notify({
        variant: 'success',
        title: 'Listo',
        text: form.id
          ? 'Proveedor actualizado.'
          : 'Proveedor creado en borrador. Autorízalo para poder emitirle órdenes de compra.',
      })
      setForm(null)
    } catch (e) {
      notify({ variant: 'error', title: 'Error', text: e instanceof Error ? e.message : 'No se pudo guardar.' })
    }
  }

  /** Autorizar es un acto con firma: queda quién y hasta cuándo vale. */
  async function autorizar(p: ProveedorConEstado) {
    const r = await openPromptDialog({
      title: `Autorizar a ${p.nombre}`,
      description: 'Desde este momento se le pueden emitir órdenes de compra. Si su papelería caduca (RTU, patente), anota la fecha: al llegar, deja de estar habilitado sin que nadie tenga que acordarse.',
      fields: [{ name: 'vence', label: 'La autorización vence el (opcional)', control: 'input' }],
      submitText: 'Autorizar',
    })
    if (!r) return
    const vence = r.vence?.trim() || null
    const parsed = proveedorEstadoSchema.safeParse({
      estado: 'autorizado', autorizacion_vence: vence, motivo_estado: null,
    })
    if (!parsed.success) {
      notify({ variant: 'warning', title: 'Atención', text: parsed.error.issues[0]?.message ?? 'Fecha inválida (AAAA-MM-DD).' })
      return
    }
    await aplicar(p.id, parsed.data, 'Proveedor autorizado.')
  }

  async function suspender(p: ProveedorConEstado, estado: 'suspendido' | 'vetado') {
    const r = await openPromptDialog({
      title: estado === 'vetado' ? `Vetar a ${p.nombre}` : `Suspender a ${p.nombre}`,
      description: estado === 'vetado'
        ? 'Un proveedor vetado no vuelve a habilitarse con el interruptor: hay que autorizarlo explícitamente.'
        : 'Deja de recibir órdenes de compra y no se le aprueban facturas nuevas hasta que se reactive.',
      fields: [{ name: 'motivo', label: '¿Por qué?', control: 'textarea', rows: 2 }],
      submitText: estado === 'vetado' ? 'Vetar' : 'Suspender',
    })
    const motivo = r?.motivo?.trim()
    if (!motivo) return
    const parsed = proveedorEstadoSchema.safeParse({
      estado, autorizacion_vence: null, motivo_estado: motivo,
    })
    if (!parsed.success) {
      notify({ variant: 'warning', title: 'Atención', text: parsed.error.issues[0]?.message ?? 'Datos inválidos.' })
      return
    }
    await aplicar(p.id, parsed.data, estado === 'vetado' ? 'Proveedor vetado.' : 'Proveedor suspendido.')
  }

  async function aplicar(id: string, input: Parameters<typeof cambiarEstado.mutateAsync>[0]['input'], ok: string) {
    try {
      await cambiarEstado.mutateAsync({ id, input })
      notify({ variant: 'success', title: 'Listo', text: ok })
    } catch (e) {
      notify({ variant: 'error', title: 'Error', text: e instanceof Error ? e.message : 'No se pudo cambiar el estado.' })
    }
  }

  const columns: DataTableColumn<ProveedorConEstado>[] = [
    { key: 'nombre', header: 'Proveedor', accessor: (p) => p.nombre, sortable: true },
    { key: 'nit', header: 'NIT / RFC', accessor: (p) => p.nit ?? p.rfc ?? '', render: (p) => p.nit ?? p.rfc ?? '—', width: 120, hideOnMobile: true },
    { key: 'contacto', header: 'Contacto', accessor: (p) => p.contacto_nombre ?? '', render: (p) => p.contacto_nombre ?? p.email ?? p.telefono ?? '—', hideOnMobile: true },
    { key: 'dias_credito', header: 'Crédito (días)', accessor: (p) => p.dias_credito, numeric: true, width: 110, hideOnMobile: true },
    {
      key: 'estado',
      header: 'Autorización',
      accessor: (p) => p.estado ?? (p.activo ? 'autorizado' : 'suspendido'),
      width: 170,
      render: (p) => {
        const estado = p.estado ?? (p.activo ? 'autorizado' : 'suspendido')
        const vencida = estado === 'autorizado' && !!p.autorizacion_vence && p.autorizacion_vence < hoy
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <StatusBadge tone={vencida ? 'danger' : TONO_ESTADO[estado] ?? 'neutral'}>
              {vencida ? 'Vencido' : ESTADO_PROVEEDOR_LABELS[estado] ?? estado}
            </StatusBadge>
            {p.autorizacion_vence && (
              <span style={{ fontSize: 10, color: vencida ? 'var(--at-danger)' : 'var(--at-ink-soft)' }}>
                {vencida ? 'Venció el ' : 'Vence el '}{formatDateShort(p.autorizacion_vence)}
              </span>
            )}
          </div>
        )
      },
    },
    {
      key: 'acciones',
      header: '',
      width: 230,
      render: (p) => {
        const estado = p.estado ?? (p.activo ? 'autorizado' : 'suspendido')
        return (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            {puedeEditar && (
              <button onClick={(e) => { e.stopPropagation(); abrirEdicion(p) }} style={btnLink}>Editar</button>
            )}
            <button onClick={(e) => { e.stopPropagation(); setDocumentosDe(p) }} style={btnLink}>Papelería</button>
            {puedeAutorizar && estado !== 'autorizado' && (
              <button onClick={(e) => { e.stopPropagation(); void autorizar(p) }} style={btnLink}>Autorizar</button>
            )}
            {puedeAutorizar && estado === 'autorizado' && (
              <button onClick={(e) => { e.stopPropagation(); void suspender(p, 'suspendido') }} style={btnLink}>Suspender</button>
            )}
          </div>
        )
      },
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--at-space-3)' }}>
      {sinAutorizar > 0 && (
        <p style={{ margin: 0, padding: 10, borderRadius: 8, fontSize: 12,
                    background: 'var(--at-warning-tint)', color: 'var(--at-ink)' }}>
          {sinAutorizar === 1
            ? '1 proveedor no está autorizado o su autorización venció.'
            : `${sinAutorizar} proveedores no están autorizados o su autorización venció.`}
          {' '}Solo un proveedor autorizado y vigente recibe órdenes de compra.
        </p>
      )}

      <DataTable<ProveedorConEstado>
        data={lista}
        columns={columns}
        rowKey="id"
        isLoading={isLoading}
        searchableKeys={['nombre', (p) => p.nit ?? '', (p) => p.rfc ?? '']}
        searchPlaceholder="Buscar proveedor…"
        toolbar={puedeCrear
          ? <button onClick={() => setForm({ ...FORM_VACIO })} style={btnPrimario}>+ Nuevo proveedor</button>
          : undefined}
        emptyState={{
          title: 'Sin proveedores',
          description: 'Los nombres usados en gastos y órdenes anteriores se migraron automáticamente. Un proveedor nuevo nace en borrador: completa su papelería y autorízalo antes de emitirle órdenes de compra.',
        }}
      />

      {form && (
        <EditModal title={form.id ? 'Editar proveedor' : 'Nuevo proveedor'} onClose={() => setForm(null)} size="md"
          footer={
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setForm(null)} style={btnSecundario}>Cancelar</button>
              <button onClick={() => void onGuardar()} disabled={guardar.isPending} style={btnPrimario}>Guardar</button>
            </div>
          }
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <Campo label="Nombre *">
                <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} style={{ ...input, width: '100%' }} />
              </Campo>
            </div>
            <Campo label="NIT (GT)">
              <input value={form.nit} onChange={(e) => setForm({ ...form, nit: e.target.value })} style={input} />
            </Campo>
            <Campo label="RFC (MX)">
              <input value={form.rfc} onChange={(e) => setForm({ ...form, rfc: e.target.value })} style={input} />
            </Campo>
            <Campo label="Email">
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={input} />
            </Campo>
            <Campo label="Teléfono">
              <input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} style={input} />
            </Campo>
            <Campo label="Persona de contacto">
              <input value={form.contacto_nombre} onChange={(e) => setForm({ ...form, contacto_nombre: e.target.value })} style={input} />
            </Campo>
            <Campo label="Días de crédito">
              <input type="number" min="0" max="365" value={form.dias_credito} onChange={(e) => setForm({ ...form, dias_credito: e.target.value })} style={input} />
            </Campo>
            <Campo label="Categoría de gasto habitual">
              <select value={form.categoria_default} onChange={(e) => setForm({ ...form, categoria_default: e.target.value })} style={input}>
                <option value="">—</option>
                {CATEGORIAS_GASTO_CXP.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Campo>
            <Campo label="Dirección">
              <input value={form.direccion} onChange={(e) => setForm({ ...form, direccion: e.target.value })} style={input} />
            </Campo>
            <div style={{ gridColumn: '1 / -1' }}>
              <Campo label="Notas">
                <textarea value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} style={{ ...input, width: '100%', minHeight: 50 }} />
              </Campo>
            </div>
          </div>
        </EditModal>
      )}

      {documentosDe && (
        <DocumentosProveedorModal
          companyId={companyId}
          proveedor={documentosDe}
          puedeEditar={puedeEditar}
          onClose={() => setDocumentosDe(null)}
        />
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Papelería del proveedor — es lo que SOSTIENE la autorización
// ════════════════════════════════════════════════════════════════════════════

function DocumentosProveedorModal({
  companyId, proveedor, puedeEditar, onClose,
}: {
  companyId: string
  proveedor: { id: string; nombre: string }
  puedeEditar: boolean
  onClose: () => void
}) {
  const { data: documentos = [], isLoading } = useDocumentosProveedorQuery(proveedor.id)
  const guardar = useGuardarDocumentoProveedorMutation(companyId)
  const eliminar = useEliminarDocumentoProveedorMutation()
  const hoy = hoyLocalISO()

  const [tipo, setTipo] = useState<TipoDocumentoProveedor>('rtu')
  const [numero, setNumero] = useState('')
  const [venceEl, setVenceEl] = useState('')
  const [archivoUrl, setArchivoUrl] = useState('')

  async function agregar() {
    const parsed = proveedorDocumentoSchema.safeParse({
      tipo,
      numero: numero.trim() || null,
      archivo_url: archivoUrl.trim() || null,
      emitido_el: null,
      vence_el: venceEl || null,
      notas: null,
    })
    if (!parsed.success) {
      notify({ variant: 'warning', title: 'Atención', text: parsed.error.issues[0]?.message ?? 'Datos inválidos.' })
      return
    }
    try {
      await guardar.mutateAsync({ proveedorId: proveedor.id, input: parsed.data })
      notify({ variant: 'success', title: 'Listo', text: 'Documento agregado.' })
      setNumero(''); setVenceEl(''); setArchivoUrl('')
    } catch (e) {
      notify({ variant: 'error', title: 'Error', text: e instanceof Error ? e.message : 'No se pudo guardar.' })
    }
  }

  return (
    <EditModal title={`Papelería de ${proveedor.nombre}`} onClose={onClose} size="md"
      footer={<button onClick={onClose} style={btnSecundario}>Cerrar</button>}
    >
      <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--at-ink-soft)' }}>
        Los documentos no bloquean nada por sí solos: lo que habilita al proveedor
        es su estado de autorización. Sirven de respaldo y para saber cuándo toca
        renovarla.
      </p>

      {isLoading && <p style={{ fontSize: 12 }}>Cargando…</p>}

      {!isLoading && documentos.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--at-ink-soft)' }}>Sin documentos registrados.</p>
      )}

      {documentos.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--at-ink-soft)' }}>
              <th style={{ padding: 4 }}>Documento</th>
              <th style={{ padding: 4 }}>Número</th>
              <th style={{ padding: 4, width: 120 }}>Vence</th>
              <th style={{ padding: 4, width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {documentos.map((d) => {
              const vencido = !!d.vence_el && d.vence_el < hoy
              return (
                <tr key={d.id}>
                  <td style={{ padding: 4 }}>
                    {d.archivo_url
                      ? <a href={d.archivo_url} target="_blank" rel="noreferrer">{TIPO_DOC_PROVEEDOR_LABELS[d.tipo]}</a>
                      : TIPO_DOC_PROVEEDOR_LABELS[d.tipo]}
                  </td>
                  <td style={{ padding: 4 }}>{d.numero ?? '—'}</td>
                  <td style={{ padding: 4, color: vencido ? 'var(--at-danger)' : undefined, fontWeight: vencido ? 700 : 400 }}>
                    {d.vence_el ? formatDateShort(d.vence_el) : 'No caduca'}
                  </td>
                  <td style={{ padding: 4, textAlign: 'right' }}>
                    {puedeEditar && (
                      <button
                        style={btnLink}
                        aria-label={`Eliminar ${TIPO_DOC_PROVEEDOR_LABELS[d.tipo]}`}
                        onClick={async () => {
                          const ok = await confirm({ title: 'Eliminar documento', text: '¿Eliminar este documento del expediente?', confirmText: 'Eliminar' })
                          if (ok) await eliminar.mutateAsync(d.id)
                        }}
                      >✕</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {puedeEditar && (
        <div style={{ borderTop: '1px solid var(--at-line)', paddingTop: 12 }}>
          <strong style={{ fontSize: 12 }}>Agregar documento</strong>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
            <Campo label="Tipo">
              <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoDocumentoProveedor)} style={input}>
                {(Object.keys(TIPO_DOC_PROVEEDOR_LABELS) as TipoDocumentoProveedor[]).map((t) => (
                  <option key={t} value={t}>{TIPO_DOC_PROVEEDOR_LABELS[t]}</option>
                ))}
              </select>
            </Campo>
            <Campo label="Número">
              <input value={numero} onChange={(e) => setNumero(e.target.value)} style={input} />
            </Campo>
            <Campo label="Vence el">
              <input type="date" value={venceEl} onChange={(e) => setVenceEl(e.target.value)} style={input} />
            </Campo>
            <Campo label="Enlace al archivo">
              <input value={archivoUrl} onChange={(e) => setArchivoUrl(e.target.value)} placeholder="https://…" style={input} />
            </Campo>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
            <button onClick={() => void agregar()} disabled={guardar.isPending} style={btnPrimario}>Agregar</button>
          </div>
        </div>
      )}
    </EditModal>
  )
}
