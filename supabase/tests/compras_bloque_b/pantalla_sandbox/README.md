# Prueba de pantalla de los controles de compras (sandbox)

Comprueba **en la interfaz real** (Vite local → Chromium → sandbox `control-agua-rls-sandbox`) lo que la pantalla de
Operaciones › Órdenes compra ofrece y cómo reacciona cuando el servidor no cambia ninguna fila. **Nunca producción.**

## Qué verifica (15 comprobaciones)
1. **Matriz de botones por perfil** (4 perfiles × 3 órdenes): cada paso se ofrece solo si el perfil tiene la acción
   **y** «Editar» de Contabilidad (lo que el servidor exige). «Autorizar sin Editar» no ve ni Aprobar ni Devolver;
   «Eliminar» no se ofrece en un borrador devuelto/numerado.
2. **Cero filas ≠ éxito**: un perfil sin permiso de borrado pulsa «Eliminar»; el servidor no borra nada y la pantalla
   **avisa** («El servidor no aplicó el cambio…») en vez de callar.
3. Con permiso de borrado (administrador) el borrador sí se borra.

## Cómo se corre
1. Sembrar el padrón **una vez** en el sandbox: `padron_ui_controles.sql.tpl` (sustituir `__PW__`). Aborta si ya existe.
2. Levantar la app apuntando al sandbox, sin archivos `.env`: `VITE_SUPABASE_URL=https://jwpmivhvlstslncrtokb.supabase.co`
   y la llave **pública** de ese proyecto (su payload JWT dice `ref: jwpmivhvlstslncrtokb`); verificar antes que ni la URL
   ni la llave contienen la referencia de producción.
3. `ZZ_UI_PW=… CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node supabase/tests/compras_bloque_b/pantalla_sandbox/pantalla_controles.mjs`
   (`CHROMIUM_PATH` solo hace falta si Playwright no encuentra su navegador; si hay `HTTPS_PROXY`, `127.0.0.1` y `localhost` van directos).

## Salvaguardas del guion
- Toda petición a la referencia de producción se **aborta y se cuenta**; el resumen imprime el destino de red
  (esperado: solo `127.0.0.1` y el host del sandbox) y las peticiones bloqueadas (esperado: 0).
- Sin `ZZ_UI_PW` no corre; la contraseña no se guarda en el repositorio.

## Evidencia (2026-10-09)
Contra la interfaz **anterior** (`a0435c9`): **8/15** (rojo: «Eliminar» ofrecido en borradores devueltos, «Autorizar sin
Editar» viendo Aprobar/Devolver, borrado sin permiso en silencio). Contra la interfaz nueva: **15/15**. Tráfico: solo
`127.0.0.1` y `jwpmivhvlstslncrtokb.supabase.co`; 0 peticiones a producción.
