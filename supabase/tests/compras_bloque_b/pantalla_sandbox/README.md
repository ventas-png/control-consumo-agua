# Prueba de pantalla de los controles de compras (sandbox)

Comprueba **en la interfaz real** (Vite local → Chromium → sandbox `control-agua-rls-sandbox`) lo que la pantalla de
Operaciones › Órdenes compra ofrece y cómo reacciona cuando el servidor no cambia ninguna fila. **Nunca producción.**

## Qué verifica (18 comprobaciones: 5 perfiles × 3 órdenes + 3 de borrado)
1. **Matriz de botones por perfil** (5 perfiles × 3 órdenes): cada paso se ofrece solo si el perfil tiene la llave de la
   acción **y** «Editar» de Contabilidad (lo que el servidor exige). Aprobar una orden y devolver una aprobada exigen la
   llave de la pestaña (`condominios.tab.ordenes_compra.approve`), no el «Autorizar / Denegar» genérico de Contabilidad (D1):
   por eso «Autorizar + Editar» y «Autorizar sin Editar» la reciben en el padrón. «Autorizar sin Editar» no ve ni Aprobar ni
   Devolver (falta «Editar»); el cuarto perfil **«solo genérico»** (genérico + «Editar», SIN la llave de la orden) tampoco:
   es el que prueba, en la interfaz real, que el genérico ya no basta. «Eliminar» no se ofrece en un borrador devuelto/numerado.
2. **Cero filas ≠ éxito**: un perfil sin permiso de borrado pulsa «Eliminar»; el servidor no borra nada y la pantalla
   **avisa** («El servidor no aplicó el cambio…») en vez de callar.
3. Con permiso de borrado (administrador) el borrador sí se borra.

## Cómo se corre
1. Sembrar el padrón **una vez** en el sandbox: `padron_ui_controles.sql.tpl` (sustituir `__PW__`). Aborta si ya existe.
   Un padrón sembrado con la versión anterior (4 perfiles, sin la llave de la orden en `rq` ni `rs`) se pone al día con
   `padron_ui_controles_actualizacion.sql.tpl` (sustituir `__PW__` por la MISMA contraseña): aditivo e idempotente, concede la llave
   a esos dos roles y crea el cuarto perfil; no borra ni modifica nada. Ninguna de las dos plantillas se aplica desde este repositorio:
   las ejecuta quien administra el sandbox. Ambas se comprobaron sobre bases locales desechables (la actualización sobre un padrón viejo
   deja exactamente las mismas filas que la plantilla completa sobre una base limpia).
2. Levantar la app apuntando al sandbox, sin archivos `.env`: `VITE_SUPABASE_URL=https://jwpmivhvlstslncrtokb.supabase.co`
   y la llave **pública** de ese proyecto (su payload JWT dice `ref: jwpmivhvlstslncrtokb`); verificar antes que ni la URL
   ni la llave contienen la referencia de producción.
3. `ZZ_UI_PW=… CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node supabase/tests/compras_bloque_b/pantalla_sandbox/pantalla_controles.mjs`
   (`CHROMIUM_PATH` solo hace falta si Playwright no encuentra su navegador; si hay `HTTPS_PROXY`, `127.0.0.1` y `localhost` van directos).

## Salvaguardas del guion
- Toda petición a la referencia de producción se **aborta y se cuenta**; el resumen imprime el destino de red
  (esperado: solo `127.0.0.1` y el host del sandbox) y las peticiones bloqueadas (esperado: 0).
- Sin `ZZ_UI_PW` no corre; la contraseña no se guarda en el repositorio.

## Contraste automático sin sandbox
`src/components/condominios/tabs/__tests__/padronSandbox.test.tsx` (vitest, corre en el CI) lee las filas de
`padron_ui_controles.sql.tpl` y el `ESPERADO` de `pantalla_controles.mjs`, monta la pantalla real de Órdenes compra con las llaves de
cada perfil y exige que ofrezca exactamente los botones esperados. No sustituye la corrida contra el sandbox (no prueba el servidor ni
la sesión real), pero evita que la plantilla, el guion y la pantalla vuelvan a divergir sin que nadie se entere.

## Evidencia — PENDIENTE de repetir
**Estas cifras son históricas y NO valen para la versión actual del guion.** Se tomaron el 2026-10-09 con el guion de 4 perfiles
(15 comprobaciones) y una pantalla anterior a las llaves por acción: contra la interfaz **anterior** (`a0435c9`) **8/15** (rojo:
«Eliminar» ofrecido en borradores devueltos, «Autorizar sin Editar» viendo Aprobar/Devolver, borrado sin permiso en silencio);
contra la interfaz de entonces **15/15**; tráfico solo `127.0.0.1` y `jwpmivhvlstslncrtokb.supabase.co`, 0 peticiones a producción.
Con la pantalla y el padrón actuales (5 perfiles, 18 comprobaciones) **todavía no hay corrida contra el sandbox**: la cifra y el
tráfico de red se anotan aquí cuando quien administra el sandbox ponga al día el padrón y vuelva a correr el guion.
