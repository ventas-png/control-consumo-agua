# Migración SweetAlert2 → Radix Dialog (F3.2 en curso)

## Por qué

| Aspecto | SweetAlert2 | Radix Dialog (este PR) |
|---|---|---|
| Focus trap accesible | No nativo (a veces se rompe) | Sí, nativo + return-focus al trigger |
| `role="alertdialog"` | Sólo en algunas variantes | Por default |
| `aria-labelledby` / `aria-describedby` | Manual | Automático con `<Title>`/`<Description>` |
| Escape / click outside | Manual config | Default (configurable) |
| CSS theming | Inyecta su propio CSS | Usa CSS vars de la app |
| Tamaño bundle | ~50 KB minified | ~9 KB minified (+ ~3 KB toast) |
| Compatible con CI a11y axe | Falla varias reglas | Pasa baseline |

## API helpers en `src/components/shared/Dialog.tsx`

### `confirm(options)` — reemplaza Swal de confirmación

```ts
import { confirm } from '@/components/shared/Dialog'

const result = await confirm({
  title: '¿Eliminar este item?',
  text: 'Esta acción no se puede deshacer.',
  icon: 'warning',           // 'warning' | 'question' | 'info'
  variant: 'danger',         // styling del botón primario
  confirmText: 'Sí, eliminar',
  cancelText: 'Cancelar',
})

if (result.isConfirmed) {
  // hacer la acción
}
```

**Equivalencias con SweetAlert2** (para migración mecánica):

| SweetAlert2 | Radix `confirm()` |
|---|---|
| `Swal.fire({...}).then(r => r.isConfirmed)` | `(await confirm({...})).isConfirmed` |
| `icon: 'warning'` | `icon: 'warning'` |
| `confirmButtonColor: '#ef4444'` | `variant: 'danger'` |
| `showCancelButton: true` | (default) |
| `confirmButtonText` | `confirmText` |
| `cancelButtonText` | `cancelText` |
| `allowOutsideClick: false` | n/a (Radix permite escape; documentar si imprescindible) |

### `notify(options)` — reemplaza Swal `timer: 1500, showConfirmButton: false`

```ts
import { notify } from '@/components/shared/Dialog'

notify({
  title: 'Guardado',
  text: 'Los cambios se aplicaron correctamente.',
  variant: 'success',   // 'success' | 'error' | 'warning' | 'info'
  duration: 3000,       // ms, 0 = manual close only
})
```

**Equivalencias** (toast, no modal):

| SweetAlert2 | Radix `notify()` |
|---|---|
| `Swal.fire({icon:'success', title:'OK', timer: 1500, showConfirmButton: false})` | `notify({variant:'success', title:'OK', duration: 1500})` |
| `Swal.fire({icon:'error', title:'Error', text: msg})` | `notify({variant:'error', title:'Error', text: msg})` |

## Setup global

`DialogProvider` ya está montado en `src/main.tsx` envolviendo `<App />`. No requiere setup adicional por componente — solo importar `confirm`/`notify` donde se necesite.

## Plan de migración por lotes

Hay **~178 `Swal.fire` callsites** distribuidos así:

| Categoría (por `icon`) | Cantidad | Patrón típico |
|---|---|---|
| `warning` | 109 | Confirmaciones destructivas → migrar a `confirm({variant:'danger'})` |
| `success` | 87 | Toast de "guardado" → migrar a `notify({variant:'success'})` |
| `error` | 49 | Error display → `notify({variant:'error'})` |
| `question` | 6 | Confirms con custom buttons → `confirm({icon:'question'})` |

### Cobertura este PR (F3.2)

| Archivo | Reemplazos | Pattern |
|---|---|---|
| `src/hooks/useAuth.ts` | 3 (logout + 2 session warnings) | `Swal.fire` → `confirm` |

**Total migrado: 3 / ~178**. Resto queda para PRs siguientes.

### Plan F3.2b / F3.3 / F3.4

Para no saturar este PR, los lotes siguientes:

- **F3.2b**: módulo `PerfilSection` + `EmpresaSection` + `GoogleEmailConfig` (~25 Swal)
- **F3.3**: módulo agua tabs (`RutasTab`, `HistorialTab`, etc., ~30 Swal) → coincide con admin responsive
- **F3.4**: módulo condominios tabs (~90 Swal, el gros)
- **F3.5**: superadmin + portal residente (~30 Swal)

Cuando los **178** estén migrados se elimina `sweetalert2` de `package.json` y se ahorra ~50 KB del bundle.

## Hasta que se complete la migración

Los dos APIs coexisten. No es necesario migrar todo de un solo PR — cada archivo que se toque por otra razón es oportunidad para migrar sus `Swal.fire` en el mismo commit.

## Edge case: `allowOutsideClick: false`

SweetAlert2 permitía bloquear escape + click-outside. En Radix esto requiere:

```tsx
<AlertDialog.Root open={true} modal>  // modal=true bloquea outside
  <AlertDialog.Content
    onEscapeKeyDown={(e) => e.preventDefault()}
    onInteractOutside={(e) => e.preventDefault()}
  >
```

Para flows críticos donde el usuario NO debe poder cerrar (ej: bloqueante de pago obligatorio), construir un componente custom usando los primitives de Radix directamente. `confirm()` siempre permite cierre (UX recomendada para WCAG).
