import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react'
import { DataTable, type DataTableColumn } from '../DataTable'
import { checkA11y } from '../../../test/a11y'

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

describe('DataTable — footer (totals row)', () => {
  const footer = (
    <tr>
      <td>TOTAL</td>
      <td style={{ textAlign: 'right' }}>93.5</td>
      <td>—</td>
    </tr>
  )

  it('renderiza el contenido del footer dentro de <tfoot>', () => {
    const { container } = render(
      <DataTable data={rows} columns={columns} rowKey="id" footer={footer} />,
    )
    const tfoot = container.querySelector('tfoot')
    expect(tfoot).not.toBeNull()
    expect(within(tfoot as HTMLElement).getByText('TOTAL')).toBeDefined()
    expect(within(tfoot as HTMLElement).getByText('93.5')).toBeDefined()
  })

  it('omite <tfoot> cuando no se pasa footer', () => {
    const { container } = render(
      <DataTable data={rows} columns={columns} rowKey="id" />,
    )
    expect(container.querySelector('tfoot')).toBeNull()
  })

  it('omite <tfoot> en estado vacio', () => {
    const { container } = render(
      <DataTable data={[] as Row[]} columns={columns} rowKey="id" footer={footer} />,
    )
    expect(container.querySelector('tfoot')).toBeNull()
  })

  it('footer respeta colSpan para fusionar columnas', () => {
    const colSpanFooter = (
      <tr>
        <td colSpan={2}>TOTALES</td>
        <td>93.5</td>
      </tr>
    )
    const { container } = render(
      <DataTable data={rows} columns={columns} rowKey="id" footer={colSpanFooter} />,
    )
    const totalCell = container.querySelector('tfoot td[colspan="2"]')
    expect(totalCell).not.toBeNull()
    expect(totalCell?.textContent).toBe('TOTALES')
  })
})

describe('DataTable — expandedContent (row expansion)', () => {
  it('no renderiza expand-row si isRowExpanded retorna false', () => {
    const { container } = render(
      <DataTable
        data={rows}
        columns={columns}
        rowKey="id"
        isRowExpanded={() => false}
        expandedContent={r => <div>Detalle de {r.nombre}</div>}
      />,
    )
    expect(container.textContent).not.toContain('Detalle de Ana Pérez')
    // 4 filas normales + 0 expand
    expect(container.querySelectorAll('tbody tr')).toHaveLength(4)
  })

  it('renderiza una fila adicional con colSpan cuando isRowExpanded es true', () => {
    const { container } = render(
      <DataTable
        data={rows}
        columns={columns}
        rowKey="id"
        isRowExpanded={r => r.id === '1'}
        expandedContent={r => <div>Detalle de {r.nombre}</div>}
      />,
    )
    expect(container.textContent).toContain('Detalle de Ana Pérez')
    // 4 filas normales + 1 expand = 5
    expect(container.querySelectorAll('tbody tr')).toHaveLength(5)
    // El colSpan debe coincidir con número de columnas
    const expandCell = container.querySelector(`td[colspan="${columns.length}"]`)
    expect(expandCell).not.toBeNull()
  })

  it('omite expand-row si expandedContent retorna null', () => {
    const { container } = render(
      <DataTable
        data={rows}
        columns={columns}
        rowKey="id"
        isRowExpanded={() => true}
        expandedContent={() => null}
      />,
    )
    // Aunque todas están "expandidas", null evita la fila
    expect(container.querySelectorAll('tbody tr')).toHaveLength(4)
  })

  it('expand-row coexiste con sort/search sin romper', () => {
    const { container } = render(
      <DataTable
        data={rows}
        columns={columns}
        rowKey="id"
        searchableKeys={['nombre']}
        isRowExpanded={r => r.id === '3'}
        expandedContent={r => <div>Det {r.nombre}</div>}
      />,
    )
    fireEvent.change(screen.getByPlaceholderText(/buscar/i), { target: { value: 'María' } })
    // Solo "María Sol" pasa el filtro + su expand-row = 2 filas
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(container.textContent).toContain('Det María Sol')
  })
})

describe('DataTable — server pagination mode', () => {
  it('no filtra ni ordena en server mode (data es lo que se renderiza)', () => {
    const { container } = render(
      <DataTable
        data={rows}
        columns={columns}
        rowKey="id"
        paginationMode="server"
        currentPage={0}
        onPageChange={() => {}}
        searchableKeys={['nombre']}
      />,
    )
    // Aunque hay search input, escribir no debe filtrar (server lo hace).
    fireEvent.change(screen.getByPlaceholderText(/buscar/i), { target: { value: 'Ana' } })
    // Las 4 filas siguen renderizadas (DataTable no las filtra)
    expect(container.querySelectorAll('tbody tr')).toHaveLength(4)
  })

  it('llama onPageChange al hacer click en Siguiente (heuristica hasMore)', () => {
    const onPageChange = vi.fn()
    // pageSize=4, data.length=4 → hasMore = true (asume hay mas)
    render(
      <DataTable
        data={rows}
        columns={columns}
        rowKey="id"
        paginationMode="server"
        currentPage={0}
        pageSize={4}
        onPageChange={onPageChange}
      />,
    )
    fireEvent.click(screen.getByText(/Siguiente/))
    expect(onPageChange).toHaveBeenCalledWith(1)
  })

  it('deshabilita Siguiente cuando data.length < pageSize (sin totalRows)', () => {
    // pageSize=10, data.length=4 → hasMore = false
    render(
      <DataTable
        data={rows}
        columns={columns}
        rowKey="id"
        paginationMode="server"
        currentPage={0}
        pageSize={10}
        onPageChange={() => {}}
      />,
    )
    const sigBtn = screen.getByText(/Siguiente/).closest('button')!
    expect(sigBtn.hasAttribute('disabled')).toBe(true)
  })

  it('usa totalRows para calcular totalPages cuando se provee', () => {
    render(
      <DataTable
        data={rows}
        columns={columns}
        rowKey="id"
        paginationMode="server"
        currentPage={0}
        pageSize={4}
        totalRows={20}
        onPageChange={() => {}}
      />,
    )
    expect(screen.getByText(/Página 1 de 5/)).toBeDefined()
    expect(screen.getByText(/4 eventos \(de 20\)/)).toBeDefined()
  })

  it('deshabilita Anterior cuando currentPage = 0', () => {
    render(
      <DataTable
        data={rows}
        columns={columns}
        rowKey="id"
        paginationMode="server"
        currentPage={0}
        pageSize={4}
        totalRows={20}
        onPageChange={() => {}}
      />,
    )
    const antBtn = screen.getByText(/Anterior/).closest('button')!
    expect(antBtn.hasAttribute('disabled')).toBe(true)
  })
})

describe('DataTable — mobile responsive', () => {
  it('aplica clase table-col-secondary a celdas con hideOnMobile=true', () => {
    const cols: DataTableColumn<Row>[] = [
      { key: 'nombre', header: 'Nombre' },
      { key: 'consumo', header: 'Consumo', hideOnMobile: true },
      { key: 'estado', header: 'Estado' },
    ]
    const { container } = render(<DataTable data={rows} columns={cols} rowKey="id" pageSize={0} />)
    const hiddenCells = container.querySelectorAll('.table-col-secondary')
    // 1 header + 4 row cells = 5
    expect(hiddenCells.length).toBe(5)
  })

  it('NO aplica table-col-secondary cuando hideOnMobile es false/undefined', () => {
    const { container } = render(<DataTable data={rows} columns={columns} rowKey="id" pageSize={0} />)
    expect(container.querySelectorAll('.table-col-secondary').length).toBe(0)
  })

  it('stickyFirstColumn aplica clase table-col-sticky solo a la primera columna', () => {
    const { container } = render(
      <DataTable data={rows} columns={columns} rowKey="id" stickyFirstColumn pageSize={0} />
    )
    const stickyCells = container.querySelectorAll('.table-col-sticky')
    // 1 header + 4 rows = 5 celdas en la primera columna
    expect(stickyCells.length).toBe(5)
    // La primera columna es 'Nombre'
    const firstHeader = container.querySelector('th.table-col-sticky')
    expect(firstHeader?.textContent).toContain('Nombre')
  })

  it('stickyFirstColumn no afecta la segunda columna', () => {
    const { container } = render(
      <DataTable data={rows} columns={columns} rowKey="id" stickyFirstColumn pageSize={0} />
    )
    const allHeaders = container.querySelectorAll('th')
    expect(allHeaders[0].classList.contains('table-col-sticky')).toBe(true)
    expect(allHeaders[1].classList.contains('table-col-sticky')).toBe(false)
    expect(allHeaders[2].classList.contains('table-col-sticky')).toBe(false)
  })

  it('combina hideOnMobile + stickyFirstColumn en classNames diferentes', () => {
    const cols: DataTableColumn<Row>[] = [
      { key: 'nombre', header: 'Nombre' },
      { key: 'consumo', header: 'Consumo', hideOnMobile: true },
      { key: 'estado', header: 'Estado' },
    ]
    const { container } = render(
      <DataTable data={rows} columns={cols} rowKey="id" stickyFirstColumn pageSize={0} />
    )
    const headers = container.querySelectorAll('th')
    expect(headers[0].className).toContain('table-col-sticky')
    expect(headers[0].className).not.toContain('table-col-secondary')
    expect(headers[1].className).toContain('table-col-secondary')
    expect(headers[1].className).not.toContain('table-col-sticky')
  })

  it('usa .table-scroll-wrapper para overflow horizontal', () => {
    const { container } = render(<DataTable data={rows} columns={columns} rowKey="id" pageSize={0} />)
    expect(container.querySelector('.table-scroll-wrapper')).toBeTruthy()
  })

  it('mobileCardLayout=true agrega la clase .table-cards-on-mobile al <table>', () => {
    const { container } = render(
      <DataTable data={rows} columns={columns} rowKey="id" mobileCardLayout pageSize={0} />
    )
    expect(container.querySelector('table.table-cards-on-mobile')).toBeTruthy()
  })

  it('mobileCardLayout=false (default) NO aplica la clase', () => {
    const { container } = render(<DataTable data={rows} columns={columns} rowKey="id" pageSize={0} />)
    expect(container.querySelector('table.table-cards-on-mobile')).toBeNull()
  })

  it('mobileCardLayout agrega data-label a cada <td> con el header como string', () => {
    const { container } = render(
      <DataTable data={rows} columns={columns} rowKey="id" mobileCardLayout pageSize={0} />
    )
    const firstRowCells = container.querySelectorAll('tbody tr:first-child td')
    expect(firstRowCells[0].getAttribute('data-label')).toBe('Nombre')
    expect(firstRowCells[1].getAttribute('data-label')).toBe('Consumo')
    expect(firstRowCells[2].getAttribute('data-label')).toBe('Estado')
  })

  it('mobileCardLayout NO agrega data-label cuando esta off', () => {
    const { container } = render(
      <DataTable data={rows} columns={columns} rowKey="id" pageSize={0} />
    )
    const firstCell = container.querySelector('tbody tr:first-child td')
    expect(firstCell?.hasAttribute('data-label')).toBe(false)
  })

  it('mobileCardLayout fallback a col.key cuando header no es string', () => {
    const cols: DataTableColumn<Row>[] = [
      { key: 'nombre', header: <span>Nombre rico</span> }, // ReactNode, no string
      { key: 'estado', header: 'Estado' },
    ]
    const { container } = render(
      <DataTable data={rows} columns={cols} rowKey="id" mobileCardLayout pageSize={0} />
    )
    const firstRowCells = container.querySelectorAll('tbody tr:first-child td')
    expect(firstRowCells[0].getAttribute('data-label')).toBe('nombre') // fallback al key
    expect(firstRowCells[1].getAttribute('data-label')).toBe('Estado')
  })
})

describe('DataTable — a11y baseline', () => {
  it('renderiza sin violaciones de accesibilidad', async () => {
    const { container } = render(
      <DataTable data={rows} columns={columns} rowKey="id" />
    )
    await checkA11y(container)
  })

  it('estado vacio no introduce violaciones', async () => {
    const { container } = render(
      <DataTable data={[] as Row[]} columns={columns} rowKey="id" emptyState={{ title: 'Sin datos' }} />
    )
    await checkA11y(container)
  })
})
