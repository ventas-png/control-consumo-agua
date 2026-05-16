import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react'
import { DataTable, type DataTableColumn } from '../DataTable'

interface Row {
  id: string
  nombre: string
  consumo: number
  estado: 'pagado' | 'pendiente' | 'mora'
}

const rows: Row[] = [
  { id: '1', nombre: 'Ana Pérez',  consumo: 25.5, estado: 'pagado' },
  { id: '2', nombre: 'Luis López', consumo: 12.0, estado: 'pendiente' },
  { id: '3', nombre: 'María Sol',  consumo: 47.8, estado: 'mora' },
  { id: '4', nombre: 'Juan Castro', consumo:  8.2, estado: 'pagado' },
]

const columns: DataTableColumn<Row>[] = [
  { key: 'nombre',  header: 'Nombre',  sortable: true },
  { key: 'consumo', header: 'Consumo', sortable: true, align: 'right' },
  { key: 'estado',  header: 'Estado',  sortable: true },
]

beforeEach(cleanup)

describe('DataTable — render básico', () => {
  it('renderiza todas las filas y headers cuando no hay filter ni paginación', () => {
    render(<DataTable data={rows} columns={columns} rowKey="id" pageSize={0} />)
    expect(screen.getByText('Nombre')).toBeDefined()
    expect(screen.getByText('Ana Pérez')).toBeDefined()
    expect(screen.getByText('Luis López')).toBeDefined()
    expect(screen.getByText('María Sol')).toBeDefined()
    expect(screen.getByText('Juan Castro')).toBeDefined()
  })

  it('respeta render() custom de la columna', () => {
    const cols: DataTableColumn<Row>[] = [
      { key: 'nombre', header: 'Cliente', render: row => `>> ${row.nombre} <<` },
    ]
    render(<DataTable data={rows} columns={cols} rowKey="id" pageSize={0} />)
    expect(screen.getByText('>> Ana Pérez <<')).toBeDefined()
  })
})

describe('DataTable — search', () => {
  it('filtra por searchableKeys (string accessor)', () => {
    render(
      <DataTable
        data={rows}
        columns={columns}
        rowKey="id"
        searchableKeys={['nombre']}
        pageSize={0}
      />
    )
    fireEvent.change(screen.getByPlaceholderText(/buscar/i), { target: { value: 'Ana' } })
    expect(screen.queryByText('Ana Pérez')).toBeTruthy()
    expect(screen.queryByText('Luis López')).toBeNull()
  })

  it('busca case-insensitive', () => {
    render(<DataTable data={rows} columns={columns} rowKey="id" searchableKeys={['nombre']} pageSize={0} />)
    fireEvent.change(screen.getByPlaceholderText(/buscar/i), { target: { value: 'mar' } })
    expect(screen.queryByText('María Sol')).toBeTruthy()
    expect(screen.queryByText('Ana Pérez')).toBeNull()
  })

  it('acepta función como searchable key', () => {
    render(
      <DataTable
        data={rows}
        columns={columns}
        rowKey="id"
        searchableKeys={[(row: Row) => `${row.nombre}-${row.estado}`]}
        pageSize={0}
      />
    )
    fireEvent.change(screen.getByPlaceholderText(/buscar/i), { target: { value: 'mora' } })
    expect(screen.queryByText('María Sol')).toBeTruthy()
    expect(screen.queryByText('Ana Pérez')).toBeNull()
  })
})

describe('DataTable — sort', () => {
  it('ordena descendente al clickear header sortable', () => {
    render(<DataTable data={rows} columns={columns} rowKey="id" pageSize={0} />)
    fireEvent.click(screen.getByText(/Consumo/))
    const cells = screen.getAllByRole('row').slice(1).map(r => within(r).getAllByRole('cell')[1].textContent)
    expect(cells).toEqual(['47.8', '25.5', '12', '8.2'])
  })

  it('toggle a ascendente al segundo click', () => {
    render(<DataTable data={rows} columns={columns} rowKey="id" pageSize={0} />)
    fireEvent.click(screen.getByText(/Consumo/))
    fireEvent.click(screen.getByText(/Consumo/))
    const cells = screen.getAllByRole('row').slice(1).map(r => within(r).getAllByRole('cell')[1].textContent)
    expect(cells).toEqual(['8.2', '12', '25.5', '47.8'])
  })

  it('defaultSort se aplica al render inicial', () => {
    render(
      <DataTable
        data={rows}
        columns={columns}
        rowKey="id"
        defaultSort={{ key: 'nombre', direction: 'asc' }}
        pageSize={0}
      />
    )
    const cells = screen.getAllByRole('row').slice(1).map(r => within(r).getAllByRole('cell')[0].textContent)
    expect(cells).toEqual(['Ana Pérez', 'Juan Castro', 'Luis López', 'María Sol'])
  })

  it('no permite ordenar columnas no sortable', () => {
    const cols: DataTableColumn<Row>[] = [
      { key: 'nombre', header: 'Nombre', sortable: false },
    ]
    render(<DataTable data={rows} columns={cols} rowKey="id" pageSize={0} />)
    fireEvent.click(screen.getByText('Nombre'))
    // Sin sort, el orden permanece como el data input
    const cells = screen.getAllByRole('row').slice(1).map(r => within(r).getAllByRole('cell')[0].textContent)
    expect(cells).toEqual(['Ana Pérez', 'Luis López', 'María Sol', 'Juan Castro'])
  })
})

describe('DataTable — filters', () => {
  it('aplica un filter dropdown', () => {
    function Wrapper() {
      const [estado, setEstado] = (require('react') as typeof import('react')).useState('todos')
      return (
        <DataTable
          data={rows.filter(r => estado === 'todos' || r.estado === estado)}
          columns={columns}
          rowKey="id"
          filters={[{
            key: 'estado',
            label: 'Estado',
            value: estado,
            onChange: setEstado,
            options: [
              { value: 'todos', label: 'Todos' },
              { value: 'pagado', label: 'Pagado' },
              { value: 'pendiente', label: 'Pendiente' },
            ],
          }]}
          pageSize={0}
        />
      )
    }
    render(<Wrapper />)
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'pagado' } })
    expect(screen.queryByText('Ana Pérez')).toBeTruthy()
    expect(screen.queryByText('Juan Castro')).toBeTruthy()
    expect(screen.queryByText('Luis López')).toBeNull()
  })
})

describe('DataTable — paginación', () => {
  it('limita las filas por pageSize', () => {
    render(<DataTable data={rows} columns={columns} rowKey="id" pageSize={2} />)
    expect(screen.getAllByRole('row')).toHaveLength(1 + 2) // header + 2
    expect(screen.getByText(/Página 1 de 2/)).toBeDefined()
  })

  it('avanza a la siguiente página', () => {
    render(<DataTable data={rows} columns={columns} rowKey="id" pageSize={2} />)
    fireEvent.click(screen.getByText(/Siguiente/))
    expect(screen.getByText(/Página 2 de 2/)).toBeDefined()
  })
})

describe('DataTable — empty state', () => {
  it('muestra empty state por default cuando no hay data', () => {
    render(<DataTable data={[]} columns={columns} rowKey="id" />)
    expect(screen.getByText(/No hay datos/)).toBeDefined()
  })

  it('respeta empty state custom como objeto', () => {
    render(
      <DataTable
        data={[]}
        columns={columns}
        rowKey="id"
        emptyState={{ icon: '👀', title: 'Aún no hay clientes', description: 'Crea el primero.' }}
      />
    )
    expect(screen.getByText('Aún no hay clientes')).toBeDefined()
    expect(screen.getByText('Crea el primero.')).toBeDefined()
  })
})

describe('DataTable — interacción', () => {
  it('dispara onRowClick al hacer click en una fila', () => {
    const fn = vi.fn()
    render(<DataTable data={rows} columns={columns} rowKey="id" pageSize={0} onRowClick={fn} />)
    fireEvent.click(screen.getByText('Ana Pérez').closest('tr')!)
    expect(fn).toHaveBeenCalledWith(rows[0])
  })
})

describe('DataTable — loading', () => {
  it('muestra skeletons cuando isLoading=true', () => {
    const { container } = render(
      <DataTable data={rows} columns={columns} rowKey="id" isLoading />
    )
    // 5 filas skeleton × 3 columnas = 15 skeletons
    expect(container.querySelectorAll('.shared-skeleton')).toHaveLength(15)
    // No renderiza tabla real
    expect(screen.queryByText('Ana Pérez')).toBeNull()
  })
})
