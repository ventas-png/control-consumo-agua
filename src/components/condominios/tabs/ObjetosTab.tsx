import { formatDateTime, hoyLocalISO } from '../../../lib/format'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { createCondominioRow, deleteCondominioRow, updateCondominioRow } from '../../../domain/condominios/tabMutations'
import { nombreAreaDe } from '../../../domain/condominios/areas'
import {
  CARPETA_FOTOS_OBJETO, MAX_FOTOS_OBJETO, entregarObjeto, etiquetaEmpleado, fichaDeUsuario, formDesdeObjeto, fotosDe,
  hallazgoDe, nombreReceptorValido, payloadObjeto, personalElegible, validarFormObjeto,
  type ErrorFormObjeto, type FormObjeto,
} from '../../../domain/condominios/objetosPerdidos'
import type { AreaCondominio, CargoCatalogo, ObjetoPerdido, EstadoObjeto, PersonalCondominio, TipoHallazgoObjeto } from '../../../types'
import { notify, confirm } from '../../shared/Dialog'
import { DataTable, type DataTableColumn } from '../../shared/DataTable'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { MultiImageUploader } from '../../shared/ImageUploader'
import { ImageGallery } from '../../shared/ImageGallery'
import { SecureImage } from '../../shared/SecureImage'
import { SignaturePad } from '../../shared/SignaturePad'
import { useTranslation, type TranslationKey } from '../../../lib/i18n'

interface Props {
  objetos: ObjetoPerdido[]
  /** Catálogo compartido (tab Áreas): dónde se encontró y dónde se guarda se ELIGEN de aquí. */
  areas?: AreaCondominio[]
  /** Expediente del condominio: quién lo encontró y el custodio se eligen de los activos. */
  personal?: PersonalCondominio[]
  cargos?: CargoCatalogo[]
  proyectoId: string
  companyId: string
  /** Usuario que registra: si tiene ficha de empleado, se propone como quien lo encontró y custodio. */
  userId: string
  canCreate: boolean
  canEdit: boolean
  /** Eliminar tiene su propio permiso (condominios.tab.objetos.delete): editar no basta. */
  canDelete: boolean
  /** Visibilidad del tab Áreas: decide si se ofrece el atajo para configurarlas. */
  puedeConfigurarAreas?: boolean
  onIrATab?: (tabId: 'areas_config') => void
  onRefresh: () => void
}

const ESTADO_COLOR: Record<EstadoObjeto, { color: string; bg: string }> = {
  en_custodia: { color: 'var(--at-primary)', bg: 'var(--at-primary-soft)' },
  reclamado:   { color: 'var(--at-success)', bg: 'var(--at-success-tint)' },
  donado:      { color: 'var(--at-accent)', bg: 'var(--at-accent-tint)' },
  descartado:  { color: 'var(--at-ink-3)', bg: 'var(--at-chip)' },
}
const ESTADO_LABEL_KEY: Record<EstadoObjeto, TranslationKey> = {
  en_custodia: 'condominios.objetos.estado_en_custodia',
  reclamado:   'condominios.objetos.estado_reclamado',
  donado:      'condominios.objetos.estado_donado',
  descartado:  'condominios.objetos.estado_descartado',
}
const ERROR_KEY: Record<ErrorFormObjeto, TranslationKey> = {
  descripcion:         'condominios.objetos.err_descripcion',
  encontrado_personal: 'condominios.objetos.err_encontrado_personal',
  encontrado_tercero:  'condominios.objetos.err_encontrado_tercero',
}

const inputStyle: CSSProperties = {
  width: '100%', minWidth: 0, padding: '8px 10px', border: '1.5px solid var(--at-line)', borderRadius: '8px',
  fontSize: '13px', color: 'var(--at-ink)', background: 'var(--at-surface-2)', boxSizing: 'border-box',
}
const labelStyle: CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-3)', marginBottom: '4px', display: 'block' }
const ayudaStyle: CSSProperties = { fontSize: '11px', color: 'var(--at-ink-3)', marginTop: '4px' }
const seccionStyle: CSSProperties = {
  gridColumn: '1 / -1', fontSize: '12px', fontWeight: 700, color: 'var(--at-ink-2)', textTransform: 'uppercase',
  letterSpacing: '0.04em', marginTop: '6px', paddingBottom: '4px', borderBottom: '1px solid var(--at-chip)',
}
const accionStyle = (bg: string, color: string): CSSProperties => ({
  padding: '4px 8px', background: bg, color, border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
})

export function ObjetosTab({
  objetos, areas = [], personal = [], cargos = [], proyectoId, companyId, userId,
  canCreate, canEdit, canDelete, puedeConfigurarAreas = false, onIrATab, onRefresh,
}: Props) {
  const { t } = useTranslation()
  const [filtroEstado, setFiltroEstado] = useState<EstadoObjeto | 'todos'>('en_custodia')
  // null = cerrada; editId null = registro nuevo.
  const [ventana, setVentana] = useState<{ editId: string | null } | null>(null)
  const [form, setForm] = useState<FormObjeto | null>(null)
  const [saving, setSaving] = useState(false)
  const [subiendo, setSubiendo] = useState(0)
  const [detalleId, setDetalleId] = useState<string | null>(null)
  const [entregaId, setEntregaId] = useState<string | null>(null)
  const [recibe, setRecibe] = useState('')
  const [documento, setDocumento] = useState('')
  const [entregando, setEntregando] = useState(false)

  const filtered = objetos.filter(o => filtroEstado === 'todos' || o.estado === filtroEstado)

  // Áreas del catálogo: sólo las activas se ofrecen; las inactivas siguen
  // nombrando lo ya registrado.
  const areasActivas = [...areas]
    .filter(a => a.activo)
    .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))
  const nombreArea = (id: string | null | undefined, fallback = '') => nombreAreaDe(id, areas, fallback)
  const lugarDe = (o: ObjetoPerdido) => nombreArea(o.area_encontrado_id, o.lugar_encontrado ?? '')
  const almacenDe = (o: ObjetoPerdido) => [nombreArea(o.area_almacenamiento_id), o.almacenamiento_detalle].filter(Boolean).join(' · ')

  const elegibles = personalElegible(personal)
  const propia = fichaDeUsuario(userId, personal)
  // Un empleado inactivo ya elegido se sigue mostrando para no perderlo.
  const opcionesPersonal = (actual: string) => {
    const fuera = actual && !elegibles.some(p => p.id === actual) ? personal.find(p => p.id === actual) : undefined
    return fuera ? [...elegibles, fuera] : elegibles
  }

  function formNuevo(): FormObjeto {
    // Quien registra suele ser quien lo encontró y quien lo guarda: si su
    // usuario tiene ficha de empleado se propone en los dos lugares.
    return {
      descripcion: '', fotos: [], area_encontrado_id: '', fecha_encontrado: hoyLocalISO(),
      encontrado_por_tipo: elegibles.length > 0 ? 'personal' : 'tercero',
      encontrado_por_personal_id: propia?.id ?? '', encontrado_por_nombre: '', encontrado_por_contacto: '',
      custodio_personal_id: propia?.id ?? '', area_almacenamiento_id: '', almacenamiento_detalle: '', notas: '',
    }
  }

  function abrirNuevo() {
    setForm(formNuevo())
    setVentana({ editId: null })
  }

  function abrirEdicion(o: ObjetoPerdido) {
    setForm(formDesdeObjeto(o))
    setVentana({ editId: o.id })
  }

  // No se cierra a mitad del guardado ni de una subida: cerrar ahí escondería el error.
  const ocupado = saving || subiendo > 0
  function cerrarVentana() {
    if (ocupado) return
    setVentana(null)
    setForm(null)
  }

  const setF = <K extends keyof FormObjeto>(k: K, v: FormObjeto[K]) => setForm(f => (f ? { ...f, [k]: v } : f))

  async function handleSave() {
    if (!form || !ventana || ocupado) return
    const falta = validarFormObjeto(form)
    if (falta) return notify({ variant: 'warning', title: t('condominios.comun.required'), text: t(ERROR_KEY[falta]) })
    setSaving(true)
    const previo = ventana.editId ? objetos.find(o => o.id === ventana.editId) : undefined
    const payload = payloadObjeto(form, areas, previo)
    const { error } = ventana.editId
      ? await updateCondominioRow('objetos_perdidos', ventana.editId, payload)
      : await createCondominioRow('objetos_perdidos', {
        company_id: companyId, project_id: proyectoId, estado: 'en_custodia', registrado_por: userId || null, ...payload,
      })
    setSaving(false)
    if (error) return notify({ variant: 'error', title: t('condominios.comun.error'), text: error.message })
    setVentana(null)
    setForm(null)
    onRefresh()
  }

  async function handleDelete(id: string) {
    // El botón ya se oculta sin permiso; esto cubre cualquier otra vía.
    if (!canDelete) return
    const result = await confirm({ title: t('condominios.objetos.delete_confirm'), icon: 'warning', variant: 'danger', confirmText: t('condominios.comun.delete') })
    if (!result.isConfirmed) return
    const { error } = await deleteCondominioRow('objetos_perdidos', id)
    if (error) return notify({ variant: 'error', title: t('condominios.comun.error'), text: error.message })
    setDetalleId(null)
    onRefresh()
  }

  async function handleEstado(id: string, estado: 'donado' | 'descartado') {
    const { error } = await updateCondominioRow('objetos_perdidos', id, { estado })
    if (error) return notify({ variant: 'error', title: t('condominios.comun.error'), text: error.message })
    onRefresh()
  }

  function abrirEntrega(o: ObjetoPerdido) {
    setRecibe('')
    setDocumento('')
    setEntregaId(o.id)
  }
  const cerrarEntrega = () => { if (!entregando) setEntregaId(null) }

  async function firmarEntrega(firma: File) {
    const objeto = entregaId ? objetos.find(o => o.id === entregaId) : undefined
    if (!objeto || entregando) return
    if (!nombreReceptorValido(recibe)) {
      notify({ variant: 'warning', title: t('condominios.comun.required'), text: t('condominios.objetos.err_recibe') }); return
    }
    setEntregando(true)
    try {
      const { error } = await entregarObjeto(objeto, { recibe, documento, fecha: hoyLocalISO(), firma })
      if (error) { notify({ variant: 'error', title: t('condominios.objetos.entrega_error'), text: error }); return }
      notify({ variant: 'success', title: t('condominios.objetos.entrega_ok'), text: t('condominios.objetos.entrega_ok_text', { nombre: recibe.trim() }), duration: 2500 })
      setEntregaId(null)
      onRefresh()
    } finally {
      setEntregando(false)
    }
  }

  // Se lee el registro vigente, no una copia: tras entregar, el detalle ya
  // muestra la entrega y la firma.
  const detalle = detalleId ? objetos.find(o => o.id === detalleId) ?? null : null
  const enEntrega = entregaId ? objetos.find(o => o.id === entregaId) ?? null : null
  const puedeEditar = (o: ObjetoPerdido) => canEdit && o.estado !== 'reclamado'

  const estadoChip = (o: ObjetoPerdido) => {
    const c = ESTADO_COLOR[o.estado] ?? ESTADO_COLOR.descartado
    return <span style={{ padding: '3px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 700, background: c.bg, color: c.color, whiteSpace: 'nowrap' }}>{ESTADO_LABEL_KEY[o.estado] ? t(ESTADO_LABEL_KEY[o.estado]) : o.estado}</span>
  }

  /** Select de un área del catálogo; el área guardada puede estar inactiva y se sigue ofreciendo. */
  const selectArea = (id: string, value: string, onChange: (v: string) => void) => {
    const fuera = value && !areasActivas.some(a => a.id === value) ? value : null
    return (
      <select id={id} style={inputStyle} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">{t('condominios.objetos.sin_area')}</option>
        {areasActivas.map(a => <option key={a.id} value={a.id}>{a.icono} {a.nombre}</option>)}
        {fuera && <option value={fuera}>{t('condominios.objetos.area_inactiva', { nombre: nombreArea(fuera, '—') })}</option>}
      </select>
    )
  }

  const avisoSinAreas = areasActivas.length === 0 && (
    <div style={ayudaStyle}>
      {t('condominios.objetos.sin_areas')}{' '}
      {puedeConfigurarAreas && onIrATab
        ? (
          <button type="button" onClick={() => { cerrarVentana(); onIrATab('areas_config') }}
            style={{ background: 'none', border: 'none', padding: 0, color: 'var(--at-accent)', fontWeight: 600, fontSize: '11px', cursor: 'pointer', textDecoration: 'underline' }}>
            {t('condominios.objetos.sin_areas_crear')}
          </button>
        )
        : t('condominios.objetos.sin_areas_otro')}
    </div>
  )

  const selectPersonal = (id: string, value: string, onChange: (v: string) => void, vacio: string) => (
    <select id={id} style={inputStyle} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">{vacio}</option>
      {opcionesPersonal(value).map(p => (
        <option key={p.id} value={p.id}>{etiquetaEmpleado(p, cargos)}{p.id === propia?.id ? ` ${t('condominios.objetos.tu')}` : ''}</option>
      ))}
    </select>
  )

  const editado = ventana?.editId ? objetos.find(o => o.id === ventana.editId) : undefined
  const lugarLegado = editado && !editado.area_encontrado_id && editado.lugar_encontrado && form && !form.area_encontrado_id ? editado.lugar_encontrado : null

  return (
    <div style={{ padding: '20px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--at-ink)' }}>{t('condominios.objetos.title')}</h2>
        {canCreate && (
          <Button onClick={abrirNuevo}>{t('condominios.objetos.new_button')}</Button>
        )}
      </div>

      {/* Registro / edición en ventana (antes, un formulario fijo sobre la lista). */}
      {ventana && form && (
        <EditModal
          title={ventana.editId ? t('condominios.objetos.form_title_edit') : t('condominios.objetos.form_title_new')}
          maxWidth="720px"
          fullScreenOnMobile
          onClose={cerrarVentana}
          closeOnBackdropClick={!ocupado}
          closeOnEscape={!ocupado}
          footer={
            <>
              <Button variant="secondary" onClick={cerrarVentana} disabled={ocupado}>{t('condominios.comun.cancel')}</Button>
              <Button type="submit" form="objeto-form" loading={saving} disabled={subiendo > 0} loadingText={t('condominios.comun.saving')}>
                {subiendo > 0 ? t('condominios.objetos.subiendo_fotos') : ventana.editId ? t('condominios.comun.update') : t('condominios.comun.register')}
              </Button>
            </>
          }
        >
          <form
            id="objeto-form"
            onSubmit={e => { e.preventDefault(); void handleSave() }}
            style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: '12px', alignItems: 'start' }}
          >
            <div style={seccionStyle}>{t('condominios.objetos.seccion_objeto')}</div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="objeto-descripcion" style={labelStyle}>{t('condominios.objetos.descripcion')}</label>
              <input id="objeto-descripcion" style={inputStyle} value={form.descripcion} onChange={e => setF('descripcion', e.target.value)} placeholder={t('condominios.objetos.descripcion_placeholder')} autoFocus />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <MultiImageUploader values={form.fotos} onChange={fotos => setF('fotos', fotos)} folder={CARPETA_FOTOS_OBJETO}
                label={t('condominios.objetos.fotos')} maxFiles={MAX_FOTOS_OBJETO} capture onSubiendo={s => setSubiendo(n => n + (s ? 1 : -1))} />
            </div>

            <div style={seccionStyle}>{t('condominios.objetos.seccion_hallazgo')}</div>
            <div>
              <label htmlFor="objeto-area-encontrado" style={labelStyle}>{t('condominios.objetos.area_encontrado')}</label>
              {selectArea('objeto-area-encontrado', form.area_encontrado_id, v => setF('area_encontrado_id', v))}
              {lugarLegado && <div style={ayudaStyle}>{t('condominios.objetos.lugar_legado', { lugar: lugarLegado })}</div>}
              {avisoSinAreas}
            </div>
            <div>
              <label htmlFor="objeto-fecha" style={labelStyle}>{t('condominios.objetos.fecha')}</label>
              <input id="objeto-fecha" style={inputStyle} type="date" value={form.fecha_encontrado} onChange={e => setF('fecha_encontrado', e.target.value)} />
            </div>

            <div style={seccionStyle}>{t('condominios.objetos.seccion_quien')}</div>
            <div role="radiogroup" aria-label={t('condominios.objetos.seccion_quien')} style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {(['personal', 'tercero'] as TipoHallazgoObjeto[]).map(tipo => {
                const activo = form.encontrado_por_tipo === tipo
                return (
                  <button key={tipo} type="button" role="radio" aria-checked={activo} onClick={() => setF('encontrado_por_tipo', tipo)}
                    style={{ padding: '7px 14px', borderRadius: '9px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', border: '1.5px solid',
                      borderColor: activo ? 'var(--at-primary)' : 'var(--at-line)', background: activo ? 'var(--at-primary-soft)' : 'var(--at-surface)',
                      color: activo ? 'var(--at-primary)' : 'var(--at-ink-3)' }}>
                    {tipo === 'personal' ? `👮 ${t('condominios.objetos.quien_personal')}` : `🙋 ${t('condominios.objetos.quien_tercero')}`}
                  </button>
                )
              })}
            </div>
            {form.encontrado_por_tipo === 'personal' ? (
              <div style={{ gridColumn: '1 / -1' }}>
                <label htmlFor="objeto-encontrado-por" style={labelStyle}>{t('condominios.objetos.empleado')}</label>
                {selectPersonal('objeto-encontrado-por', form.encontrado_por_personal_id, v => setF('encontrado_por_personal_id', v),
                  elegibles.length ? t('condominios.objetos.elegir_empleado') : t('condominios.objetos.sin_personal'))}
              </div>
            ) : (
              <>
                <div>
                  <label htmlFor="objeto-tercero-nombre" style={labelStyle}>{t('condominios.objetos.tercero_nombre')}</label>
                  <input id="objeto-tercero-nombre" style={inputStyle} value={form.encontrado_por_nombre} onChange={e => setF('encontrado_por_nombre', e.target.value)} placeholder={t('condominios.objetos.tercero_nombre_placeholder')} />
                </div>
                <div>
                  <label htmlFor="objeto-tercero-contacto" style={labelStyle}>{t('condominios.objetos.tercero_contacto')}</label>
                  <input id="objeto-tercero-contacto" style={inputStyle} value={form.encontrado_por_contacto} onChange={e => setF('encontrado_por_contacto', e.target.value)} placeholder={t('condominios.objetos.tercero_contacto_placeholder')} />
                </div>
              </>
            )}

            <div style={seccionStyle}>{t('condominios.objetos.seccion_custodia')}</div>
            <div>
              <label htmlFor="objeto-custodio" style={labelStyle}>{t('condominios.objetos.custodio')}</label>
              {selectPersonal('objeto-custodio', form.custodio_personal_id, v => setF('custodio_personal_id', v),
                elegibles.length ? t('condominios.objetos.sin_custodio') : t('condominios.objetos.sin_personal'))}
              {form.custodio_personal_id && form.custodio_personal_id === propia?.id && (
                <div style={ayudaStyle}>{t('condominios.objetos.custodio_propio')}</div>
              )}
            </div>
            <div>
              <label htmlFor="objeto-area-almacen" style={labelStyle}>{t('condominios.objetos.area_almacenamiento')}</label>
              {selectArea('objeto-area-almacen', form.area_almacenamiento_id, v => setF('area_almacenamiento_id', v))}
            </div>
            <div>
              <label htmlFor="objeto-almacen-detalle" style={labelStyle}>{t('condominios.objetos.almacenamiento_detalle')}</label>
              <input id="objeto-almacen-detalle" style={inputStyle} value={form.almacenamiento_detalle} onChange={e => setF('almacenamiento_detalle', e.target.value)} placeholder={t('condominios.objetos.almacenamiento_detalle_placeholder')} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="objeto-notas" style={labelStyle}>{t('condominios.comun.notes')}</label>
              <textarea id="objeto-notas" rows={2} style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }} value={form.notas} onChange={e => setF('notas', e.target.value)} placeholder={t('condominios.objetos.notas_placeholder')} />
            </div>
          </form>
        </EditModal>
      )}

      {/* Detalle en ventana: fotos, hallazgo, custodia y la entrega con su firma. */}
      {detalle && (
        <EditModal
          title={detalle.descripcion}
          subtitle={<span style={{ display: 'inline-flex', gap: '6px 10px', alignItems: 'center', flexWrap: 'wrap' }}>{estadoChip(detalle)}<span>{detalle.fecha_encontrado}</span></span>}
          maxWidth="600px"
          fullScreenOnMobile
          onClose={() => setDetalleId(null)}
          footer={
            <>
              {canEdit && detalle.estado === 'en_custodia' && (
                <Button variant="success" onClick={() => abrirEntrega(detalle)}>{t('condominios.objetos.accion_entregar')}</Button>
              )}
              {puedeEditar(detalle) && (
                <Button variant="secondary" onClick={() => { setDetalleId(null); abrirEdicion(detalle) }}>{t('condominios.comun.edit')}</Button>
              )}
              <Button variant="secondary" onClick={() => setDetalleId(null)}>{t('condominios.objetos.cerrar')}</Button>
            </>
          }
        >
          <DetalleObjeto objeto={detalle} lugar={lugarDe(detalle)} almacen={almacenDe(detalle)} />
        </EditModal>
      )}

      {/* Entrega al propietario con firma. Encima del detalle si se abrió desde él. */}
      {enEntrega && (
        <EditModal
          title={t('condominios.objetos.entrega_title')}
          subtitle={t('condominios.objetos.entrega_subtitle')}
          maxWidth="560px"
          fullScreenOnMobile
          onClose={cerrarEntrega}
          closeOnBackdropClick={!entregando}
          closeOnEscape={!entregando}
        >
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', background: 'var(--at-surface-2)', borderRadius: '10px', padding: '10px 12px', marginBottom: '14px' }}>
            {fotosDe(enEntrega)[0] && (
              <SecureImage src={fotosDe(enEntrega)[0]} alt={enEntrega.descripcion}
                style={{ width: '56px', height: '56px', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--at-line)', flexShrink: 0 }} />
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--at-ink)', overflowWrap: 'anywhere' }}>{enEntrega.descripcion}</div>
              {(enEntrega.custodio_nombre || almacenDe(enEntrega)) && (
                <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>
                  {[enEntrega.custodio_nombre && `👤 ${enEntrega.custodio_nombre}`, almacenDe(enEntrega) && `📦 ${almacenDe(enEntrega)}`].filter(Boolean).join(' · ')}
                </div>
              )}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))', gap: '12px', marginBottom: '14px' }}>
            <div>
              <label htmlFor="objeto-entrega-recibe" style={labelStyle}>{t('condominios.objetos.entrega_recibe')}</label>
              <input id="objeto-entrega-recibe" style={inputStyle} value={recibe} onChange={e => setRecibe(e.target.value)} placeholder={t('condominios.objetos.entrega_recibe_placeholder')} disabled={entregando} autoFocus />
            </div>
            <div>
              <label htmlFor="objeto-entrega-documento" style={labelStyle}>{t('condominios.objetos.entrega_documento')}</label>
              <input id="objeto-entrega-documento" style={inputStyle} value={documento} onChange={e => setDocumento(e.target.value)} placeholder={t('condominios.objetos.entrega_documento_placeholder')} disabled={entregando} />
            </div>
          </div>
          <div style={labelStyle}>{t('condominios.objetos.entrega_firma')}</div>
          <SignaturePad onSave={f => void firmarEntrega(f)} onCancel={cerrarEntrega} saving={entregando}
            saveLabel={entregando ? t('condominios.objetos.entrega_registrando') : t('condominios.objetos.entrega_confirmar')} />
        </EditModal>
      )}

      {/* Lista: tocar un objeto abre su detalle; «Ver» es el camino de teclado. */}
      <DataTable<ObjetoPerdido>
        data={filtered}
        rowKey="id"
        pageSize={50}
        mobileCardLayout
        defaultSort={{ key: 'fecha_encontrado', direction: 'desc' }}
        onRowClick={o => setDetalleId(o.id)}
        searchPlaceholder={t('condominios.objetos.search_placeholder')}
        searchableKeys={['descripcion', o => lugarDe(o), o => o.encontrado_por_nombre ?? '', o => o.custodio_nombre ?? '', o => almacenDe(o), o => o.reclamado_por ?? '']}
        filters={[
          {
            key: 'estado',
            label: t('condominios.comun.status'),
            value: filtroEstado,
            onChange: v => setFiltroEstado(v as EstadoObjeto | 'todos'),
            options: [
              { value: 'todos', label: t('condominios.comun.all_statuses') },
              ...(Object.keys(ESTADO_LABEL_KEY) as EstadoObjeto[]).map(k => ({ value: k, label: t(ESTADO_LABEL_KEY[k]) })),
            ],
          },
        ]}
        emptyState={{ icon: '🔍', title: t('condominios.objetos.empty') }}
        columns={[
          {
            key: 'descripcion', header: t('condominios.objetos.col_objeto'), sortable: true,
            render: o => {
              const foto = fotosDe(o)[0]
              const quien = hallazgoDe(o)
              return (
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', minWidth: 0 }}>
                  {foto && (
                    <SecureImage src={foto} alt="" style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '6px', border: '1px solid var(--at-line)', flexShrink: 0 }} />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: 'var(--at-ink)', fontSize: '14px', overflowWrap: 'anywhere' }}>{o.descripcion}</div>
                    {lugarDe(o) && <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>📍 {lugarDe(o)}</div>}
                    {quien && (
                      <div style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>
                        {quien.tercero ? '🙋' : '👮'} {quien.nombre}{quien.tercero ? ` (${t('condominios.objetos.tercero_tag')})` : ''}
                      </div>
                    )}
                    {o.notas && <div style={{ fontSize: '11px', color: 'var(--at-ink-3)', fontStyle: 'italic' }}>{o.notas}</div>}
                  </div>
                </div>
              )
            },
          },
          {
            key: 'estado', header: t('condominios.comun.status'), sortable: true,
            accessor: o => (ESTADO_LABEL_KEY[o.estado] ? t(ESTADO_LABEL_KEY[o.estado]) : o.estado),
            render: o => estadoChip(o),
          },
          {
            key: 'fecha_encontrado', header: t('condominios.objetos.col_encontrado'), sortable: true, hideOnMobile: true,
            render: o => <span style={{ fontSize: '12px', color: 'var(--at-ink-3)' }}>{o.fecha_encontrado}</span>,
          },
          {
            key: 'custodia', header: t('condominios.objetos.col_custodia'), hideOnMobile: true,
            accessor: o => o.custodio_nombre ?? '',
            render: o => (o.custodio_nombre || almacenDe(o)) ? (
              <div style={{ fontSize: '12px', color: 'var(--at-ink-2)' }}>
                {o.custodio_nombre && <div>👤 {o.custodio_nombre}</div>}
                {almacenDe(o) && <div style={{ color: 'var(--at-ink-3)' }}>📦 {almacenDe(o)}</div>}
              </div>
            ) : <span style={{ color: 'var(--at-ink-3)' }}>—</span>,
          },
          {
            key: 'reclamo', header: t('condominios.objetos.col_reclamo'), hideOnMobile: true,
            accessor: o => o.reclamado_por ?? '',
            render: o => o.reclamado_por ? (
              <span style={{ fontSize: '12px', color: 'var(--at-ink-2)' }}>
                {o.firma_entrega_path ? '✍ ' : ''}{o.reclamado_por}{o.fecha_reclamo ? ` (${o.fecha_reclamo})` : ''}
              </span>
            ) : <span style={{ color: 'var(--at-ink-3)' }}>—</span>,
          },
          {
            key: 'actions', header: '', align: 'right',
            render: o => (
              <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
                <button type="button" onClick={() => setDetalleId(o.id)} aria-label={t('condominios.objetos.ver_aria', { objeto: o.descripcion })} style={accionStyle('var(--at-chip)', 'var(--at-ink-2)')}>
                  {t('condominios.objetos.ver')}
                </button>
                {canEdit && o.estado === 'en_custodia' && (
                  <>
                    <button type="button" onClick={() => abrirEntrega(o)} aria-label={t('condominios.objetos.accion_entregar_aria', { objeto: o.descripcion })} style={accionStyle('var(--at-success-tint)', 'var(--at-success-strong)')}>
                      {t('condominios.objetos.accion_entregar')}
                    </button>
                    <button type="button" onClick={() => void handleEstado(o.id, 'donado')} style={accionStyle('var(--at-accent-tint)', 'var(--at-accent-hover)')}>
                      {t('condominios.objetos.accion_donar')}
                    </button>
                    <button type="button" onClick={() => void handleEstado(o.id, 'descartado')} style={accionStyle('var(--at-chip)', 'var(--at-ink-3)')}>
                      {t('condominios.objetos.accion_descartar')}
                    </button>
                  </>
                )}
                {puedeEditar(o) && <button type="button" onClick={() => abrirEdicion(o)} aria-label={t('condominios.comun.edit')} style={{ ...accionStyle('var(--at-chip)', 'var(--at-ink-2)'), fontWeight: 400 }}>✏️</button>}
                {canDelete && <button type="button" onClick={() => void handleDelete(o.id)} aria-label={t('condominios.comun.delete')} style={{ ...accionStyle('var(--at-danger-tint)', 'var(--at-danger)'), fontWeight: 400 }}>🗑️</button>}
              </div>
            ),
          },
        ] satisfies DataTableColumn<ObjetoPerdido>[]}
      />
    </div>
  )
}

/** Fila «rótulo — valor» del detalle. */
function Dato({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', padding: '7px 0', borderBottom: '1px solid var(--at-chip)', fontSize: '13.5px' }}>
      <span style={{ color: 'var(--at-ink-3)', fontWeight: 600, flexShrink: 0 }}>{label}</span>
      <span style={{ color: 'var(--at-ink)', textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere' }}>{children}</span>
    </div>
  )
}

/** Detalle de solo lectura de un objeto: fotos, hallazgo, custodia y entrega. */
function DetalleObjeto({ objeto: o, lugar, almacen }: { objeto: ObjetoPerdido; lugar: string; almacen: string }) {
  const { t } = useTranslation()
  const fotos = fotosDe(o)
  const quien = hallazgoDe(o)
  const titulo = (texto: string) => (
    <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--at-ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '16px 0 4px' }}>{texto}</div>
  )
  return (
    <div>
      {fotos.length > 0 && <ImageGallery urls={fotos} maxVisible={MAX_FOTOS_OBJETO} />}

      {titulo(t('condominios.objetos.seccion_hallazgo'))}
      <Dato label={t('condominios.objetos.area_encontrado')}>{lugar || t('condominios.objetos.sin_dato')}</Dato>
      <Dato label={t('condominios.objetos.fecha')}>{o.fecha_encontrado}</Dato>
      <Dato label={t('condominios.objetos.encontrado_por')}>
        {quien
          ? <>{quien.nombre}{quien.tercero ? ` (${t('condominios.objetos.tercero_tag')})` : ''}{quien.contacto && <span style={{ display: 'block', fontSize: '12px', color: 'var(--at-ink-3)' }}>{quien.contacto}</span>}</>
          : t('condominios.objetos.sin_dato')}
      </Dato>

      {titulo(t('condominios.objetos.seccion_custodia'))}
      <Dato label={t('condominios.objetos.custodio_label')}>{o.custodio_nombre || t('condominios.objetos.sin_dato')}</Dato>
      <Dato label={t('condominios.objetos.almacenado_en')}>{almacen || t('condominios.objetos.sin_dato')}</Dato>
      {o.notas && <Dato label={t('condominios.comun.notes')}>{o.notas}</Dato>}

      {o.estado === 'reclamado' && (
        <>
          {titulo(t('condominios.objetos.seccion_entrega'))}
          <Dato label={t('condominios.objetos.recibio')}>{o.reclamado_por || t('condominios.objetos.sin_dato')}</Dato>
          {o.entrega_documento && <Dato label={t('condominios.objetos.documento')}>{o.entrega_documento}</Dato>}
          <Dato label={t('condominios.objetos.entregado_el')}>{o.entregado_en ? formatDateTime(o.entregado_en) : (o.fecha_reclamo || t('condominios.objetos.sin_dato'))}</Dato>
          {o.entregado_por_nombre && <Dato label={t('condominios.objetos.entregado_por')}>{o.entregado_por_nombre}</Dato>}
          {o.firma_entrega_path ? (
            <div style={{ marginTop: '12px' }}>
              <div style={{ fontSize: '12px', color: 'var(--at-ink-3)', marginBottom: '6px' }}>{t('condominios.objetos.firma_recibido')}</div>
              <SecureImage src={o.firma_entrega_path} alt={t('condominios.objetos.firma_recibido')}
                style={{ width: '100%', height: '110px', objectFit: 'contain', background: '#fff', borderRadius: '8px', border: '1px solid var(--at-line)', display: 'block' }} />
            </div>
          ) : (
            <div style={{ ...ayudaStyle, marginTop: '8px' }}>{t('condominios.objetos.entrega_sin_firma')}</div>
          )}
        </>
      )}
    </div>
  )
}
