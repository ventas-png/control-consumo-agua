// Pestaña «Contratos» de Operaciones (antes «Proveedores»).
//
// El proveedor NO se escribe aquí: se elige del catálogo compartido de la
// empresa (el mismo que ve Contabilidad). Un contrato es la condición bajo la
// que ese proveedor sirve a ESTE proyecto; su ciclo de vida (borrador → activo →
// suspendido/vencido → terminado/cancelado) es independiente de la autorización
// del proveedor. Activar un contrato no crea facturas, pagos ni asientos.
//
// La pantalla ofrece; el servidor decide: transiciones, motivos, congelamiento
// económico, fotografía del proveedor y alcance por proyecto los exigen los
// triggers y la RLS.
import { useMemo, useRef, useState } from 'react'
import { hoyLocalISO } from '../../lib/format'
import { buildUploadPath, validateFileMagic } from '../../lib/fileValidation'
import { BUCKET_CONTRATOS_RESPALDO } from '../../domain/shared/buckets'
import { useProveedoresQuery } from '../../domain/cxp/queries'
import { useAsignacionesQuery, useContactosProveedorQuery, useEventosContratoQuery, useResponsablesQuery } from '../../domain/proveedores/queries'
import {
  useActualizarContratoMutation,
  useCambiarEstadoContratoMutation,
  useCrearContratoMutation,
  useEliminarContratoBorradorMutation,
  useSubirRespaldoContratoMutation,
} from '../../domain/proveedores/mutations'
import {
  diaSiguiente,
  ESTADOS_RENOVABLES,
  useAmpliarMontoContratoMutation,
  useProrrogarContratoMutation,
  useRenovarContratoMutation,
} from '../../domain/proveedores/contratosCompras'
import { contratoFormSchema, faltantesParaActivar, SERVICIOS_CONTRATO } from '../../domain/proveedores/schemas'
import { etiquetaProveedor } from '../../domain/proveedores/identidad'
import {
  ESTADO_CONTRATO_LABELS,
  ESTADOS_CON_MOTIVO,
  MODALIDAD_LABELS,
  PERIODICIDAD_LABELS,
  PERIODICIDADES,
  TRANSICIONES_CONTRATO,
  contratoVigente,
  type ContratoProveedorCatalogo,
  type EstadoContratoProveedor,
  type ModalidadContrato,
  type PeriodicidadContrato,
  type ProveedorCatalogo,
} from '../../types/proveedores'
import { confirm, notify } from '../shared/Dialog'
import { openPromptDialog } from '../shared/PromptDialog'
import { EditModal } from '../shared/EditModal'
import { SecureFileLink } from '../shared/SecureFileLink'
import { StatusBadge } from '../shared/StatusBadge'
import { Campo, input, btnLink, btnPrimario, btnSecundario } from '../contabilidad/ui'
import { ContextoActivo } from './ContextoActivo'
import { HistoricosPanel } from './HistoricosPanel'
import { ProveedorSelector } from './ProveedorSelector'
import { ContratoSeguimientoModal } from './ContratoSeguimientoModal'

interface Props {
  contratos: ContratoProveedorCatalogo[]
  proyectoId: string
  proyectoNombre?: string
  companyId: string
  moneda: string
  canCreate: boolean
  canEdit: boolean
  onRefresh: () => void
}

const TONO: Record<EstadoContratoProveedor, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  borrador: 'neutral', activo: 'success', suspendido: 'warning', vencido: 'warning', terminado: 'neutral', cancelado: 'danger',
}

const ACCION_ETIQUETA: Partial<Record<EstadoContratoProveedor, string>> = {
  activo: 'Activar', suspendido: 'Suspender', vencido: 'Marcar vencido', terminado: 'Terminar', cancelado: 'Cancelar',
}

interface FormState {
  proveedor_id: string | null
  referencia: string
  servicio: string
  modalidad: ModalidadContrato | ''
  periodicidad: PeriodicidadContrato | ''
  moneda: string
  importe_periodico: string
  monto_maximo: string
  alcance: string
  descripcion: string
  fecha_inicio: string
  fecha_fin: string
  contacto_id: string
  contacto_especifico: string
  telefono_especifico: string
  email_especifico: string
  responsable_id: string
  notas: string
}

const vacio = (moneda: string): FormState => ({
  proveedor_id: null, referencia: '', servicio: 'otro', modalidad: '', periodicidad: '', moneda,
  importe_periodico: '', monto_maximo: '', alcance: '', descripcion: '', fecha_inicio: hoyLocalISO(), fecha_fin: '',
  contacto_id: '', contacto_especifico: '', telefono_especifico: '', email_especifico: '', responsable_id: '', notas: '',
})

const num = (s: string): number | null => (s.trim() === '' ? null : Number(s))
const txt = (s: string): string | null => (s.trim() === '' ? null : s.trim())

export function ContratosProveedorTab({ contratos, proyectoId, proyectoNombre, companyId, moneda, canCreate, canEdit, onRefresh }: Props) {
  const { data: proveedores = [] } = useProveedoresQuery(companyId)
  const { data: asignaciones = [] } = useAsignacionesQuery(companyId, proyectoId)
  const { data: responsables = [] } = useResponsablesQuery(companyId)
  const crear = useCrearContratoMutation(companyId, proyectoId)
  const actualizar = useActualizarContratoMutation()
  const cambiarEstado = useCambiarEstadoContratoMutation()
  const eliminar = useEliminarContratoBorradorMutation()
  const subir = useSubirRespaldoContratoMutation()
  const renovarContrato = useRenovarContratoMutation()
  const prorrogarContrato = useProrrogarContratoMutation()
  const ampliarMonto = useAmpliarMontoContratoMutation()
  // La clave de una ampliación se conserva mientras no cambie lo que se pide: un doble clic o un reintento tras
  // un corte de red reenvían LA MISMA clave y el servidor devuelve la ampliación ya registrada.
  const claveAmpliacion = useRef<{ firma: string; clave: string } | null>(null)

  const [filtroEstado, setFiltroEstado] = useState<EstadoContratoProveedor | 'todos'>('todos')
  const [busqueda, setBusqueda] = useState('')
  const [form, setForm] = useState<FormState | null>(null)
  const [editando, setEditando] = useState<ContratoProveedorCatalogo | null>(null)
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [historialDe, setHistorialDe] = useState<ContratoProveedorCatalogo | null>(null)
  const [verHistoricos, setVerHistoricos] = useState(false)
  const [seguirContrato, setSeguirContrato] = useState<string | null>(null)
  const hoy = hoyLocalISO()

  const catalogo = proveedores as ProveedorCatalogo[]
  const porId = useMemo(() => new Map(catalogo.map((p) => [p.id, p])), [catalogo])
  const sinProveedor = contratos.filter((c) => !c.proveedor_id).length

  const filtrados = contratos.filter((c) => {
    if (filtroEstado !== 'todos' && c.estado !== filtroEstado) return false
    const q = busqueda.trim().toLowerCase()
    if (!q) return true
    const p = c.proveedor_id ? porId.get(c.proveedor_id) : undefined
    return [c.proveedor_nombre, c.referencia, c.servicio, p?.codigo, p?.nit, p?.rfc]
      .some((v) => (v ?? '').toString().toLowerCase().includes(q))
  })

  // Con el contrato ya activo, el servidor congela proveedor, importes y fechas de inicio.
  const congelado = !!editando && editando.estado !== 'borrador'

  function abrirNuevo() { setEditando(null); setErrores({}); setForm(vacio(moneda)) }
  function abrirEdicion(c: ContratoProveedorCatalogo) {
    setEditando(c); setErrores({})
    setForm({
      proveedor_id: c.proveedor_id ?? null, referencia: c.referencia ?? '', servicio: c.servicio,
      modalidad: c.modalidad ?? '', periodicidad: c.periodicidad ?? '', moneda: c.moneda ?? moneda,
      importe_periodico: c.importe_periodico?.toString() ?? '', monto_maximo: c.monto_maximo?.toString() ?? '',
      alcance: c.alcance ?? '', descripcion: c.descripcion ?? '', fecha_inicio: c.fecha_inicio, fecha_fin: c.fecha_fin ?? '',
      contacto_id: c.contacto_id ?? '', contacto_especifico: c.proveedor_contacto ?? '',
      telefono_especifico: c.proveedor_telefono ?? '', email_especifico: c.proveedor_email ?? '',
      responsable_id: c.responsable_id ?? '', notas: c.notas ?? '',
    })
  }

  async function guardar() {
    if (!form) return
    const parsed = contratoFormSchema.safeParse({
      proveedor_id: form.proveedor_id,
      referencia: txt(form.referencia),
      servicio: form.servicio,
      modalidad: form.modalidad,
      periodicidad: form.periodicidad || null,
      moneda: form.moneda || null,
      importe_periodico: num(form.importe_periodico),
      monto_maximo: num(form.monto_maximo),
      alcance: txt(form.alcance),
      descripcion: txt(form.descripcion),
      fecha_inicio: form.fecha_inicio,
      fecha_fin: form.fecha_fin || null,
      contacto_id: form.contacto_id || null,
      proveedor_contacto: txt(form.contacto_especifico),
      proveedor_telefono: txt(form.telefono_especifico),
      proveedor_email: form.email_especifico || null,
      responsable_id: form.responsable_id || null,
      notas: txt(form.notas),
    })
    if (!parsed.success) {
      const e: Record<string, string> = {}
      for (const i of parsed.error.issues) e[String(i.path[0] ?? '_')] ??= i.message
      setErrores(e)
      return
    }
    setErrores({})
    try {
      if (editando) {
        // En un contrato ya activo solo se mandan los campos que siguen siendo editables.
        // La fecha final de un contrato ya activado NO se edita aquí: cambiarla es una prórroga y debe quedar
        // documentada con su motivo (contrato_prorrogar). El servidor rechaza ampliarla sin motivo.
        const cambiaFin = congelado && (parsed.data.fecha_fin ?? null) !== (editando.fecha_fin ?? null)
        let motivoFin: string | null = null
        if (cambiaFin) {
          motivoFin = await pedirMotivoProrroga(parsed.data.fecha_fin ?? null)
          if (!motivoFin) return
        }
        const cambios: Record<string, unknown> = congelado
          ? {
              descripcion: parsed.data.descripcion, alcance: parsed.data.alcance,
              responsable_id: parsed.data.responsable_id, notas: parsed.data.notas, referencia: parsed.data.referencia,
            }
          : { ...parsed.data }
        await actualizar.mutateAsync({ id: editando.id, cambios })
        if (cambiaFin && motivoFin) {
          await prorrogarContrato.mutateAsync({ contratoId: editando.id, fechaFin: parsed.data.fecha_fin ?? null, motivo: motivoFin })
        }
      } else {
        await crear.mutateAsync(parsed.data)
      }
      setForm(null); setEditando(null); onRefresh()
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo guardar', text: (e as Error).message })
    }
  }

  async function cambiar(c: ContratoProveedorCatalogo, estado: EstadoContratoProveedor) {
    if (estado === 'activo') {
      const falta = faltantesParaActivar(c)
      if (falta.length) {
        notify({ variant: 'warning', title: 'Falta completar el contrato', text: `Para activarlo faltan: ${falta.join(', ')}.` })
        return
      }
      const r = await confirm({
        title: '¿Activar contrato?',
        text: 'Activarlo no genera facturas, pagos ni asientos: solo habilita las condiciones para comprar bajo este contrato.',
        confirmText: 'Activar',
      })
      if (!r.isConfirmed) return
      await ejecutar(c, estado, null)
      return
    }
    let motivo: string | null = null
    if (ESTADOS_CON_MOTIVO.includes(estado)) {
      const r = await openPromptDialog({
        title: `${ACCION_ETIQUETA[estado]} contrato`,
        description: 'El motivo queda en el historial del contrato y no se puede borrar.',
        fields: [{ name: 'motivo', label: 'Motivo', control: 'textarea', required: true, rows: 3 }],
        submitText: ACCION_ETIQUETA[estado],
        validate: (d) => (d.motivo?.trim() ? null : 'Indica el motivo'),
      })
      if (!r) return
      motivo = r.motivo.trim()
    }
    await ejecutar(c, estado, motivo)
  }

  async function ejecutar(c: ContratoProveedorCatalogo, estado: EstadoContratoProveedor, motivo: string | null) {
    try {
      await cambiarEstado.mutateAsync({ id: c.id, estado, motivo })
      onRefresh()
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo cambiar el estado', text: (e as Error).message })
    }
  }

  async function pedirMotivoProrroga(fechaFin: string | null): Promise<string | null> {
    const r = await openPromptDialog({
      title: 'Prórroga del contrato',
      description: `La nueva fecha final es ${fechaFin ?? 'indefinida'}. El motivo queda en el historial del contrato y no se puede borrar.`,
      fields: [{ name: 'motivo', label: 'Motivo de la prórroga', control: 'textarea', required: true, rows: 3 }],
      submitText: 'Guardar prórroga',
      validate: (d) => ((d.motivo ?? '').trim().length >= 5 ? null : 'Indica el motivo (al menos 5 caracteres)'),
    })
    return r ? r.motivo.trim() : null
  }

  async function prorrogar(c: ContratoProveedorCatalogo) {
    const r = await openPromptDialog({
      title: 'Prorrogar contrato',
      description: 'Cambia la fecha final (vacía = indefinido). Ampliar la vigencia exige proveedor autorizado y habilitado hoy; reducirla es libre. Queda el motivo en el historial.',
      fields: [
        { name: 'fecha_fin', label: 'Nueva fecha final (vacía = indefinido)', type: 'date', initialValue: c.fecha_fin ?? '' },
        { name: 'motivo', label: 'Motivo', control: 'textarea', required: true, rows: 3 },
      ],
      submitText: 'Prorrogar',
      validate: (d) => ((d.motivo ?? '').trim().length >= 5 ? null : 'Indica el motivo (al menos 5 caracteres)'),
    })
    if (!r) return
    try {
      await prorrogarContrato.mutateAsync({ contratoId: c.id, fechaFin: r.fecha_fin || null, motivo: r.motivo.trim() })
      notify({ variant: 'success', title: 'Prórroga registrada', text: 'La nueva vigencia y su motivo quedaron en el historial.' })
      onRefresh()
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo prorrogar', text: (e as Error).message })
    }
  }

  async function renovar(c: ContratoProveedorCatalogo) {
    const r = await openPromptDialog({
      title: 'Renovar contrato',
      description: 'Se crea un contrato NUEVO en borrador, del mismo proveedor y con las mismas condiciones, ligado a este. Este contrato conserva sus condiciones, documentos e historial. Renovar no genera órdenes, facturas, pagos ni asientos; el nuevo se activa aparte.',
      fields: [
        { name: 'fecha_inicio', label: 'Inicio de la renovación', type: 'date', required: true, initialValue: c.fecha_fin ? diaSiguiente(c.fecha_fin) : hoy },
        { name: 'fecha_fin', label: 'Fin (vacío = indefinido)', type: 'date' },
        { name: 'motivo', label: 'Motivo de la renovación', control: 'textarea', required: true, rows: 3 },
      ],
      submitText: 'Crear renovación',
      validate: (d) => (!d.fecha_inicio ? 'Indica el inicio' : (d.motivo ?? '').trim().length < 5 ? 'Indica el motivo (al menos 5 caracteres)' : null),
    })
    if (!r) return
    try {
      await renovarContrato.mutateAsync({ contratoId: c.id, fechaInicio: r.fecha_inicio, fechaFin: r.fecha_fin || null, motivo: r.motivo.trim() })
      notify({ variant: 'success', title: 'Renovación creada en borrador', text: 'Revísala y actívala cuando corresponda. El contrato anterior no cambió.' })
      onRefresh()
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo renovar', text: (e as Error).message })
    }
  }

  async function ampliar(c: ContratoProveedorCatalogo) {
    const r = await openPromptDialog({
      title: 'Ampliar monto máximo',
      description: `Suma un incremento al monto máximo (${c.moneda ?? ''} ${(c.monto_maximo ?? 0).toLocaleString('es')} original) sin sobrescribir la condición original: queda documentado quién, cuánto y por qué.`,
      fields: [
        { name: 'incremento', label: `Incremento (${c.moneda ?? ''})`, type: 'number', required: true },
        { name: 'documento', label: 'Documento o adenda (opcional)' },
        { name: 'motivo', label: 'Motivo', control: 'textarea', required: true, rows: 3 },
      ],
      submitText: 'Ampliar',
      validate: (d) => (!(Number(d.incremento) > 0) ? 'El incremento debe ser mayor que cero' : (d.motivo ?? '').trim().length < 10 ? 'Indica el motivo (al menos 10 caracteres)' : null),
    })
    if (!r) return
    const incremento = Number(r.incremento)
    const firma = `${c.id}|${incremento}|${r.motivo.trim()}|${r.documento ?? ''}`
    if (claveAmpliacion.current?.firma !== firma) claveAmpliacion.current = { firma, clave: crypto.randomUUID() }
    try {
      await ampliarMonto.mutateAsync({
        contratoId: c.id, incremento, motivo: r.motivo.trim(), clave: claveAmpliacion.current.clave, documento: r.documento?.trim() || null,
      })
      notify({ variant: 'success', title: 'Ampliación registrada', text: 'El monto máximo vigente subió; el original se conserva en el historial.' })
      onRefresh()
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo ampliar', text: (e as Error).message })
    }
  }

  async function borrar(c: ContratoProveedorCatalogo) {
    const r = await confirm({
      title: '¿Eliminar borrador?',
      text: 'Solo se pueden eliminar borradores sin documentos relacionados. Un contrato que ya estuvo activo se termina o se cancela, con su motivo.',
      icon: 'warning', variant: 'danger', confirmText: 'Eliminar',
    })
    if (!r.isConfirmed) return
    try { await eliminar.mutateAsync(c.id); onRefresh() }
    catch (e) { notify({ variant: 'error', title: 'No se pudo eliminar', text: (e as Error).message }) }
  }

  async function subirRespaldo(c: ContratoProveedorCatalogo, archivo: File) {
    const v = await validateFileMagic(archivo, 'document')
    if (!v.ok) { notify({ variant: 'warning', title: 'Archivo no válido', text: v.reason }); return }
    try {
      await subir.mutateAsync({
        companyId, projectId: proyectoId, contratoId: c.id, archivo,
        path: buildUploadPath(`${companyId}/${proyectoId}/${c.id}`, archivo.name),
      })
      notify({ variant: 'success', title: 'Respaldo guardado', text: 'El archivo es privado: solo lo ve quien tenga acceso al contrato.' })
      onRefresh()
    } catch (e) {
      notify({ variant: 'error', title: 'No se pudo subir el respaldo', text: (e as Error).message })
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <ContextoActivo
        companyId={companyId}
        proyectoNombre={proyectoNombre ?? null}
        alcance="proyecto"
        titulo="Contratos"
      />
      <p style={{ margin: 0, fontSize: 12, color: 'var(--at-ink-soft)' }}>
        Un contrato es la condición de servicio entre este proyecto y un proveedor del catálogo. El proveedor (su
        autorización y sus datos fiscales) se administra en Contabilidad → Proveedores; aquí se elige, no se escribe.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input aria-label="Buscar contratos" placeholder="Buscar por proveedor, código, NIT o referencia…" value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)} style={{ ...input, minWidth: 260, flex: 1 }} />
        <select aria-label="Filtrar por estado" value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value as typeof filtroEstado)} style={input}>
          <option value="todos">Todos los estados</option>
          {(Object.keys(ESTADO_CONTRATO_LABELS) as EstadoContratoProveedor[]).map((e) => (
            <option key={e} value={e}>{ESTADO_CONTRATO_LABELS[e]}</option>
          ))}
        </select>
        {canCreate && <button type="button" style={btnPrimario} onClick={abrirNuevo}>+ Nuevo contrato</button>}
      </div>

      {sinProveedor > 0 && (
        <div role="status" style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--at-warning)', fontSize: 12 }}>
          {sinProveedor} contrato(s) históricos siguen con el proveedor en texto libre.{' '}
          <button type="button" style={btnLink} onClick={() => setVerHistoricos((v) => !v)}>
            {verHistoricos ? 'Ocultar' : 'Revisar y vincular al catálogo'}
          </button>
        </div>
      )}
      {verHistoricos && <HistoricosPanel companyId={companyId} puedeEditar={canEdit} />}

      {filtrados.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--at-ink-soft)' }}>No hay contratos con estos filtros.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--at-ink-soft)' }}>
                <th scope="col">Proveedor</th><th scope="col">Servicio</th><th scope="col">Modalidad</th>
                <th scope="col">Vigencia</th><th scope="col">Estado</th><th scope="col">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((c) => {
                const p = c.proveedor_id ? porId.get(c.proveedor_id) : undefined
                return (
                  <tr key={c.id} style={{ borderTop: '1px solid var(--at-line)', verticalAlign: 'top' }}>
                    <td>
                      <strong>{p ? etiquetaProveedor(p) : c.proveedor_nombre}</strong>
                      {!c.proveedor_id && <div style={{ fontSize: 11, color: 'var(--at-warning)' }}>Texto libre · sin vincular al catálogo</div>}
                      {c.referencia && <div style={{ fontSize: 11, color: 'var(--at-ink-soft)' }}>Ref. {c.referencia}</div>}
                    </td>
                    <td>{c.servicio}</td>
                    <td>
                      {c.modalidad ? MODALIDAD_LABELS[c.modalidad] : '—'}
                      {c.periodicidad && <div style={{ fontSize: 11 }}>{PERIODICIDAD_LABELS[c.periodicidad]}</div>}
                      {c.importe_periodico != null && <div style={{ fontSize: 11 }}>{c.moneda} {c.importe_periodico.toLocaleString('es')}</div>}
                    </td>
                    <td>
                      {c.fecha_inicio}{c.fecha_fin ? ` → ${c.fecha_fin}` : ' → sin fin'}
                      {c.estado === 'activo' && !contratoVigente(c, hoy) && (
                        <div data-testid={`fuera-de-vigencia-${c.id}`} style={{ fontSize: 11, color: 'var(--at-warning)' }}>
                          Activo, pero hoy está fuera de sus fechas: no ampara órdenes nuevas.
                        </div>
                      )}
                      {c.renovado_de && <div style={{ fontSize: 11, color: 'var(--at-ink-soft)' }}>Renueva a un contrato anterior</div>}
                    </td>
                    <td>
                      <StatusBadge tone={TONO[c.estado] ?? 'neutral'}>{ESTADO_CONTRATO_LABELS[c.estado] ?? c.estado}</StatusBadge>
                      {c.motivo_estado && ['suspendido', 'terminado', 'cancelado'].includes(c.estado) && (
                        <div style={{ fontSize: 11, color: 'var(--at-ink-soft)' }}>{c.motivo_estado}</div>
                      )}
                    </td>
                    <td style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {canEdit && c.estado !== 'terminado' && c.estado !== 'cancelado' && (
                        <button type="button" style={btnLink} onClick={() => abrirEdicion(c)}>Editar</button>
                      )}
                      {canEdit && TRANSICIONES_CONTRATO[c.estado].filter((e) => e !== 'vencido').map((e) => (
                        <button key={e} type="button" style={btnLink} onClick={() => void cambiar(c, e)}>{ACCION_ETIQUETA[e]}</button>
                      ))}
                      <button type="button" style={btnLink} onClick={() => setHistorialDe(c)}>Historial</button>
                      {c.proveedor_id && c.estado !== 'borrador' && (
                        <button type="button" style={btnLink} onClick={() => setSeguirContrato(c.id)}>Seguimiento</button>
                      )}
                      {canEdit && c.proveedor_id && ['activo', 'suspendido', 'vencido'].includes(c.estado) && (
                        <button type="button" style={btnLink} onClick={() => void prorrogar(c)}>Prorrogar</button>
                      )}
                      {canEdit && c.estado === 'activo' && c.monto_maximo != null && (
                        <button type="button" style={btnLink} onClick={() => void ampliar(c)}>Ampliar monto</button>
                      )}
                      {canCreate && c.proveedor_id && (ESTADOS_RENOVABLES as readonly string[]).includes(c.estado) && (
                        <button type="button" style={btnLink} onClick={() => void renovar(c)}>Renovar</button>
                      )}
                      {c.respaldo_path && (
                        <SecureFileLink src={c.respaldo_path} bucket={BUCKET_CONTRATOS_RESPALDO} style={{ fontSize: 12 }}>Respaldo</SecureFileLink>
                      )}
                      {canEdit && c.estado !== 'terminado' && c.estado !== 'cancelado' && (
                        <label style={{ ...btnLink, display: 'inline-block' }}>
                          {c.respaldo_path ? 'Añadir respaldo' : 'Subir respaldo'}
                          <input type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"
                            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void subirRespaldo(c, f) }} />
                        </label>
                      )}
                      {canEdit && c.estado === 'borrador' && (
                        <button type="button" style={{ ...btnLink, color: 'var(--at-danger)' }} onClick={() => void borrar(c)}>Eliminar</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <FormularioContrato
          form={form} setForm={setForm} errores={errores} editando={editando} congelado={congelado}
          proveedores={catalogo} asignaciones={asignaciones} proyectoId={proyectoId}
          responsables={responsables}
          guardando={crear.isPending || actualizar.isPending}
          onCancel={() => { setForm(null); setEditando(null) }} onSave={() => void guardar()}
        />
      )}
      {historialDe && <HistorialContrato contrato={historialDe} onClose={() => setHistorialDe(null)} />}
      {seguirContrato && <ContratoSeguimientoModal contratoId={seguirContrato} onClose={() => setSeguirContrato(null)} />}
    </div>
  )
}

interface FormProps {
  form: FormState
  setForm: (f: FormState) => void
  errores: Record<string, string>
  editando: ContratoProveedorCatalogo | null
  congelado: boolean
  proveedores: ProveedorCatalogo[]
  asignaciones: ReturnType<typeof useAsignacionesQuery>['data']
  proyectoId: string
  responsables: { id: string; full_name: string | null }[]
  guardando: boolean
  onCancel: () => void
  onSave: () => void
}

function FormularioContrato({
  form, setForm, errores, editando, congelado, proveedores, asignaciones, proyectoId, responsables, guardando, onCancel, onSave,
}: FormProps) {
  const { data: contactos = [] } = useContactosProveedorQuery(form.proveedor_id ?? undefined)
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm({ ...form, [k]: v })
  const err = (k: string) => errores[k] && <span role="alert" style={{ color: 'var(--at-danger)', fontSize: 11 }}>{errores[k]}</span>
  return (
    <EditModal
      title={editando ? 'Editar contrato' : 'Nuevo contrato'}
      subtitle={congelado ? 'El contrato ya salió de borrador: proveedor, modalidad e importes están congelados. Para cambiarlos, termina este contrato y crea otro.' : undefined}
      onClose={onCancel}
      size="lg"
      footer={
        <>
          <button type="button" style={btnSecundario} onClick={onCancel}>Cancelar</button>
          <button type="button" style={btnPrimario} disabled={guardando} onClick={onSave}>{guardando ? 'Guardando…' : 'Guardar'}</button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <ProveedorSelector
            proveedores={proveedores} asignaciones={asignaciones ?? []} projectId={proyectoId}
            value={form.proveedor_id} disabled={congelado}
            onChange={(id) => setForm({ ...form, proveedor_id: id, contacto_id: '' })}
          />
          {err('proveedor_id')}
        </div>
        <Campo label="Servicio">
          <select value={form.servicio} disabled={congelado} onChange={(e) => set('servicio', e.target.value)} style={input}>
            {SERVICIOS_CONTRATO.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Campo>
        <Campo label="Referencia / número de contrato">
          <input value={form.referencia} onChange={(e) => set('referencia', e.target.value)} style={input} />
          {err('referencia')}
        </Campo>
        <Campo label="Modalidad">
          <select value={form.modalidad} disabled={congelado} onChange={(e) => set('modalidad', e.target.value as ModalidadContrato)} style={input}>
            <option value="">Elegir…</option>
            {(Object.keys(MODALIDAD_LABELS) as ModalidadContrato[]).map((m) => <option key={m} value={m}>{MODALIDAD_LABELS[m]}</option>)}
          </select>
          {err('modalidad')}
        </Campo>
        <Campo label="Periodicidad">
          <select value={form.periodicidad} disabled={congelado || form.modalidad === 'por_demanda'} onChange={(e) => set('periodicidad', e.target.value as PeriodicidadContrato)} style={input}>
            <option value="">—</option>
            {PERIODICIDADES.map((p) => <option key={p} value={p}>{PERIODICIDAD_LABELS[p]}</option>)}
          </select>
          {err('periodicidad')}
        </Campo>
        <Campo label="Moneda">
          <input value={form.moneda} maxLength={3} disabled={congelado} onChange={(e) => set('moneda', e.target.value.toUpperCase())} style={input} />
          {err('moneda')}
        </Campo>
        <Campo label="Importe periódico">
          <input type="number" min={0} step="0.01" value={form.importe_periodico} disabled={congelado || form.modalidad === 'por_demanda'} onChange={(e) => set('importe_periodico', e.target.value)} style={input} />
          {err('importe_periodico')}
        </Campo>
        <Campo label="Monto máximo (tope)">
          <input type="number" min={0} step="0.01" value={form.monto_maximo} disabled={congelado} onChange={(e) => set('monto_maximo', e.target.value)} style={input} />
          {err('monto_maximo')}
        </Campo>
        <Campo label="Inicio">
          <input type="date" value={form.fecha_inicio} disabled={congelado} onChange={(e) => set('fecha_inicio', e.target.value)} style={input} />
          {err('fecha_inicio')}
        </Campo>
        <Campo label="Fin (vacío = indefinido)">
          <input type="date" value={form.fecha_fin} onChange={(e) => set('fecha_fin', e.target.value)} style={input} />
          {err('fecha_fin')}
        </Campo>
        <Campo label="Responsable en el proyecto">
          <select value={form.responsable_id} onChange={(e) => set('responsable_id', e.target.value)} style={input}>
            <option value="">Elegir…</option>
            {responsables.map((r) => <option key={r.id} value={r.id}>{r.full_name ?? r.id}</option>)}
          </select>
        </Campo>
        <Campo label="Contacto del catálogo">
          <select value={form.contacto_id} disabled={!form.proveedor_id || congelado} onChange={(e) => set('contacto_id', e.target.value)} style={input}>
            <option value="">Ninguno</option>
            {contactos.map((c) => <option key={c.id} value={c.id}>{c.nombre}{c.cargo ? ` · ${c.cargo}` : ''}</option>)}
          </select>
        </Campo>
        <Campo label="Contacto específico del contrato">
          <input value={form.contacto_especifico} onChange={(e) => set('contacto_especifico', e.target.value)} style={input} />
        </Campo>
        <Campo label="Teléfono específico">
          <input value={form.telefono_especifico} onChange={(e) => set('telefono_especifico', e.target.value)} style={input} />
        </Campo>
        <Campo label="Correo específico">
          <input type="email" value={form.email_especifico} onChange={(e) => set('email_especifico', e.target.value)} style={input} />
          {err('proveedor_email')}
        </Campo>
        <div style={{ gridColumn: '1 / -1', display: 'grid', gap: 12 }}>
          <Campo label="Alcance del servicio">
            <textarea rows={2} value={form.alcance} onChange={(e) => set('alcance', e.target.value)} style={input} />
          </Campo>
          <Campo label="Notas">
            <textarea rows={2} value={form.notas} onChange={(e) => set('notas', e.target.value)} style={input} />
          </Campo>
        </div>
      </div>
      <p style={{ fontSize: 11, color: 'var(--at-ink-soft)' }}>
        Al guardar se toma una fotografía del proveedor (nombre, NIT, contacto): si luego cambia en el catálogo, este
        contrato conserva lo que se firmó.
      </p>
    </EditModal>
  )
}

function HistorialContrato({ contrato, onClose }: { contrato: ContratoProveedorCatalogo; onClose: () => void }) {
  const { data: eventos = [], isLoading } = useEventosContratoQuery(contrato.id)
  return (
    <EditModal title="Historial del contrato" subtitle={contrato.proveedor_nombre} onClose={onClose} size="md">
      {isLoading ? <p>Cargando…</p> : eventos.length === 0 ? <p>Sin eventos.</p> : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {eventos.map((e) => (
            <li key={e.id} style={{ borderLeft: '3px solid var(--at-line)', paddingLeft: 10, fontSize: 13 }}>
              <strong>{e.tipo === 'estado' ? `${e.estado_anterior ?? '—'} → ${e.estado_nuevo}` : e.tipo.replace('_', ' ')}</strong>
              <div style={{ fontSize: 11, color: 'var(--at-ink-soft)' }}>{new Date(e.created_at).toLocaleString('es')}</div>
              {e.motivo && <div>Motivo: {e.motivo}</div>}
            </li>
          ))}
        </ol>
      )}
    </EditModal>
  )
}
