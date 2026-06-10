import { useState } from 'react'
import { DataTable, type DataTableColumn } from '../shared'
import { EditModal } from '../shared'
import { StatusBadge } from '../shared/StatusBadge'
import { notify } from '../shared/Dialog'
import { useProveedoresQuery } from '../../domain/cxp/queries'
import { useGuardarProveedorMutation, useToggleProveedorActivoMutation } from '../../domain/cxp/mutations'
import { proveedorFormSchema } from '../../domain/cxp/schemas'
import { CATEGORIAS_GASTO_CXP, type Proveedor } from '../../types/cxp'
import { Campo, btnLink, btnPrimario, btnSecundario, input } from './ui'

interface Props {
  companyId: string
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

export function ProveedoresTab({ companyId }: Props) {
  const { data: proveedores = [], isLoading } = useProveedoresQuery(companyId)
  const guardar = useGuardarProveedorMutation(companyId)
  const toggle = useToggleProveedorActivoMutation(companyId)
  const [form, setForm] = useState<FormState | null>(null)

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
      notify({ variant: 'success', title: 'Listo', text: form.id ? 'Proveedor actualizado.' : 'Proveedor creado.' })
      setForm(null)
    } catch (e) {
      notify({ variant: 'error', title: 'Error', text: e instanceof Error ? e.message : 'No se pudo guardar.' })
    }
  }

  const columns: DataTableColumn<Proveedor>[] = [
    { key: 'nombre', header: 'Proveedor', accessor: (p) => p.nombre, sortable: true },
    { key: 'nit', header: 'NIT / RFC', accessor: (p) => p.nit ?? p.rfc ?? '', render: (p) => p.nit ?? p.rfc ?? '—', width: 120, hideOnMobile: true },
    { key: 'contacto', header: 'Contacto', accessor: (p) => p.contacto_nombre ?? '', render: (p) => p.contacto_nombre ?? p.email ?? p.telefono ?? '—', hideOnMobile: true },
    { key: 'dias_credito', header: 'Crédito (días)', accessor: (p) => p.dias_credito, numeric: true, width: 110, hideOnMobile: true },
    {
      key: 'estado',
      header: 'Estado',
      accessor: (p) => (p.activo ? 'activo' : 'inactivo'),
      render: (p) => <StatusBadge tone={p.activo ? 'success' : 'neutral'}>{p.activo ? 'activo' : 'inactivo'}</StatusBadge>,
      width: 90,
    },
    {
      key: 'acciones',
      header: '',
      render: (p) => (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button onClick={(e) => { e.stopPropagation(); abrirEdicion(p) }} style={btnLink}>Editar</button>
          <button
            onClick={(e) => { e.stopPropagation(); void toggle.mutateAsync({ id: p.id, activo: !p.activo }) }}
            style={btnLink}
          >
            {p.activo ? 'Desactivar' : 'Activar'}
          </button>
        </div>
      ),
      width: 150,
    },
  ]

  return (
    <div>
      <DataTable<Proveedor>
        data={proveedores}
        columns={columns}
        rowKey="id"
        isLoading={isLoading}
        searchableKeys={['nombre', (p) => p.nit ?? '', (p) => p.rfc ?? '']}
        searchPlaceholder="Buscar proveedor…"
        toolbar={<button onClick={() => setForm({ ...FORM_VACIO })} style={btnPrimario}>+ Nuevo proveedor</button>}
        emptyState={{
          title: 'Sin proveedores',
          description: 'Los nombres de proveedor usados en gastos anteriores se migraron automáticamente; registra aquí los datos completos (NIT/RFC, contacto, días de crédito).',
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
    </div>
  )
}
