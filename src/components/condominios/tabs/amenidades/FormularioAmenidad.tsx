// El formulario de una amenidad, UNA sola vez: lo usan «Nueva amenidad» y
// «Editar amenidad» dentro de una ventana (EditModal). Antes cada uno tenía su
// copia inline encima de la lista y había que hacer scroll para ver las
// tarjetas o el formulario.
import { useId, type CSSProperties, type Dispatch, type SetStateAction } from 'react'
import type { ItemInventario, PrestamoEquipo } from '../../../../types'
import type { AmenidadFormState } from './ctx'
import { ImageUploader } from '../../../shared/ImageUploader'
import { SelectorEquiposAmenidad } from './SelectorEquiposAmenidad'

interface Props {
  form: AmenidadFormState
  setForm: Dispatch<SetStateAction<AmenidadFormState>>
  fotoUrl: string | null
  setFotoUrl: Dispatch<SetStateAction<string | null>>
  moneda: string
  inventario: ItemInventario[]
  prestamos: PrestamoEquipo[]
  /** Nueva amenidad: el nombre se enfoca al abrir y lleva ejemplos. */
  nueva?: boolean
}

const input: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid var(--at-line)', borderRadius: 8, fontSize: 14, background: 'var(--at-surface-2)' }
const label: CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--at-ink-2)', display: 'block', marginBottom: 4 }
const labelRegla: CSSProperties = { ...label, fontSize: 11.5 }
const check: CSSProperties = { fontSize: 13.5, fontWeight: 600, color: 'var(--at-ink-2)', cursor: 'pointer' }

export function FormularioAmenidad({ form, setForm, fotoUrl, setFotoUrl, moneda, inventario, prestamos, nueva = false }: Props) {
  const uid = useId()
  const id = (campo: string) => `${uid}-${campo}`
  const set = <K extends keyof AmenidadFormState>(campo: K) => (valor: AmenidadFormState[K]) => setForm(f => ({ ...f, [campo]: valor }))

  return (
    // minmax(min(100%, 220px)): dos columnas en escritorio, una en el teléfono.
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 14 }}>
      <div style={{ gridColumn: '1 / -1' }}>
        <label htmlFor={id('nombre')} style={label}>Nombre *</label>
        <input id={id('nombre')} value={form.nombre} onChange={e => set('nombre')(e.target.value)} placeholder="Ej. Piscina, Gimnasio, Salón Social" autoFocus={nueva} style={input} />
      </div>
      <div>
        <label htmlFor={id('capacidad')} style={label}>Capacidad máxima</label>
        <input id={id('capacidad')} type="number" min={1} value={form.capacidad_max} onChange={e => set('capacidad_max')(e.target.value)} placeholder="Personas" style={input} />
      </div>
      <div>
        <label htmlFor={id('descripcion')} style={label}>Descripción</label>
        <input id={id('descripcion')} value={form.descripcion} onChange={e => set('descripcion')(e.target.value)} placeholder="Opcional" style={input} />
      </div>
      <div>
        <label htmlFor={id('horario-inicio')} style={label}>Horario inicio</label>
        <input id={id('horario-inicio')} type="time" value={form.horario_inicio} onChange={e => set('horario_inicio')(e.target.value)} style={input} />
      </div>
      <div>
        <label htmlFor={id('horario-fin')} style={label}>Horario fin</label>
        <input id={id('horario-fin')} type="time" value={form.horario_fin} onChange={e => set('horario_fin')(e.target.value)} style={input} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" id={id('deposito')} checked={form.requiere_deposito} onChange={e => set('requiere_deposito')(e.target.checked)} />
        <label htmlFor={id('deposito')} style={check}>Requiere depósito</label>
      </div>
      {form.requiere_deposito && (
        <div>
          <label htmlFor={id('monto-deposito')} style={label}>Monto depósito ({moneda})</label>
          <input id={id('monto-deposito')} type="number" value={form.monto_deposito} onChange={e => set('monto_deposito')(e.target.value)} min="0" step="0.01" style={input} />
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" id={id('tarifa')} checked={form.requiere_tarifa} onChange={e => set('requiere_tarifa')(e.target.checked)} />
        <label htmlFor={id('tarifa')} style={check}>Tarifa por uso</label>
      </div>
      {form.requiere_tarifa && (
        <>
          <div>
            <label htmlFor={id('tarifa-uso')} style={label}>Tarifa entre semana ({moneda})</label>
            <input id={id('tarifa-uso')} type="number" value={form.tarifa_uso} onChange={e => set('tarifa_uso')(e.target.value)} min="0" step="0.01" style={input} />
          </div>
          <div>
            <label htmlFor={id('tarifa-finde')} style={label}>Tarifa fin de semana ({moneda})</label>
            <input id={id('tarifa-finde')} type="number" value={form.tarifa_uso_finde} onChange={e => set('tarifa_uso_finde')(e.target.value)} min="0" step="0.01" placeholder="Igual que entre semana" style={input} />
          </div>
        </>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" id={id('aprobacion')} checked={form.requiere_aprobacion} onChange={e => set('requiere_aprobacion')(e.target.checked)} />
        <label htmlFor={id('aprobacion')} style={check}>Requiere aprobación del administrador</label>
      </div>

      <div style={{ gridColumn: '1 / -1' }}>
        <label htmlFor={id('reglamento')} style={label}>Reglamento (opcional)</label>
        <textarea id={id('reglamento')} value={form.reglamento} onChange={e => set('reglamento')(e.target.value)}
          placeholder="Texto del reglamento que el residente debe aceptar al reservar (horarios, limpieza, daños, invitados, etc.)"
          style={{ ...input, fontSize: 13.5, minHeight: 70, resize: 'vertical' }} />
      </div>

      <div style={{ gridColumn: '1 / -1', borderTop: '1px dashed var(--at-line)', paddingTop: 12, marginTop: 4 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--at-ink-2)', marginBottom: 8 }}>Reglas de reserva (opcional)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 12 }}>
          <div>
            <label htmlFor={id('max-mes')} style={labelRegla}>Máx. reservas/mes por unidad</label>
            <input id={id('max-mes')} type="number" min={1} value={form.max_reservas_mes_unidad} onChange={e => set('max_reservas_mes_unidad')(e.target.value)} placeholder="sin límite" style={input} />
          </div>
          <div>
            <label htmlFor={id('antelacion')} style={labelRegla}>Antelación mínima (horas)</label>
            <input id={id('antelacion')} type="number" min={0} value={form.horas_minimas_antelacion} onChange={e => set('horas_minimas_antelacion')(e.target.value)} placeholder="sin restricción" style={input} />
          </div>
          <div>
            <label htmlFor={id('duracion')} style={labelRegla}>Duración máx. (horas)</label>
            <input id={id('duracion')} type="number" min={0.5} step={0.5} value={form.duracion_max_horas} onChange={e => set('duracion_max_horas')(e.target.value)} placeholder="sin tope" style={input} />
          </div>
          <div>
            <label htmlFor={id('prep-previa')} style={labelRegla}>Preparación previa (min)</label>
            <input id={id('prep-previa')} type="number" min={0} step={5} value={form.minutos_preparacion_previa} onChange={e => set('minutos_preparacion_previa')(e.target.value)} placeholder="0" style={input} />
          </div>
          <div>
            <label htmlFor={id('prep-posterior')} style={labelRegla}>Preparación posterior (min)</label>
            <input id={id('prep-posterior')} type="number" min={0} step={5} value={form.minutos_preparacion_posterior} onChange={e => set('minutos_preparacion_posterior')(e.target.value)} placeholder="0" style={input} />
          </div>
        </div>
      </div>

      <div style={{ gridColumn: '1 / -1' }}>
        <SelectorEquiposAmenidad inventario={inventario} prestamos={prestamos} value={form.equipos} onChange={set('equipos')} />
      </div>
      <div style={{ gridColumn: '1 / -1' }}>
        <ImageUploader value={fotoUrl} onChange={setFotoUrl} folder="amenidades" label="Foto de la amenidad" />
      </div>
    </div>
  )
}
