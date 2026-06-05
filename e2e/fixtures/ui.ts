import { type Locator, type Page } from '@playwright/test'

// Selecciona la primera opción "real" (value no vacío) de un <select>. Devuelve
// el value elegido, o null si el select no tiene opciones reales (datos sin
// sembrar) — el caller decide skipear en runtime.
export async function chooseFirstRealOption(select: Locator): Promise<string | null> {
  const values = await select.locator('option').evaluateAll((opts) =>
    (opts as HTMLOptionElement[])
      .map((o) => o.value)
      .filter((v) => v !== '' && v != null),
  )
  if (values.length === 0) return null
  await select.selectOption(values[0])
  return values[0]
}

// ¿Existe al menos un elemento que matchee? Útil para guardas de runtime sobre
// datos sembrados (botón de acción presente, fila pendiente, etc.).
export async function exists(locator: Locator): Promise<boolean> {
  return (await locator.count()) > 0
}

// Navega a una sección por su ruta (las rutas son URL-based, ver src/lib/routes.ts).
export async function gotoSection(page: Page, path: string): Promise<void> {
  await page.goto(path)
  await page.waitForLoadState('networkidle').catch(() => {})
}
