// Piezas compartidas por las dos caras del registro de mascotas y vehículos
// (20261031000500): el portal del residente (PortalMascotasTab /
// PortalVehiculosTab, que registra y muestra lo enviado) y el panel de la
// administración (MascotasTab / VehiculosTab, que lo evalúa). Viven aquí para que
// ambas rindan exactamente los mismos datos — igual que SolicitudRentaDetalle.
import { useRef, useState } from 'react'
import type {
  DocumentoPadron, EspecieMascota, EstadoPadron, Mascota, TipoTagVehiculo, VacunaMascota,
} from '../../types'
import { SecureFileLink } from '../shared/SecureFileLink'
import { fileIcon, nombreDeArchivo } from '../shared/FileUploader'
import { notify } from '../shared/Dialog'
import { uploadPadronDoc, removePadronDocs, BUCKET_PADRON_DOCS } from '../../domain/shared/storage'
import { validateFileMagic, buildUploadPath, resolveUploadContentType } from '../../lib/fileValidation'

// ── Estado ───────────────────────────────────────────────────────────────────

export const ESTADO_PADRON_CFG: Record<EstadoPadron, { label: string; color: string; bg: string; icon: string }> = {
  borrador:  { label: 'Borrador',     color: 'var(--at-ink-3)',   bg: 'var(--at-surface-2)',    icon: '📝' },
  pendiente: { label: 'En revisión',  color: 'var(--at-warning)', bg: 'var(--at-warning-tint)', icon: '⏳' },
  aprobada:  { label: 'Autorizado',   color: 'var(--at-success)', bg: 'var(--at-success-tint)', icon: '✅' },
  rechazada: { label: 'Rechazado',    color: 'var(--at-danger)',  bg: 'var(--at-danger-tint)',  icon: '❌' },
  // El residente lo retiró o lo dio de baja: no es una decisión del admin.
  baja:      { label: 'Dado de baja', color: 'var(--at-ink-3)',   bg: 'var(--at-surface-2)',    icon: '🚫' },
}

/** Filas sin `estado` (antes de la migración) se tratan como aprobadas. */
export function estadoDe(f: { estado?: EstadoPadron | null }): EstadoPadron {
  return f.estado ?? 'aprobada'
}

export function EstadoPadronBadge({ estado }: { estado: EstadoPadron }) {
  const cfg = ESTADO_PADRON_CFG[estado]
  return (
    <span style={{
      padding: '3px 10px', borderRadius: '20px', fontSize: '11.5px', fontWeight: 600,
      background: cfg.bg, color: cfg.color, whiteSpace: 'nowrap',
    }}>{cfg.icon} {cfg.label}</span>
  )
}

export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ── Catálogos ────────────────────────────────────────────────────────────────

export const ESPECIE_PADRON: Record<EspecieMascota, { icon: string; label: string }> = {
  perro: { icon: '🐕', label: 'Perro' },
  gato:  { icon: '🐈', label: 'Gato' },
  ave:   { icon: '🦜', label: 'Ave' },
  otro:  { icon: '🐾', label: 'Otro' },
}

const TAMANO_LABEL: Record<string, string> = { pequeno: 'Pequeño', mediano: 'Mediano', grande: 'Grande' }
const SEXO_LABEL: Record<string, string> = { macho: 'Macho', hembra: 'Hembra' }

export const TAG_TIPO_LABEL: Record<TipoTagVehiculo, string> = {
  sticker: 'Sticker / calcomanía',
  rfid:    'TAG RFID',
  tarjeta: 'Tarjeta de proximidad',
  control: 'Control remoto',
  otro:    'Otro',
}

// ── Lectura ──────────────────────────────────────────────────────────────────

function Dato({ label, valor }: { label: string; valor: string | null | undefined }) {
  if (!valor) return null
  return (
    <div>
      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--at-ink-3)' }}>{label}</div>
      <div style={{ fontSize: '13px', color: 'var(--at-ink)' }}>{valor}</div>
    </div>
  )
}

const cajaStyle: React.CSSProperties = {
  marginTop: '12px', background: 'var(--at-surface-2)', border: '1px solid var(--at-line)',
  borderRadius: '10px', padding: '12px 14px',
}
const tituloStyle: React.CSSProperties = { fontSize: '12.5px', fontWeight: 700, color: 'var(--at-ink-2)', marginBottom: '10px' }
const gridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px 16px' }

/** Ficha ampliada de la mascota (lo que el residente declaró). */
export function FichaMascotaDetalle({ mascota: m }: { mascota: Mascota }) {
  return (
    <div style={cajaStyle}>
      <div style={tituloStyle}>🐾 Ficha de la mascota</div>
      <div style={gridStyle}>
        <Dato label="Especie" valor={`${ESPECIE_PADRON[m.especie]?.icon ?? ''} ${ESPECIE_PADRON[m.especie]?.label ?? m.especie}`} />
        <Dato label="Raza" valor={m.raza} />
        <Dato label="Color" valor={m.color} />
        <Dato label="Sexo" valor={m.sexo ? SEXO_LABEL[m.sexo] : null} />
        <Dato label="Tamaño" valor={m.tamano ? TAMANO_LABEL[m.tamano] : null} />
        <Dato label="Peso" valor={m.peso_kg != null ? `${m.peso_kg} kg` : null} />
        <Dato label="Esterilizada" valor={m.esterilizada == null ? null : m.esterilizada ? 'Sí' : 'No'} />
        <Dato label="Microchip" valor={m.microchip} />
        <Dato label="Nacimiento" valor={m.fecha_nacimiento} />
        <Dato label="Última desparasitación" valor={m.fecha_ultima_desparasitacion} />
        <Dato label="Veterinario" valor={[m.veterinario, m.veterinario_telefono].filter(Boolean).join(' · ') || null} />
      </div>
      {m.notas && (
        <div style={{ marginTop: '10px', fontSize: '12.5px', color: 'var(--at-ink-2)', whiteSpace: 'pre-line' }}>
          <span style={{ fontWeight: 600 }}>Notas:</span> {m.notas}
        </div>
      )}
    </div>
  )
}

/** Esquema de vacunación declarado, con la próxima dosis vencida resaltada. */
export function VacunasDetalle({ vacunas, hoy }: { vacunas: VacunaMascota[] | null | undefined; hoy: string }) {
  const lista = Array.isArray(vacunas) ? vacunas : []
  if (lista.length === 0) return null
  return (
    <div style={cajaStyle}>
      <div style={tituloStyle}>💉 Vacunas ({lista.length})</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {lista.map((v, i) => {
          const vencida = !!v.proxima && v.proxima < hoy
          return (
            <div key={`${v.tipo}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', fontSize: '12.5px' }}>
              <span style={{ fontWeight: 600, color: 'var(--at-ink)' }}>{v.tipo}</span>
              <span style={{ color: 'var(--at-ink-3)' }}>
                Aplicada {v.fecha}
                {v.proxima && (
                  <span style={{ color: vencida ? 'var(--at-danger)' : 'var(--at-ink-3)', fontWeight: vencida ? 700 : 400 }}>
                    {' '}· próxima {v.proxima}{vencida ? ' (vencida)' : ''}
                  </span>
                )}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Adjuntos, cada uno como link firmado del bucket privado. */
export function DocumentosPadron({ documentos, titulo = '📎 Documentos anexos' }: {
  documentos: DocumentoPadron[] | null | undefined
  titulo?: string
}) {
  const lista = Array.isArray(documentos) ? documentos : []
  if (lista.length === 0) return null
  return (
    <div style={{ marginTop: '12px' }}>
      <div style={{ ...tituloStyle, marginBottom: '8px' }}>{titulo} ({lista.length})</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {lista.map(d => {
          const nombre = d.nombre || nombreDeArchivo(d.path)
          return (
            <SecureFileLink
              key={d.path}
              src={d.path}
              bucket={BUCKET_PADRON_DOCS}
              style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '8px 12px', background: 'var(--at-surface)',
                border: '1px solid var(--at-line)', borderRadius: '8px',
                textDecoration: 'none', color: 'inherit',
              }}
            >
              <span style={{ fontSize: '17px' }}>{fileIcon(nombre)}</span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--at-ink)' }}>
                  {d.etiqueta?.trim() || nombre}
                </span>
                {d.etiqueta?.trim() && (
                  <span style={{ display: 'block', fontSize: '11.5px', color: 'var(--at-ink-3)' }}>{nombre}</span>
                )}
              </span>
            </SecureFileLink>
          )
        })}
      </div>
    </div>
  )
}

/** Resolución de la administración (o la baja del residente). */
export function ResolucionPadron({ fila }: {
  fila: { estado?: EstadoPadron | null; comentario_admin?: string | null; resuelto_por?: string | null; fecha_resolucion?: string | null }
}) {
  const estado = estadoDe(fila)
  if (!fila.comentario_admin && !(estado === 'aprobada' && fila.resuelto_por)) return null
  const cfg = ESTADO_PADRON_CFG[estado]
  return (
    <div style={{ marginTop: '10px', background: cfg.bg, borderRadius: '8px', padding: '10px 12px', fontSize: '13px', color: cfg.color }}>
      <strong>{estado === 'rechazada' ? 'Motivo del rechazo:' : 'Resolución:'}</strong>{' '}
      {fila.comentario_admin ?? 'Autorizado.'}
      {fila.resuelto_por && <span style={{ marginLeft: '8px', opacity: 0.8 }}>— {fila.resuelto_por}{fila.fecha_resolucion ? `, ${fechaCorta(fila.fecha_resolucion)}` : ''}</span>}
    </div>
  )
}

// ── Escritura: adjuntos del borrador ─────────────────────────────────────────

// Topes: espejan el CHECK de documentos (≤ 8) y el bucket `padron-docs` (10 MiB).
export const MAX_DOCS_PADRON = 8
const MAX_DOC_BYTES = 10 * 1024 * 1024
const ACCEPT_DOCS = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg', 'image/png', 'image/webp',
].join(',')

/**
 * Lista editable de adjuntos de un borrador. Cada archivo se sube al elegirlo
 * (no al enviar) porque la policy de `padron-docs` solo autoriza escrituras
 * mientras la fila sigue en borrador; al enviar quedan inmutables.
 */
export function AdjuntosBorrador({ carpeta, docs, onChange, ayuda, placeholderEtiqueta, onSubiendo }: {
  /** `{unidad}/{mascotas|vehiculos}/{fila}`; null mientras se reserva el borrador. */
  carpeta: string | null
  docs: DocumentoPadron[]
  onChange: (docs: DocumentoPadron[] | ((prev: DocumentoPadron[]) => DocumentoPadron[])) => void
  ayuda: string
  placeholderEtiqueta: string
  onSubiendo?: (subiendo: boolean) => void
}) {
  const [subiendo, setSubiendo] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function marcar(v: boolean) { setSubiendo(v); onSubiendo?.(v) }

  async function agregar(files: FileList | null) {
    if (!files || files.length === 0) return
    if (!carpeta) { notify({ variant: 'error', title: 'Error', text: 'Todavía se está preparando el registro. Intentá de nuevo en un momento.' }); return }
    if (fileRef.current) fileRef.current.value = ''

    // Cupo calculado ANTES del ciclo: `docs` no se actualiza mientras subimos.
    const disponibles = MAX_DOCS_PADRON - docs.length
    if (disponibles <= 0) {
      notify({ variant: 'warning', title: 'Máximo alcanzado', text: `Puedes anexar hasta ${MAX_DOCS_PADRON} documentos.` })
      return
    }
    const todos = Array.from(files)
    const elegidos = todos.slice(0, disponibles)
    if (todos.length > elegidos.length) {
      notify({ variant: 'warning', title: 'Máximo alcanzado', text: `Se tomarán ${elegidos.length} de los ${todos.length} archivos seleccionados.` })
    }

    marcar(true)
    for (const file of elegidos) {
      if (file.size > MAX_DOC_BYTES) {
        notify({ variant: 'error', title: 'Archivo muy grande', text: `${file.name} excede el límite de 10 MB.` })
        continue
      }
      const magic = await validateFileMagic(file, 'document')
      if (!magic.ok) { notify({ variant: 'error', title: 'Error', text: `${file.name}: ${magic.reason}` }); continue }
      const contentType = resolveUploadContentType(magic.detected, file.name)
      const path = buildUploadPath(carpeta, file.name)
      const { error } = await uploadPadronDoc(path, file, { contentType })
      if (error) { notify({ variant: 'error', title: 'Error', text: `No se pudo subir ${file.name}: ${error}` }); continue }
      onChange(prev => [...prev, { path, nombre: file.name, etiqueta: null, mime: contentType, size: file.size }])
    }
    marcar(false)
  }

  async function quitar(path: string) {
    await removePadronDocs([path])
    onChange(prev => prev.filter(d => d.path !== path))
  }

  const fieldStyle: React.CSSProperties = {
    padding: '7px 10px', fontSize: '12.5px', border: '1.5px solid var(--at-line)',
    borderRadius: '8px', outline: 'none', boxSizing: 'border-box', flex: '1 1 180px',
  }

  return (
    <div style={{ border: '1.5px solid var(--at-line)', borderRadius: '12px', padding: '16px', marginBottom: '18px' }}>
      <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)', marginBottom: '2px' }}>📎 Documentos para la administración</div>
      <div style={{ fontSize: '12.5px', color: 'var(--at-ink-3)', marginBottom: '12px' }}>
        {ayuda} Hasta {MAX_DOCS_PADRON} archivos PDF, Word o imagen de 10 MB cada uno.
        Una vez enviada la solicitud ya no podrás cambiarlos.
      </div>

      {docs.map(d => (
        <div key={d.path} style={{
          display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
          padding: '10px 12px', marginBottom: '8px',
          background: 'var(--at-surface-2)', border: '1px solid var(--at-line)', borderRadius: '8px',
        }}>
          <span style={{ fontSize: '17px' }}>{fileIcon(d.nombre)}</span>
          <div style={{ flex: '1 1 160px', minWidth: 0 }}>
            <div style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--at-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.nombre}</div>
            <div style={{ fontSize: '11px', color: 'var(--at-ink-3)' }}>{d.size != null ? `${(d.size / 1024).toFixed(0)} KB` : 'Subido'}</div>
          </div>
          <input
            style={fieldStyle}
            value={d.etiqueta ?? ''}
            onChange={e => onChange(prev => prev.map(x => x.path === d.path ? { ...x, etiqueta: e.target.value } : x))}
            placeholder={placeholderEtiqueta}
            aria-label={`Etiqueta de ${d.nombre}`}
          />
          <button
            type="button"
            onClick={() => quitar(d.path)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', padding: '4px', color: 'var(--at-danger)' }}
            title="Quitar"
            aria-label={`Quitar ${d.nombre}`}
          >🗑️</button>
        </div>
      ))}

      <input
        ref={fileRef}
        type="file"
        multiple
        accept={ACCEPT_DOCS}
        onChange={e => agregar(e.target.files)}
        style={{ display: 'none' }}
        data-testid="adjuntos-input"
      />
      {docs.length < MAX_DOCS_PADRON && (
        <button
          type="button"
          disabled={subiendo || !carpeta}
          onClick={() => fileRef.current?.click()}
          style={{
            padding: '8px 16px', background: 'var(--at-chip)', color: 'var(--at-ink-2)',
            border: '1.5px dashed var(--at-line)', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
            cursor: subiendo || !carpeta ? 'not-allowed' : 'pointer', opacity: subiendo || !carpeta ? 0.6 : 1,
          }}
        >{subiendo ? 'Subiendo…' : '+ Agregar documento'}</button>
      )}
    </div>
  )
}
