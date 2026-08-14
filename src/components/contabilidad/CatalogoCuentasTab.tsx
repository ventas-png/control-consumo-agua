import { useMemo, useState } from 'react'
import { DataTable, type DataTableColumn } from '../shared'
import { EditModal } from '../shared'
import { StatusBadge } from '../shared/StatusBadge'
import { notify } from '../shared/Dialog'
import { useCuentasQuery } from '../../domain/contabilidad/queries'
import { useActualizarCuentaMutation, useCrearCuentaMutation } from '../../domain/contabilidad/mutations'
import { buildArbolCuentas, flattenArbol, type CuentaNode } from '../../domain/contabilidad/arbol'
import { cuentaFormSchema } from '../../domain/contabilidad/schemas'
import { NATURALEZA_POR_TIPO, TIPO_CUENTA_LABELS, type CuentaContable, type TipoCuenta } from '../../types/contabilidad'
import type { Proyecto } from '../../types/plataforma'
import { NIVEL_MAXIMO } from '../../domain/contabilidad/importCuentas'
import { ImportCuentasModal } from './ImportCuentasModal'
import { Campo, btnLink, btnPrimario, btnSecundario, input, usePermisosContabilidad } from './ui'

interface Props {
  companyId: string
  /** Ledger activo: null = contabilidad de la empresa. */
  projectId: string | null
  monedaBase: string
  /** Proyectos de la empresa: destinos posibles de la carga masiva. */
  proyectos: Proyecto[]
}

interface FormState {
  id: string | null
  codigo: string
  nombre: string
  tipo: TipoCuenta
  naturaleza: 'deudora' | 'acreedora'
  padre_id: string
  es_detalle: boolean
  moneda: string
  descripcion: string
}

const FORM_VACIO: FormState = {
  id: null, codigo: '', nombre: '', tipo: 'activo', naturaleza: 'deudora',
  padre_id: '', es_detalle: true, moneda: '', descripcion: '',
}

export function CatalogoCuentasTab({ companyId, projectId, monedaBase, proyectos }: Props) {
  const { puedeCrear, puedeEditar, puedeCambiarEstado } = usePermisosContabilidad()
  const { data: cuentas = [], isLoading } = useCuentasQuery(companyId, projectId)
  const crear = useCrearCuentaMutation(companyId, projectId)
  const actualizar = useActualizarCuentaMutation(companyId, projectId)

  const [form, setForm] = useState<FormState | null>(null)
  const [mostrarInactivas, setMostrarInactivas] = useState(false)
  const [importando, setImportando] = useState(false)

  const filas = useMemo(() => {
    const visibles = mostrarInactivas ? cuentas : cuentas.filter((c) => c.activa)
    return flattenArbol(buildArbolCuentas(visibles))
  }, [cuentas, mostrarInactivas])

  function abrirNueva() {
    setForm({ ...FORM_VACIO })
  }

  function abrirEdicion(c: CuentaContable) {
    setForm({
      id: c.id,
      codigo: c.codigo,
      nombre: c.nombre,
      tipo: c.tipo,
      naturaleza: c.naturaleza,
      padre_id: c.padre_id ?? '',
      es_detalle: c.es_detalle,
      moneda: c.moneda ?? '',
      descripcion: c.descripcion ?? '',
    })
  }

  async function guardar() {
    if (!form) return
    const padre = cuentas.find((c) => c.id === form.padre_id)
    const parsed = cuentaFormSchema.safeParse({
      codigo: form.codigo,
      nombre: form.nombre,
      tipo: form.tipo,
      naturaleza: form.naturaleza,
      padre_id: form.padre_id || null,
      nivel: padre ? Math.min(padre.nivel + 1, NIVEL_MAXIMO) : 1,
      es_detalle: form.es_detalle,
      moneda: form.moneda.trim() === '' ? null : form.moneda,
      descripcion: form.descripcion.trim() === '' ? null : form.descripcion,
    })
    if (!parsed.success) {
      notify({ variant: 'warning', title: 'Atención', text: parsed.error.issues[0]?.message ?? 'Datos inválidos.' })
      return
    }
    try {
      if (form.id) {
        await actualizar.mutateAsync({ id: form.id, patch: parsed.data })
      } else {
        await crear.mutateAsync(parsed.data)
      }
      notify({ variant: 'success', title: 'Listo', text: form.id ? 'Cuenta actualizada.' : 'Cuenta creada.' })
      setForm(null)
    } catch (e) {
      notify({ variant: 'error', title: 'Error', text: e instanceof Error ? e.message : 'No se pudo guardar la cuenta.' })
    }
  }

  async function toggleActiva(c: CuentaContable) {
    try {
      await actualizar.mutateAsync({ id: c.id, patch: { activa: !c.activa } })
    } catch (e) {
      notify({ variant: 'error', title: 'Error', text: e instanceof Error ? e.message : 'No se pudo actualizar.' })
    }
  }

  const columns: DataTableColumn<CuentaNode>[] = [
    {
      key: 'codigo',
      header: 'Código',
      accessor: (c) => c.codigo,
      render: (c) => (
        <span style={{ paddingLeft: (c.nivel - 1) * 16, fontFamily: 'var(--at-mono, monospace)', fontWeight: c.es_detalle ? 500 : 700 }}>
          {c.codigo}
        </span>
      ),
      width: 180,
    },
    {
      key: 'nombre',
      header: 'Nombre',
      accessor: (c) => c.nombre,
      render: (c) => <span style={{ fontWeight: c.es_detalle ? 400 : 700 }}>{c.nombre}</span>,
    },
    { key: 'tipo', header: 'Tipo', accessor: (c) => c.tipo, render: (c) => TIPO_CUENTA_LABELS[c.tipo], width: 100, hideOnMobile: true },
    { key: 'naturaleza', header: 'Naturaleza', accessor: (c) => c.naturaleza, width: 100, hideOnMobile: true },
    {
      key: 'moneda',
      header: 'Moneda',
      accessor: (c) => c.moneda ?? '',
      render: (c) => c.moneda ?? <span style={{ color: 'var(--at-ink-soft)' }}>{monedaBase}</span>,
      width: 80,
      hideOnMobile: true,
    },
    {
      key: 'estado',
      header: 'Estado',
      accessor: (c) => (c.activa ? 'activa' : 'inactiva'),
      render: (c) => (
        <StatusBadge tone={c.activa ? 'success' : 'neutral'}>
          {c.es_detalle ? (c.activa ? 'detalle' : 'inactiva') : 'agrupadora'}
        </StatusBadge>
      ),
      width: 110,
    },
    {
      key: 'acciones',
      header: '',
      render: (c) => (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          {puedeEditar && (
            <button onClick={(e) => { e.stopPropagation(); abrirEdicion(c) }} style={btnLink}>Editar</button>
          )}
          {!c.es_sistema && puedeCambiarEstado && (
            <button onClick={(e) => { e.stopPropagation(); void toggleActiva(c) }} style={btnLink}>
              {c.activa ? 'Desactivar' : 'Activar'}
            </button>
          )}
        </div>
      ),
      width: 150,
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--at-space-3)' }}>
      <DataTable<CuentaNode>
        data={filas}
        columns={columns}
        rowKey="id"
        isLoading={isLoading}
        pageSize={0}
        searchableKeys={['codigo', 'nombre']}
        searchPlaceholder="Buscar cuenta…"
        toolbar={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ fontSize: 12, color: 'var(--at-ink-soft)', display: 'flex', gap: 4, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={mostrarInactivas}
                onChange={(e) => setMostrarInactivas(e.target.checked)}
              />
              Ver inactivas
            </label>
            {puedeCrear && (
              <>
                <button onClick={() => setImportando(true)} style={btnSecundario}>📥 Carga masiva</button>
                <button onClick={abrirNueva} style={btnPrimario}>+ Nueva cuenta</button>
              </>
            )}
          </div>
        }
        emptyState={{
          title: 'Sin catálogo de cuentas',
          description: 'El catálogo se crea automáticamente al activar la contabilidad. Si no aparece, contacta al administrador.',
        }}
      />

      {importando && (
        <ImportCuentasModal
          companyId={companyId}
          projectId={projectId}
          proyectos={proyectos}
          onClose={() => setImportando(false)}
          // El listado se refresca solo (la mutación invalida el catálogo del
          // ledger); el modal se queda en su pantalla de resumen hasta que el
          // usuario la cierre.
          onImportado={() => undefined}
        />
      )}

      {form && (
        <EditModal title={form.id ? 'Editar cuenta' : 'Nueva cuenta'} onClose={() => setForm(null)} size="sm"
          footer={
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setForm(null)} style={btnSecundario}>Cancelar</button>
              <button onClick={() => void guardar()} disabled={crear.isPending || actualizar.isPending} style={btnPrimario}>
                Guardar
              </button>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Campo label="Código *">
              <input value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} style={input} placeholder="1102-02" />
            </Campo>
            <Campo label="Nombre *">
              <input value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} style={input} placeholder="Banco USD" />
            </Campo>
            <Campo label="Cuenta padre">
              <select
                value={form.padre_id}
                onChange={(e) => {
                  const padre = cuentas.find((c) => c.id === e.target.value)
                  setForm({
                    ...form,
                    padre_id: e.target.value,
                    ...(padre ? { tipo: padre.tipo, naturaleza: padre.naturaleza } : {}),
                  })
                }}
                style={input}
              >
                <option value="">(raíz)</option>
                {cuentas.filter((c) => c.activa && c.nivel < NIVEL_MAXIMO && c.id !== form.id).map((c) => (
                  <option key={c.id} value={c.id}>{c.codigo} — {c.nombre}</option>
                ))}
              </select>
            </Campo>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Campo label="Tipo">
                <select
                  value={form.tipo}
                  onChange={(e) => {
                    const tipo = e.target.value as TipoCuenta
                    setForm({ ...form, tipo, naturaleza: NATURALEZA_POR_TIPO[tipo] })
                  }}
                  style={input}
                >
                  {Object.entries(TIPO_CUENTA_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Campo>
              <Campo label="Naturaleza">
                <select value={form.naturaleza} onChange={(e) => setForm({ ...form, naturaleza: e.target.value as 'deudora' | 'acreedora' })} style={input}>
                  <option value="deudora">Deudora</option>
                  <option value="acreedora">Acreedora</option>
                </select>
              </Campo>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Campo label={`Moneda (vacío = ${monedaBase})`}>
                <input value={form.moneda} onChange={(e) => setForm({ ...form, moneda: e.target.value.toUpperCase() })} style={input} placeholder="USD" maxLength={3} />
              </Campo>
              <Campo label="Recibe movimientos">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, paddingTop: 6 }}>
                  <input type="checkbox" checked={form.es_detalle} onChange={(e) => setForm({ ...form, es_detalle: e.target.checked })} />
                  Cuenta de detalle
                </label>
              </Campo>
            </div>
            <Campo label="Descripción">
              <textarea value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} style={{ ...input, minHeight: 60 }} />
            </Campo>
          </div>
        </EditModal>
      )}
    </div>
  )
}

