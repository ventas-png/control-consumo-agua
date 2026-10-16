// Portal del residente · Mascotas (20261031000500).
//
// El residente registra a su mascota con la ficha completa (vacunas, foto,
// carnet…) y solicita autorización a la administración — mismo circuito que la
// solicitud de renta: borrador → enviar (pendiente) → aprobada / rechazada, y
// después puede retirarla o darla de baja. Toda escritura va por RPC
// (domain/portal/padron); la tabla no se toca directo.
import { useCallback, useEffect, useState } from 'react'
import { confirm, notify } from '../../shared/Dialog'
import { ImageUploader } from '../../shared/ImageUploader'
import { SecureImage } from '../../shared/SecureImage'
import { hoyLocalISO } from '../../../lib/format'
import {
  carpetaPadron, darDeBajaPadron, descartarPadron, enviarMascota, fetchMascotasUnidad, reservarPadron,
} from '../../../domain/portal/padron'
import { removePadronDocs } from '../../../domain/shared/storage'
import {
  AdjuntosBorrador, DocumentosPadron, ESPECIE_PADRON, EstadoPadronBadge, FichaMascotaDetalle,
  ResolucionPadron, VacunasDetalle, estadoDe, fechaCorta,
} from '../PadronComun'
import {
  VACUNAS_POR_ESPECIE, armarVacunas, exigeVacunas, type VacunaMarcada, type VacunaOtra,
} from '../../../lib/padronMascotas'
import type {
  DocumentoPadron, EspecieMascota, Mascota, SexoMascota, TamanoMascota,
} from '../../../types'

interface Props {
  unidadId: string
  unidadNombre: string
  clienteId: string
  /** El propietario puede retirar o dar de baja lo que registró su inquilino. */
  esPropietario: boolean
}

const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', fontSize: '13.5px',
  border: '1.5px solid var(--at-line)', borderRadius: '8px', outline: 'none',
  boxSizing: 'border-box', background: 'var(--at-surface)',
}
const labelStyle: React.CSSProperties = { fontSize: '12px', fontWeight: 600, color: 'var(--at-ink-2)', marginBottom: '4px', display: 'block' }
const gridStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px', marginBottom: '12px' }
const seccionStyle: React.CSSProperties = {
  border: '1.5px solid var(--at-line)', borderRadius: '12px',
  padding: '16px', marginBottom: '18px', background: 'var(--at-surface-2)',
}

interface FichaForm {
  nombre: string
  especie: EspecieMascota
  raza: string
  color: string
  sexo: '' | SexoMascota
  tamano: '' | TamanoMascota
  peso_kg: string
  esterilizada: '' | 'si' | 'no'
  microchip: string
  fecha_nacimiento: string
  fecha_ultima_desparasitacion: string
  veterinario: string
  veterinario_telefono: string
  notas: string
}

const blankFicha = (): FichaForm => ({
  nombre: '', especie: 'perro', raza: '', color: '', sexo: '', tamano: '', peso_kg: '',
  esterilizada: '', microchip: '', fecha_nacimiento: '', fecha_ultima_desparasitacion: '',
  veterinario: '', veterinario_telefono: '', notas: '',
})

function MascotaForm({ unidadId, borradorId, onCerrar, onEnviada }: {
  unidadId: string
  borradorId: string | null
  onCerrar: () => void
  onEnviada: () => void
}) {
  const hoy = hoyLocalISO()
  const [id, setId]               = useState<string | null>(borradorId)
  const [errorReserva, setErrorReserva] = useState<string | null>(null)
  const [ficha, setFicha]         = useState<FichaForm>(blankFicha())
  const [fotoUrl, setFotoUrl]     = useState<string | null>(null)
  const [marcadas, setMarcadas]   = useState<Record<string, VacunaMarcada>>({})
  const [otras, setOtras]         = useState<VacunaOtra[]>([])
  const [docs, setDocs]           = useState<DocumentoPadron[]>([])
  const [subiendo, setSubiendo]   = useState(false)
  const [saving, setSaving]       = useState(false)

  // El id del borrador es la carpeta de los adjuntos: se reserva al abrir.
  useEffect(() => {
    let vigente = true
    if (id) return
    reservarPadron('mascota', unidadId).then(({ id: nuevo, error }) => {
      if (!vigente) return
      if (error) { setErrorReserva(error); return }
      setId(nuevo)
    })
    return () => { vigente = false }
  }, [unidadId, id])

  function setF<K extends keyof FichaForm>(k: K, v: FichaForm[K]) { setFicha(p => ({ ...p, [k]: v })) }

  function cambiarEspecie(e: EspecieMascota) {
    setF('especie', e)
    // Las marcas del catálogo anterior no aplican a la nueva especie.
    setMarcadas({})
  }

  function toggleVacuna(tipo: string) {
    setMarcadas(p => {
      const n = { ...p }
      if (n[tipo]) delete n[tipo]; else n[tipo] = { fecha: '', proxima: '' }
      return n
    })
  }

  async function enviar() {
    if (!id) { notify({ variant: 'error', title: 'Error', text: 'El registro no está listo todavía.' }); return }
    if (!ficha.nombre.trim()) { notify({ variant: 'error', title: 'Falta un dato', text: 'El nombre de la mascota es requerido.' }); return }
    if (ficha.fecha_nacimiento && ficha.fecha_nacimiento > hoy) { notify({ variant: 'error', title: 'Fecha inválida', text: 'La fecha de nacimiento no puede ser futura.' }); return }
    if (ficha.peso_kg && !(Number(ficha.peso_kg) > 0)) { notify({ variant: 'error', title: 'Peso inválido', text: 'Ingresa el peso en kilogramos.' }); return }
    const { vacunas, error: errVac } = armarVacunas(ficha.especie, marcadas, otras, hoy)
    if (errVac) { notify({ variant: 'error', title: 'Vacunas', text: errVac }); return }

    setSaving(true)
    const { error } = await enviarMascota(id, {
      nombre: ficha.nombre.trim(),
      especie: ficha.especie,
      raza: ficha.raza.trim() || null,
      color: ficha.color.trim() || null,
      sexo: ficha.sexo || null,
      tamano: ficha.tamano || null,
      peso_kg: ficha.peso_kg ? Number(ficha.peso_kg) : null,
      esterilizada: ficha.esterilizada === '' ? null : ficha.esterilizada === 'si',
      microchip: ficha.microchip.trim() || null,
      fecha_nacimiento: ficha.fecha_nacimiento || null,
      fecha_ultima_desparasitacion: ficha.fecha_ultima_desparasitacion || null,
      veterinario: ficha.veterinario.trim() || null,
      veterinario_telefono: ficha.veterinario_telefono.trim() || null,
      foto_url: fotoUrl,
      notas: ficha.notas.trim() || null,
      vacunas,
    }, docs.map(({ path, nombre, etiqueta, mime, size }) => ({ path, nombre, etiqueta: etiqueta?.trim() || null, mime, size })))
    setSaving(false)
    if (error) { notify({ variant: 'error', title: 'No se pudo enviar', text: error }); return }
    notify({ variant: 'success', title: '¡Solicitud enviada!', text: 'La administración revisará el registro de tu mascota.', duration: 2200 })
    onEnviada()
  }

  async function descartar() {
    const r = await confirm({ title: '¿Descartar este registro?', text: 'Se borrarán los datos y documentos que cargaste.', icon: 'warning', variant: 'danger', confirmText: 'Descartar' })
    if (!r.isConfirmed) return
    if (docs.length > 0) await removePadronDocs(docs.map(d => d.path))
    if (id) {
      const { error } = await descartarPadron('mascota', id)
      if (error) { notify({ variant: 'error', title: 'Error', text: error }); return }
    }
    onEnviada()
  }

  const catalogo = VACUNAS_POR_ESPECIE[ficha.especie]
  const bloqueado = saving || subiendo || !id

  return (
    <div style={{ maxWidth: '680px' }}>
      <div style={{ marginBottom: '16px' }}>
        <h3 style={{ margin: '0 0 6px', fontSize: '17px', fontWeight: 700, color: 'var(--at-ink)' }}>🐾 Registrar mascota</h3>
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--at-ink-3)' }}>
          Completa la ficha de tu mascota y solicita la autorización de la administración para tenerla en tu unidad.
        </p>
      </div>

      {errorReserva && (
        <div role="alert" style={{ background: 'var(--at-danger-tint)', border: '1px solid var(--at-danger-border)', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', fontSize: '13px', color: 'var(--at-danger)' }}>
          No se pudo preparar el registro: {errorReserva}
        </div>
      )}

      <div style={seccionStyle}>
        <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)', marginBottom: '12px' }}>📋 Datos de la mascota</div>
        <div style={gridStyle}>
          <div>
            <label style={labelStyle} htmlFor="pm-nombre">Nombre *</label>
            <input id="pm-nombre" style={fieldStyle} value={ficha.nombre} onChange={e => setF('nombre', e.target.value)} placeholder="Nombre de la mascota" />
          </div>
          <div>
            <label style={labelStyle} htmlFor="pm-especie">Especie *</label>
            <select id="pm-especie" style={{ ...fieldStyle, cursor: 'pointer' }} value={ficha.especie} onChange={e => cambiarEspecie(e.target.value as EspecieMascota)}>
              {(Object.keys(ESPECIE_PADRON) as EspecieMascota[]).map(e => (
                <option key={e} value={e}>{ESPECIE_PADRON[e].icon} {ESPECIE_PADRON[e].label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle} htmlFor="pm-raza">Raza</label>
            <input id="pm-raza" style={fieldStyle} value={ficha.raza} onChange={e => setF('raza', e.target.value)} placeholder="Ej. Labrador" />
          </div>
          <div>
            <label style={labelStyle} htmlFor="pm-color">Color</label>
            <input id="pm-color" style={fieldStyle} value={ficha.color} onChange={e => setF('color', e.target.value)} placeholder="Ej. Café" />
          </div>
          <div>
            <label style={labelStyle} htmlFor="pm-sexo">Sexo</label>
            <select id="pm-sexo" style={{ ...fieldStyle, cursor: 'pointer' }} value={ficha.sexo} onChange={e => setF('sexo', e.target.value as FichaForm['sexo'])}>
              <option value="">—</option>
              <option value="macho">Macho</option>
              <option value="hembra">Hembra</option>
            </select>
          </div>
          <div>
            <label style={labelStyle} htmlFor="pm-tamano">Tamaño</label>
            <select id="pm-tamano" style={{ ...fieldStyle, cursor: 'pointer' }} value={ficha.tamano} onChange={e => setF('tamano', e.target.value as FichaForm['tamano'])}>
              <option value="">—</option>
              <option value="pequeno">Pequeño (hasta 10 kg)</option>
              <option value="mediano">Mediano (10 a 25 kg)</option>
              <option value="grande">Grande (más de 25 kg)</option>
            </select>
          </div>
          <div>
            <label style={labelStyle} htmlFor="pm-peso">Peso (kg)</label>
            <input id="pm-peso" style={fieldStyle} type="number" min={0} step="0.1" value={ficha.peso_kg} onChange={e => setF('peso_kg', e.target.value)} placeholder="0.0" />
          </div>
          <div>
            <label style={labelStyle} htmlFor="pm-nac">Fecha de nacimiento</label>
            <input id="pm-nac" style={fieldStyle} type="date" max={hoy} value={ficha.fecha_nacimiento} onChange={e => setF('fecha_nacimiento', e.target.value)} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="pm-ester">¿Esterilizada?</label>
            <select id="pm-ester" style={{ ...fieldStyle, cursor: 'pointer' }} value={ficha.esterilizada} onChange={e => setF('esterilizada', e.target.value as FichaForm['esterilizada'])}>
              <option value="">—</option>
              <option value="si">Sí</option>
              <option value="no">No</option>
            </select>
          </div>
          <div>
            <label style={labelStyle} htmlFor="pm-chip">Microchip</label>
            <input id="pm-chip" style={fieldStyle} value={ficha.microchip} onChange={e => setF('microchip', e.target.value)} placeholder="Número (si tiene)" />
          </div>
        </div>
        <div style={{ maxWidth: '320px' }}>
          <ImageUploader value={fotoUrl} onChange={setFotoUrl} folder="mascotas" label="Foto de la mascota" />
        </div>
      </div>

      <div style={seccionStyle}>
        <div style={{ fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)', marginBottom: '2px' }}>💉 Vacunas</div>
        <div style={{ fontSize: '12.5px', color: 'var(--at-ink-3)', marginBottom: '12px' }}>
          Marca las vacunas que tiene tu mascota e indica cuándo se aplicaron.
          {exigeVacunas(ficha.especie) ? ' Para perros y gatos se requiere al menos una.' : ''}
        </div>

        {catalogo.map(tipo => {
          const m = marcadas[tipo]
          return (
            <div key={tipo} style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', padding: '8px 0', borderBottom: '1px solid var(--at-line)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '1 1 220px', cursor: 'pointer', fontSize: '13px', color: 'var(--at-ink-2)' }}>
                <input type="checkbox" checked={!!m} onChange={() => toggleVacuna(tipo)} style={{ width: '16px', height: '16px', accentColor: 'var(--at-accent-hover)' }} />
                {tipo}
              </label>
              {m && (
                <>
                  <input type="date" max={hoy} aria-label={`Fecha de aplicación de ${tipo}`} style={{ ...fieldStyle, width: 'auto', flex: '0 1 160px', padding: '6px 10px' }}
                    value={m.fecha} onChange={e => setMarcadas(p => ({ ...p, [tipo]: { ...p[tipo], fecha: e.target.value } }))} />
                  <input type="date" aria-label={`Próxima dosis de ${tipo}`} title="Próxima dosis (opcional)" style={{ ...fieldStyle, width: 'auto', flex: '0 1 160px', padding: '6px 10px' }}
                    value={m.proxima} onChange={e => setMarcadas(p => ({ ...p, [tipo]: { ...p[tipo], proxima: e.target.value } }))} />
                </>
              )}
            </div>
          )
        })}
        {catalogo.length > 0 && (
          <div style={{ fontSize: '11.5px', color: 'var(--at-ink-3)', margin: '6px 0 10px' }}>
            Primera fecha: aplicada · segunda fecha: próxima dosis (opcional).
          </div>
        )}

        {otras.map((o, i) => (
          <div key={i} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
            <input style={{ ...fieldStyle, flex: '1 1 200px', width: 'auto' }} aria-label={`Nombre de la vacuna adicional ${i + 1}`} placeholder="Nombre de la vacuna"
              value={o.tipo} onChange={e => setOtras(p => p.map((x, j) => j === i ? { ...x, tipo: e.target.value } : x))} />
            <input type="date" max={hoy} aria-label={`Fecha de aplicación de la vacuna adicional ${i + 1}`} style={{ ...fieldStyle, flex: '0 1 160px', width: 'auto' }}
              value={o.fecha} onChange={e => setOtras(p => p.map((x, j) => j === i ? { ...x, fecha: e.target.value } : x))} />
            <input type="date" aria-label={`Próxima dosis de la vacuna adicional ${i + 1}`} style={{ ...fieldStyle, flex: '0 1 160px', width: 'auto' }}
              value={o.proxima} onChange={e => setOtras(p => p.map((x, j) => j === i ? { ...x, proxima: e.target.value } : x))} />
            <button type="button" onClick={() => setOtras(p => p.filter((_, j) => j !== i))} aria-label={`Quitar vacuna adicional ${i + 1}`}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--at-danger)', fontSize: '15px' }}>🗑️</button>
          </div>
        ))}
        <button type="button" onClick={() => setOtras(p => [...p, { tipo: '', fecha: '', proxima: '' }])}
          style={{ padding: '6px 14px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: '1.5px dashed var(--at-line)', borderRadius: '8px', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' }}>
          + Agregar otra vacuna
        </button>

        <div style={{ ...gridStyle, marginTop: '14px', marginBottom: 0 }}>
          <div>
            <label style={labelStyle} htmlFor="pm-desp">Última desparasitación</label>
            <input id="pm-desp" style={fieldStyle} type="date" max={hoy} value={ficha.fecha_ultima_desparasitacion} onChange={e => setF('fecha_ultima_desparasitacion', e.target.value)} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="pm-vet">Veterinario</label>
            <input id="pm-vet" style={fieldStyle} value={ficha.veterinario} onChange={e => setF('veterinario', e.target.value)} placeholder="Clínica o médico" />
          </div>
          <div>
            <label style={labelStyle} htmlFor="pm-vet-tel">Teléfono del veterinario</label>
            <input id="pm-vet-tel" style={fieldStyle} value={ficha.veterinario_telefono} onChange={e => setF('veterinario_telefono', e.target.value)} placeholder="+502…" />
          </div>
        </div>
      </div>

      <div style={{ marginBottom: '18px' }}>
        <label style={labelStyle} htmlFor="pm-notas">Notas para la administración</label>
        <textarea id="pm-notas" style={{ ...fieldStyle, minHeight: '70px', resize: 'vertical' }} value={ficha.notas} onChange={e => setF('notas', e.target.value)}
          placeholder="Comportamiento, cuidados especiales, horario de paseo…" />
      </div>

      <AdjuntosBorrador
        carpeta={id ? carpetaPadron('mascota', unidadId, id) : null}
        docs={docs}
        onChange={setDocs}
        onSubiendo={setSubiendo}
        ayuda="Anexa el carnet de vacunación y cualquier respaldo que la administración necesite (certificado veterinario, registro de raza…)."
        placeholderEtiqueta="Etiqueta (ej. Carnet de vacunación)"
      />

      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <button onClick={enviar} disabled={bloqueado} style={{
          padding: '10px 24px', background: 'var(--at-accent-hover)', color: 'white', border: 'none', borderRadius: '9px',
          fontWeight: 600, fontSize: '14px', cursor: bloqueado ? 'not-allowed' : 'pointer', opacity: bloqueado ? 0.7 : 1,
        }}>{saving ? 'Enviando…' : 'Enviar solicitud'}</button>
        <button onClick={onCerrar} disabled={saving} style={{ padding: '10px 18px', background: 'var(--at-chip)', color: 'var(--at-ink-2)', border: 'none', borderRadius: '9px', fontSize: '13.5px', cursor: 'pointer' }}>
          Cerrar
        </button>
        {id && (
          <button onClick={descartar} disabled={saving} style={{ padding: '10px 18px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)', border: 'none', borderRadius: '9px', fontSize: '13.5px', fontWeight: 600, cursor: 'pointer' }}>
            Descartar registro
          </button>
        )}
      </div>
    </div>
  )
}

export function PortalMascotasTab({ unidadId, unidadNombre, clienteId, esPropietario }: Props) {
  const hoy = hoyLocalISO()
  const [mascotas, setMascotas] = useState<Mascota[]>([])
  const [loading, setLoading]   = useState(true)
  const [formAbierto, setFormAbierto] = useState(false)
  const [expandida, setExpandida] = useState<string | null>(null)
  const [procesando, setProcesando] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setLoading(true)
    const { data, error } = await fetchMascotasUnidad(unidadId)
    setLoading(false)
    if (error) { notify({ variant: 'error', title: 'Error', text: error }); return }
    setMascotas(data)
  }, [unidadId])

  useEffect(() => { setFormAbierto(false); cargar() }, [cargar])

  // El borrador propio se retoma en el formulario; los ajenos no se muestran.
  const borrador = mascotas.find(m => estadoDe(m) === 'borrador' && m.cliente_id === clienteId) ?? null
  const visibles = mascotas.filter(m => estadoDe(m) !== 'borrador')
  const pendientes = visibles.filter(m => estadoDe(m) === 'pendiente').length
  const autorizadas = visibles.filter(m => estadoDe(m) === 'aprobada' && m.activo).length

  async function retirar(m: Mascota) {
    const pendiente = estadoDe(m) === 'pendiente'
    const r = await confirm({
      title: pendiente ? `¿Retirar la solicitud de ${m.nombre}?` : `¿Dar de baja a ${m.nombre}?`,
      text: pendiente
        ? 'La solicitud dejará de estar en revisión. Podrás registrarla de nuevo cuando quieras.'
        : 'La mascota dejará de figurar como autorizada en tu unidad (por ejemplo, si ya no vive contigo).',
      icon: 'warning', variant: 'danger',
      confirmText: pendiente ? 'Retirar solicitud' : 'Dar de baja',
    })
    if (!r.isConfirmed) return
    setProcesando(m.id)
    const { error } = await darDeBajaPadron('mascota', m.id)
    setProcesando(null)
    if (error) { notify({ variant: 'error', title: 'Error', text: error }); return }
    notify({ variant: 'success', title: pendiente ? 'Solicitud retirada' : 'Mascota dada de baja', duration: 1800 })
    cargar()
  }

  if (formAbierto) {
    return (
      <MascotaForm
        key={borrador?.id ?? 'nuevo'}
        unidadId={unidadId}
        borradorId={borrador?.id ?? null}
        onCerrar={() => { setFormAbierto(false); cargar() }}
        onEnviada={() => { setFormAbierto(false); cargar() }}
      />
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap', marginBottom: '18px' }}>
        <div>
          <h3 style={{ margin: '0 0 4px', fontSize: '17px', fontWeight: 700, color: 'var(--at-ink)' }}>🐾 Mascotas — {unidadNombre}</h3>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--at-ink-3)' }}>
            Registra a tus mascotas y solicita la autorización de la administración para tenerlas en el condominio.
          </p>
        </div>
        <button onClick={() => setFormAbierto(true)} style={{
          padding: '9px 18px', background: 'var(--at-accent-hover)', color: 'white', border: 'none',
          borderRadius: '9px', fontWeight: 600, fontSize: '13.5px', cursor: 'pointer',
        }}>{borrador ? '📝 Continuar registro' : '+ Registrar mascota'}</button>
      </div>

      {!loading && visibles.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px', fontSize: '12.5px', color: 'var(--at-ink-3)' }}>
          <span>✅ {autorizadas} autorizada{autorizadas === 1 ? '' : 's'}</span>
          {pendientes > 0 && <span>· ⏳ {pendientes} en revisión</span>}
        </div>
      )}

      {loading ? (
        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--at-ink-3)', fontSize: '13px' }}>Cargando…</div>
      ) : visibles.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--at-ink-3)' }}>
          <div style={{ fontSize: '42px', marginBottom: '10px' }}>🐾</div>
          <div style={{ fontWeight: 700, fontSize: '15px', marginBottom: '6px' }}>Sin mascotas registradas</div>
          <div style={{ fontSize: '13px' }}>Si tienes una mascota en tu unidad, regístrala para que la administración la autorice.</div>
        </div>
      ) : visibles.map(m => {
        const estado = estadoDe(m)
        const abierta = expandida === m.id
        const puedeRetirar = (estado === 'pendiente' || estado === 'aprobada') && (m.cliente_id === clienteId || esPropietario)
        return (
          <div key={m.id} style={{
            border: `1.5px solid ${abierta ? 'var(--at-accent-soft)' : 'var(--at-line)'}`, borderRadius: '12px',
            marginBottom: '10px', background: abierta ? 'var(--at-surface-2)' : 'var(--at-surface)',
          }}>
            <button
              type="button"
              onClick={() => setExpandida(abierta ? null : m.id)}
              aria-expanded={abierta}
              style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', flexWrap: 'wrap' }}
            >
              {m.foto_url
                ? <SecureImage src={m.foto_url} alt={m.nombre} style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                : <span style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--at-chip)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', flexShrink: 0 }}>{ESPECIE_PADRON[m.especie]?.icon ?? '🐾'}</span>}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 700, fontSize: '14px', color: 'var(--at-ink)' }}>{m.nombre}</span>
                <span style={{ display: 'block', fontSize: '12.5px', color: 'var(--at-ink-3)' }}>
                  {ESPECIE_PADRON[m.especie]?.label ?? m.especie}{m.raza ? ` · ${m.raza}` : ''}
                  {m.fecha_solicitud ? ` · enviada ${fechaCorta(m.fecha_solicitud)}` : ''}
                </span>
              </span>
              <EstadoPadronBadge estado={estado} />
              <span aria-hidden style={{ color: 'var(--at-ink-3)' }}>{abierta ? '▲' : '▼'}</span>
            </button>

            {abierta && (
              <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--at-line)' }}>
                {estado === 'pendiente' && (
                  <div style={{ marginTop: '12px', fontSize: '13px', color: 'var(--at-warning-strong)' }}>
                    ⏳ La administración está revisando la solicitud. Te avisaremos cuando haya una respuesta.
                  </div>
                )}
                <ResolucionPadron fila={m} />
                <FichaMascotaDetalle mascota={m} />
                <VacunasDetalle vacunas={m.vacunas} hoy={hoy} />
                <DocumentosPadron documentos={m.documentos} titulo="📎 Documentos enviados" />
                {puedeRetirar && (
                  <button
                    onClick={() => retirar(m)}
                    disabled={procesando === m.id}
                    style={{
                      marginTop: '14px', padding: '7px 16px', background: 'var(--at-danger-tint)', color: 'var(--at-danger)',
                      border: '1px solid var(--at-danger-border)', borderRadius: '8px', fontSize: '12.5px', fontWeight: 600,
                      cursor: procesando === m.id ? 'default' : 'pointer', opacity: procesando === m.id ? 0.6 : 1,
                    }}
                  >{estado === 'pendiente' ? 'Retirar solicitud' : 'Dar de baja'}</button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
