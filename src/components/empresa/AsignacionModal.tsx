import { useState, useEffect, useRef } from 'react'
import {
  fetchUserProjectAssignments,
  guardarAsignacionesProyecto,
  puedeEditarAsignaciones,
  reconciliarCasillas,
} from '../../domain/empresa/usuarios'
import { EditModal } from '../shared/EditModal'
import { Button } from '../shared/Button'
import { notify } from '../shared/Dialog'

interface Usuario {
  id: string
  full_name: string
  role: string
}

interface Proyecto {
  id: string
  nombre: string
}

interface AsignacionModalProps {
  usuario: Usuario
  proyectos: Proyecto[]
  onClose: () => void
  onSaved: () => void
  /** Se llama cuando el guardado quedó A MEDIAS (una parte se aplicó): quien muestra la lista debe recargarla. */
  onReload?: () => void
  /**
   * Quien edita. OBLIGATORIO: sin él no habría compuerta y se ofrecería editar a quien no es el principal (propietario o superadministrador; un administrador no edita
   * las asignaciones de nadie, ni las suyas: el servidor lo rechaza, así que se deshabilita Guardar con la explicación).
   */
  actor: { id: string; role: string }
}

const MENSAJE_LECTURA_FALLIDA = 'No se pudieron cargar las asignaciones actuales. Por seguridad no se puede guardar sin ellas: reintenta la carga.'
const MENSAJE_ERROR_GENERICO = 'No se pudieron guardar las asignaciones. Intenta de nuevo.'

/** Lee los proyectos asignados a la persona; `null` si la lectura falla (por error devuelto o por excepción de red): nunca se confunde «no se pudo leer» con «no tiene ninguno». */
async function leerAsignados(userId: string): Promise<string[] | null> {
  try {
    const { data, error } = await fetchUserProjectAssignments(userId)
    return !error && data ? data.map(a => a.project_id) : null
  } catch {
    return null
  }
}

export function AsignacionModal({ usuario, proyectos, onClose, onSaved, onReload, actor }: AsignacionModalProps) {
  const permiso = puedeEditarAsignaciones(actor, usuario)
  // El componente supone UNA instancia por persona: quien lo monta debe pasarle `key={usuario.id}` (EmpresaUsuariosSection lo hace), de modo que cambiar de persona lo
  // REMONTE con el estado de cero. Sin eso, durante un render quedarían las casillas y el `inicial` de la persona anterior bajo el nombre de la nueva (H3, ronda 4).
  //
  // `inicial` es lo que había al ABRIR: la diferencia se calcula contra eso (nunca contra una lectura nueva al guardar), de modo que sólo se
  // escribe lo que esta persona cambió en pantalla y no se deshace lo que otro administrador haya hecho mientras tanto. Tras un guardado
  // PARCIAL se vuelve a fijar con lo que HAY en la base (F2-01): la parte que sí se aplicó ya forma parte del «antes» del siguiente guardado.
  //
  // REGLA DE LAS CASILLAS TRAS ESA RELECTURA (H1, ronda 4): fusión de TRES vías, `reconciliarCasillas` en domain/empresa/usuarios.ts.
  //     casillas nuevas = (inicial NUEVO \ lo que la persona QUITÓ) ∪ (lo que la persona AÑADIÓ), limitada a los proyectos editables
  //     quitó = inicial ANTERIOR \ casillas       añadió = casillas \ inicial ANTERIOR
  // Renovar sólo `inicial` no basta: si otro administrador cambió a la misma persona entre la apertura y la relectura, las casillas seguían reflejando la apertura y el siguiente
  // «Guardar» sin tocar nada lo DESHACÍA —borraba una asignación ajena que la persona nunca vio, o reinsertaba una que el otro acababa de revocar (acceso restituido)—. Con la
  // fusión, lo que la persona no tocó refleja lo que HAY y lo que sí tocó conserva su elección (lo que falta por escribir es la diferencia contra el `inicial` nuevo).
  const [inicial, setInicial] = useState<string[]>([])
  const [asignados, setAsignados] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [errorCarga, setErrorCarga] = useState(false)
  const [intento, setIntento] = useState(0)
  const [saving, setSaving] = useState(false)
  // «Versión» de la pantalla: sube con cada carga (otra persona, Reintentar). Cualquier respuesta que llegue con otra versión es de una pantalla que ya no está: no debe
  // tocar `inicial` ni el error de carga de la persona que se ve ahora (V3-05). Sirve a la carga y a la relectura posterior a un guardado fallido.
  const versionRef = useRef(0)
  // Sube la versión: lo que esté en vuelo deja de ser de la pantalla vigente. (Es un contador, no un nodo del DOM: la regla de hooks que avisa de leer `ref.current` en una limpieza no aplica.)
  const invalidarPantalla = () => { versionRef.current++ }

  useEffect(() => {
    const version = ++versionRef.current
    const vigente = () => versionRef.current === version
    async function cargarAsignaciones() {
      setLoading(true)
      setErrorCarga(false)
      const ids = await leerAsignados(usuario.id)
      if (!vigente()) return
      // Si la lectura falla NO se muestra una pantalla «vacía» con Guardar activo: eso borraría lo que sí existe. Se avisa y se bloquea Guardar.
      if (ids === null) {
        setInicial([])
        setAsignados(new Set())
        setErrorCarga(true)
      } else {
        setInicial(ids)
        setAsignados(new Set(ids))
      }
      setLoading(false)
    }
    void cargarAsignaciones()
    // La limpieza también sube `versionRef`: se ejecuta antes de la siguiente carga (otra persona, Reintentar) y, sobre todo, AL DESMONTAR (otra persona con `key`, Cancelar, ×,
    // Escape). Lo que quedaba en vuelo de esta pantalla —la carga, la relectura de un guardado, un guardado que termina bien— ya no es de la pantalla que se ve y no debe cerrar
    // ni dar por guardada a la siguiente (H2, ronda 4: antes, un guardado de A que terminaba bien llamaba a `onClose` aunque ya se viera B).
    return () => invalidarPantalla()
  }, [usuario.id, intento])

  async function guardar() {
    if (!permiso.permitido || errorCarga || loading || saving) return
    const version = versionRef.current          // la pantalla (persona y carga) en la que se pulsó Guardar
    const vigente = () => versionRef.current === version
    setSaving(true)
    try {
      // Sólo cuenta lo marcado ENTRE los proyectos que la pantalla muestra; una asignación a un proyecto que no se muestra no se toca.
      const editables = proyectos.map(p => p.id)
      const deseadas = editables.filter(id => asignados.has(id))
      const { error, parcial, incierto } = await guardarAsignacionesProyecto(usuario.id, inicial, deseadas, editables)
      if (error) {
        notify({
          title: incierto ? 'No se pudo confirmar el guardado' : parcial ? 'Asignaciones guardadas a medias' : 'Asignaciones sin guardar',
          text: error,
          variant: 'error',
          duration: 9000,
        })
        if (parcial) {
          onReload?.()                 // la lista de atrás debe reflejar lo que SÍ se aplicó (o pudo aplicarse); el diálogo sigue abierto para volver a guardar
          // F2-01: lo que se aplicó ya está en la base. Si `inicial` no se renueva, quien cambia de idea y guarda otra vez calcula contra un estado que ya no
          // es cierto: la fila ya insertada se quedaba y la pantalla decía «guardado». Se relee y ése es el nuevo «antes». Si no se puede leer, no se sabe qué
          // hay: se pasa a la pantalla de error con «Reintentar» y Guardar deshabilitado (nunca se guarda a ciegas). V3-02: lo mismo cuando una escritura terminó
          // SIN respuesta de la base (`incierto`): pudo aplicarse. V3-05: si mientras tanto la pantalla pasó a otra persona (o se recargó) la respuesta ya no es de esta
          // pantalla y no se toca `inicial` (el de la persona nueva es el que cargó su propio efecto).
          const actuales = await leerAsignados(usuario.id)
          if (vigente()) {
            if (actuales === null) setErrorCarga(true)
            else {
              setInicial(actuales)
              // H1: y las casillas se fusionan a tres vías (ver arriba), sobre las casillas de AHORA (`prev`: la persona pudo marcar o desmarcar mientras el guardado estaba en vuelo)
              // y contra el `inicial` con el que se calculó este guardado. Lo que otro administrador cambió entretanto aparece reflejado y no se deshace al reintentar.
              setAsignados(prev => reconciliarCasillas(inicial, actuales, prev, editables))
            }
          }
        }
        return
      }
      // H2: si mientras se guardaba la pantalla pasó a otra persona (o el modal se cerró) este éxito es de una pantalla que ya no está: NO se cierra ni se da por guardada la actual.
      // Sí se recarga la lista de atrás, porque la base cambió.
      if (!vigente()) {
        onReload?.()
        return
      }
      onSaved()
      onClose()
    } catch {
      notify({ title: 'Asignaciones sin guardar', text: MENSAJE_ERROR_GENERICO, variant: 'error', duration: 9000 })
    } finally {
      setSaving(false)
    }
  }

  function toggleProyecto(id: string) {
    setAsignados(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const roleLabel: Record<string, string> = {
    admin: 'Administrador',
    operator: 'Operador',
    operador: 'Operador',
    viewer: 'Visualizador',
    visor: 'Visualizador',
    collector: 'Gestor de Cobros',
  }

  return (
    <EditModal
      title="Asignar Acceso a Proyectos"
      subtitle={`${usuario.full_name} · ${roleLabel[usuario.role] ?? usuario.role}`}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button
            variant="gradient-primary"
            onClick={() => void guardar()}
            loading={saving}
            loadingText="Guardando..."
            disabled={!permiso.permitido || loading || errorCarga}
          >
            Guardar
          </Button>
        </>
      }
    >
      {!permiso.permitido && (
        <div
          role="note"
          style={{
            marginBottom: '12px', padding: '10px 14px', borderRadius: '10px', fontSize: '13px', lineHeight: 1.4,
            color: 'var(--at-ink)', background: 'var(--at-surface-2)', border: '1px solid var(--at-line-strong)',
          }}
        >
          {permiso.motivo}
        </div>
      )}
      {loading ? (
        <div style={{ color: 'var(--at-ink-3)', textAlign: 'center', padding: '20px' }}>Cargando...</div>
      ) : errorCarga ? (
        <div
          role="alert"
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '16px', borderRadius: '10px',
            fontSize: '13px', lineHeight: 1.4, textAlign: 'center', color: 'var(--at-ink)',
            background: 'var(--at-surface-2)', border: '1px solid var(--at-line-strong)',
          }}
        >
          <span>{MENSAJE_LECTURA_FALLIDA}</span>
          <Button variant="ghost" onClick={() => setIntento(n => n + 1)}>Reintentar</Button>
        </div>
      ) : proyectos.length === 0 ? (
        <div style={{ color: 'var(--at-ink-3)', textAlign: 'center', padding: '20px' }}>
          No hay proyectos en esta empresa.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {proyectos.map(p => {
            const checked = asignados.has(p.id)
            return (
              <label
                key={p.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: '12px',
                  padding: '12px 16px', borderRadius: '10px', cursor: 'pointer',
                  background: checked ? 'var(--at-primary-soft)' : 'var(--at-surface-2)',
                  border: `1px solid ${checked ? 'var(--at-primary)' : 'transparent'}`,
                  transition: 'all 0.15s',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!permiso.permitido}
                  onChange={() => toggleProyecto(p.id)}
                  style={{ accentColor: 'var(--at-primary)', width: '16px', height: '16px', cursor: permiso.permitido ? 'pointer' : 'not-allowed' }}
                />
                <span style={{ color: 'var(--at-ink)', fontSize: '14px', fontWeight: checked ? 600 : 400 }}>
                  {p.nombre}
                </span>
              </label>
            )
          })}
        </div>
      )}
    </EditModal>
  )
}
