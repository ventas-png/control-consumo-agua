import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ArticuloInventarioRenta, CategoriaInventarioRenta, EstadoArticuloRenta, PropiedadRenta } from '../../../types'
import {
  CATEGORIA_INVENTARIO_LABEL, CATEGORIAS_INVENTARIO, ESTADO_ARTICULO_LABEL, ESTADOS_ARTICULO,
  MAX_FOTOS_ARTICULO, fotosPorBorrar, mensajeErrorRentas, numeroONulo,
} from '../../../domain/rentas/logica'
import { retirarFotosInventario, useInventarioRentaMutations } from '../../../domain/rentas/mutations'
import { BUCKET_RENTAS_INVENTARIO } from '../../../domain/shared/buckets'
import { notify } from '../../shared/Dialog'
import { EditModal } from '../../shared/EditModal'
import { Button } from '../../shared/Button'
import { MultiImageUploader } from '../../shared/ImageUploader'
import { campo, etiqueta, rejilla, tenue } from '../ui'

interface Props {
  /** null = alta. */
  articulo: ArticuloInventarioRenta | null
  propiedades: PropiedadRenta[]
  /** Propiedad con la que abre un alta (la del filtro de la pestaña, o ''). */
  propiedadInicial: string
  companyId: string
  moneda: string
  hoy: string
  onClose: () => void
}

interface Form {
  propiedad_id: string; nombre: string; categoria: CategoriaInventarioRenta; ambiente: string
  cantidad: string; estado: EstadoArticuloRenta; valor_unitario: string; numero_serie: string
  fecha_revision: string; notas: string; fotos: string[]
}

const llenar: CSSProperties = { flex: '1 1 auto' }
const txt = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v))
const nulo = (v: string) => (v.trim() === '' ? null : v.trim())

function formDe(a: ArticuloInventarioRenta | null, propiedadId: string, hoy: string): Form {
  return {
    propiedad_id: a?.propiedad_id ?? propiedadId, nombre: a?.nombre ?? '', categoria: a?.categoria ?? 'mobiliario',
    ambiente: txt(a?.ambiente), cantidad: txt(a?.cantidad ?? 1), estado: a?.estado ?? 'bueno',
    valor_unitario: txt(a?.valor_unitario), numero_serie: txt(a?.numero_serie),
    fecha_revision: a ? txt(a.fecha_revision) : hoy, notas: txt(a?.notas), fotos: a?.fotos ?? [],
  }
}

/**
 * El siguiente artículo de una carga continua: se queda en la misma propiedad,
 * el mismo ambiente y la misma categoría (se recorre la casa cuarto por cuarto);
 * lo propio de cada artículo vuelve a empezar.
 */
function siguienteDe(f: Form, hoy: string): Form {
  return { ...formDe(null, f.propiedad_id, hoy), categoria: f.categoria, ambiente: f.ambiente, fecha_revision: f.fecha_revision }
}

export function ArticuloInventarioModal({ articulo, propiedades, propiedadInicial, companyId, moneda, hoy, onClose }: Props) {
  const esAlta = articulo === null
  const [form, setForm] = useState<Form>(() => formDe(articulo, propiedadInicial, hoy))
  /** Artículos dados de alta con «Guardar y agregar otro» desde que se abrió. */
  const [agregados, setAgregados] = useState<string[]>([])
  /** Subidas en curso: cuenta, no booleano, para que la primera que termina no habilite Guardar. */
  const [subiendo, setSubiendo] = useState(0)
  /** Cambia con cada artículo nuevo: el uploader vuelve a empezar (sin el error del anterior). */
  const [vuelta, setVuelta] = useState(0)
  const { crear, actualizar } = useInventarioRentaMutations(companyId)
  const guardando = crear.isPending || actualizar.isPending
  const nombreRef = useRef<HTMLInputElement>(null)

  // ── Fotos: qué se borra del bucket ──
  // El uploader no borra al quitar (borrarAlQuitar={false}): se decide al
  // terminar CADA artículo —guardado o descartado—, que es el único momento en
  // que se sabe qué quedó en la fila. Desmontar cubre cancelar, Esc, el fondo y
  // cambiar de pestaña.
  const sesionRef = useRef({ originales: articulo?.fotos ?? [], vistas: new Set<string>() })
  const montadoRef = useRef(false)
  /** Con el INSERT/UPDATE en vuelo no se sabe qué queda: la limpieza espera su resultado. */
  const guardandoRef = useRef(false)
  const cerrarSesionFotos = (guardadas: readonly string[] | null) => {
    const { originales, vistas } = sesionRef.current
    retirarFotosInventario(fotosPorBorrar(originales, vistas, guardadas))
    // Tras guardar, lo que sigue es otro artículo (o el modal se cierra): sus
    // originales son ninguna. Las del que se guardó ya no son de esta sesión.
    sesionRef.current = { originales: guardadas ? [] : originales, vistas: new Set() }
  }
  const cerrarSesionRef = useRef(cerrarSesionFotos)
  cerrarSesionRef.current = cerrarSesionFotos
  useEffect(() => {
    montadoRef.current = true
    return () => { montadoRef.current = false; if (!guardandoRef.current) cerrarSesionRef.current(null) }
  }, [])
  const cambiarFotos = (rutas: string[]) => {
    rutas.forEach(r => sesionRef.current.vistas.add(r))
    // Una subida que terminó con el modal ya cerrado: nadie la va a guardar.
    if (!montadoRef.current) { cerrarSesionRef.current(null); return }
    setForm(prev => ({ ...prev, fotos: rutas }))
  }

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(prev => ({ ...prev, [k]: v }))
  const ocupado = guardando || subiendo > 0
  const cerrar = () => { if (!guardando) onClose() }
  const nombrePropiedad = propiedades.find(p => p.id === form.propiedad_id)?.nombre

  const guardar = async (seguir: boolean) => {
    if (ocupado) return
    if (!form.propiedad_id) { notify({ variant: 'error', title: 'Elige la propiedad' }); return }
    if (!form.nombre.trim()) { notify({ variant: 'error', title: 'Falta el nombre del artículo' }); return }
    const cantidad = Number(form.cantidad)
    if (!Number.isInteger(cantidad) || cantidad < 0) { notify({ variant: 'error', title: 'La cantidad debe ser un número entero' }); return }
    const valor = numeroONulo(form.valor_unitario)
    if (valor === undefined) { notify({ variant: 'error', title: 'El valor debe ser un número positivo' }); return }
    const payload = {
      company_id: companyId, propiedad_id: form.propiedad_id, nombre: form.nombre.trim(), categoria: form.categoria,
      ambiente: nulo(form.ambiente), cantidad, estado: form.estado, valor_unitario: valor,
      numero_serie: nulo(form.numero_serie), fecha_revision: nulo(form.fecha_revision), notas: nulo(form.notas),
      fotos: form.fotos,
    }
    guardandoRef.current = true
    try {
      if (esAlta) await crear.mutateAsync(payload)
      else {
        const { company_id: _fija, ...patch } = payload
        await actualizar.mutateAsync({ id: articulo.id, patch })
      }
    } catch (e) {
      guardandoRef.current = false
      if (!montadoRef.current) cerrarSesionRef.current(null)
      notify({ variant: 'error', title: 'No se pudo guardar', text: mensajeErrorRentas(e, 'Intenta de nuevo.') })
      return
    }
    guardandoRef.current = false
    // La fila ya quedó: ahora sí se retira lo que no nombra (quitadas y descartadas).
    cerrarSesionRef.current(payload.fotos)
    if (!montadoRef.current) return
    if (seguir) {
      setAgregados(prev => [...prev, payload.nombre])
      setForm(prev => siguienteDe(prev, hoy))
      setVuelta(v => v + 1)
      nombreRef.current?.focus()
      notify({ variant: 'success', title: `«${payload.nombre}» agregado`, duration: 1200 })
      return
    }
    onClose()
    const total = agregados.length + 1
    notify({
      variant: 'success', duration: 1500,
      title: !esAlta ? 'Artículo actualizado' : total > 1 ? `${total} artículos registrados` : 'Artículo registrado',
    })
  }

  return (
    <EditModal
      title={esAlta ? 'Nuevo artículo' : `Editar ${articulo.nombre}`}
      onClose={cerrar} size="md" fullScreenOnMobile
      closeOnBackdropClick={!guardando} closeOnEscape={!guardando}
      footer={
        // En un teléfono los tres no caben en una fila: al envolver, cada fila se
        // llena (en escritorio caben y no hay espacio que repartir).
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 'var(--at-space-2)' }}>
          <Button variant="secondary" onClick={cerrar} disabled={guardando} style={llenar}>{agregados.length > 0 ? 'Terminar' : 'Cancelar'}</Button>
          {esAlta && (
            <Button variant="outline-primary" onClick={() => void guardar(true)} disabled={ocupado} style={llenar}
              title="Guarda este artículo y deja el formulario listo para el siguiente de la misma propiedad">
              Guardar y agregar otro
            </Button>
          )}
          <Button type="submit" form="rentas-articulo-form" loading={guardando} loadingText="Guardando..." disabled={subiendo > 0} style={llenar}>
            Guardar
          </Button>
        </div>
      }
    >
      <form id="rentas-articulo-form" onSubmit={e => { e.preventDefault(); void guardar(false) }}
        style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
        {agregados.length > 0 && (
          <div role="status" style={{
            padding: '0.6rem 0.8rem', borderRadius: 8, background: 'var(--at-success-tint)',
            border: '1px solid var(--at-success-border)', fontSize: 13,
          }}>
            <strong>✓ {agregados.length === 1 ? '1 artículo agregado' : `${agregados.length} artículos agregados`}
              {nombrePropiedad ? ` a ${nombrePropiedad}` : ''}:</strong>{' '}
            <span style={{ color: 'var(--at-ink-2)' }}>{agregados.join(', ')}</span>
          </div>
        )}
        <div>
          <label htmlFor="ri-propiedad" style={etiqueta}>Propiedad *</label>
          <select id="ri-propiedad" value={form.propiedad_id} onChange={e => set('propiedad_id', e.target.value)} style={campo}
            disabled={form.fotos.length > 0 || subiendo > 0} aria-describedby={form.fotos.length > 0 ? 'ri-propiedad-fija' : undefined}>
            <option value="">Elige una propiedad…</option>
            {propiedades.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
          {form.fotos.length > 0 && (
            <div id="ri-propiedad-fija" style={{ ...tenue, marginTop: 4 }}>
              Las fotos se guardan en la carpeta de esta propiedad: quítalas para cambiarla.
            </div>
          )}
        </div>
        {form.propiedad_id ? (
          <MultiImageUploader key={`${form.propiedad_id}-${vuelta}`}
            values={form.fotos} onChange={cambiarFotos}
            bucket={BUCKET_RENTAS_INVENTARIO} alcance={companyId} folder={form.propiedad_id}
            label="Fotos del artículo" maxFiles={MAX_FOTOS_ARTICULO} capture borrarAlQuitar={false}
            onSubiendo={s => setSubiendo(n => Math.max(0, n + (s ? 1 : -1)))} />
        ) : (
          <p style={{ ...tenue, margin: 0 }}>📷 Elige la propiedad para fotografiar el artículo.</p>
        )}
        <div style={rejilla(200)}>
          <div>
            <label htmlFor="ri-nombre" style={etiqueta}>Artículo *</label>
            <input id="ri-nombre" ref={nombreRef} type="text" value={form.nombre} onChange={e => set('nombre', e.target.value)} placeholder="Sofá 3 plazas" style={campo} maxLength={150} />
          </div>
          <div>
            <label htmlFor="ri-categoria" style={etiqueta}>Categoría</label>
            <select id="ri-categoria" value={form.categoria} onChange={e => set('categoria', e.target.value as CategoriaInventarioRenta)} style={campo}>
              {CATEGORIAS_INVENTARIO.map(c => <option key={c} value={c}>{CATEGORIA_INVENTARIO_LABEL[c]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ri-ambiente" style={etiqueta}>Ambiente</label>
            <input id="ri-ambiente" type="text" value={form.ambiente} onChange={e => set('ambiente', e.target.value)} placeholder="Sala, cocina, habitación 1…" style={campo} maxLength={80} />
          </div>
        </div>
        <div style={rejilla(140)}>
          <div>
            <label htmlFor="ri-cantidad" style={etiqueta}>Cantidad *</label>
            <input id="ri-cantidad" type="text" inputMode="numeric" value={form.cantidad} onChange={e => set('cantidad', e.target.value)} style={campo} />
          </div>
          <div>
            <label htmlFor="ri-valor" style={etiqueta}>Valor unitario ({moneda})</label>
            <input id="ri-valor" type="text" inputMode="decimal" value={form.valor_unitario} onChange={e => set('valor_unitario', e.target.value)} style={campo} />
          </div>
          <div>
            <label htmlFor="ri-estado" style={etiqueta}>Estado</label>
            <select id="ri-estado" value={form.estado} onChange={e => set('estado', e.target.value as EstadoArticuloRenta)} style={campo}>
              {ESTADOS_ARTICULO.map(e => <option key={e} value={e}>{ESTADO_ARTICULO_LABEL[e]}</option>)}
            </select>
          </div>
        </div>
        <div style={rejilla(180)}>
          <div>
            <label htmlFor="ri-serie" style={etiqueta}>Número de serie</label>
            <input id="ri-serie" type="text" value={form.numero_serie} onChange={e => set('numero_serie', e.target.value)} style={campo} maxLength={80} />
          </div>
          <div>
            <label htmlFor="ri-revision" style={etiqueta}>Última revisión</label>
            <input id="ri-revision" type="date" value={form.fecha_revision} onChange={e => set('fecha_revision', e.target.value)} style={campo} />
          </div>
        </div>
        <div>
          <label htmlFor="ri-notas" style={etiqueta}>Notas</label>
          <textarea id="ri-notas" value={form.notas} onChange={e => set('notas', e.target.value)} rows={3} style={campo} maxLength={1000} />
        </div>
      </form>
    </EditModal>
  )
}
