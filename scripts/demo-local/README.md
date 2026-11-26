# Copia local del sistema con una empresa demo

Levanta AdministraTodo completo en esta máquina, con una empresa de demostración, para probar flujos con clics reales y
sacar capturas de manuales. **Nada sale de la máquina**: no toca producción ni el sandbox.

| Pieza | Qué es |
|---|---|
| PostgreSQL 16 (`/tmp/demo-pgdata`, socket `/tmp/demosock`, puerto 55700) | Base `demo` con el andamiaje de Supabase (`scripts/schema-drift/bootstrap.sql`) y **todas** las migraciones |
| PostgREST 12.2.3 (`127.0.0.1:54330`) | La misma API que usa Supabase. Binario de la imagen oficial `postgrest/postgrest:v12.2.3`, bajado del espejo de Docker Hub de Google y verificado por sha256 |
| `pasarela.mjs` (`127.0.0.1:54321`) | Imita Supabase: `/rest/v1` → PostgREST; `/auth/v1` con usuarios y contraseñas de `auth.users`; `/storage/v1` en disco (`storage/`); `/functions/v1` vacío; sin tiempo real |
| App (`127.0.0.1:5173`) | `vite` del repo con `VITE_SUPABASE_URL` apuntando a la pasarela |

```bash
bash scripts/demo-local/levantar.sh      # la primera vez tarda unos minutos: aplica todas las migraciones
bash scripts/demo-local/detener.sh
```

## Empresa demo (`semilla.sql`)

«Prestadora Demo» con el condominio «Condominio Demo» (servicio Condominios). La clave de los tres usuarios se genera al
sembrar y queda en `scripts/demo-local/.credenciales` (fuera de git).

| Usuario | Papel |
|---|---|
| `admin@demo.local` | Dueño de la empresa |
| `supervisor@demo.local` | Rol «Supervisor de limpieza»: Limpieza ver, crear, editar, eliminar |
| `ana@demo.local` | Rol «Personal de limpieza»: Limpieza ver y editar (vinculada a la empleada Ana Pérez) |

Catálogos: 6 áreas, 3 insumos y 5 equipos de limpieza, 3 empleados (Ana, Luis, Marta), 6 actividades de limpieza con
duración, checklist, foto, insumos y herramientas, 3 jornadas con descansos (Diurna D, Tarde T, Sábado S), 4 reglas de
turno y 2 rutinas («Limpieza de Lobby», «Barrido de Pasillos y Gradas»). Los turnos **no** vienen creados: se generan
desde la pantalla, igual que en el sistema real.

`ajustes.sql` es lo único que difiere de Supabase: `auth.uid()`, `auth.role()` y `auth.email()` leen el token como lo
publica PostgREST 12 (`request.jwt.claims`), y el rol `authenticator` puede entrar.

## Recorridos con clics (`recorridos/`)

Playwright sobre la app local, con el Chromium del sistema. Cada paso imprime `OK` o `MAL` y deja capturas en `fotos/`.
Usan las fechas del día (zona America/Guatemala): conviene correrlos en un día hábil.

```bash
node scripts/demo-local/recorridos/r1_admin.mjs       # generar turnos, armar una rutina en el editor, asignar con ＋, arrastrar y quitar
node scripts/demo-local/recorridos/r2_ruta.mjs        # Ana ejecuta su ruta y la de Luis: preparación, checklist, foto, novedad, omitir, cierre
node scripts/demo-local/recorridos/r3_supervisor.mjs  # indicadores, marcar novedad atendida, lo cerrado o pasado ya no se toca
```

Para empezar de cero: `detener.sh`, borrar `/tmp/demo-pgdata` y volver a `levantar.sh`.
