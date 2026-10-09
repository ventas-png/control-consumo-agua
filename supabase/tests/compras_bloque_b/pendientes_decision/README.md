# Pendientes de decisión de negocio (fuera de `run.sh`)

Estos archivos **no forman parte de la migración `20261027000800` ni de la batería**: son hallazgos confirmados o
prototipos verificados cuya aplicación cambia una regla del negocio. Se dejan aquí para que, tomada la decisión, se
conviertan en una migración nueva (incremental, nunca editando las ya aplicadas).

| Archivo | Qué es | Decisión (docs/COMPRAS_CONTROLES_SERVIDOR.md §6) |
|---|---|---|
| `RG-4.prueba.sql` | Prueba **roja hoy**: «1-23» y «12-3» (serie y correlativo distintos) se rechazan como duplicado | **P-6** |
| `RG-4.alternativa_A.sql` | Alternativa A (equivalencia que respeta el separador): bloquea 10/10 duplicados reales y deja pasar 5/5 distintos. Con ella `RG-4.prueba.sql` queda verde | **P-6** |
| `RG-4.comparacion.sql`, `RG-4.comparacion_resultados.txt` | Las seis variantes medidas sobre 20 pares reales (10 duplicados, 5 distintos legítimos, 5 ambiguos) | **P-6** |
| `P-2.interruptor_solo_admin.sql` | Deja el interruptor `compras_config.aprobacion_separada` solo en manos del administrador de la empresa (`COMPRAS_CONFIG_SEPARACION_SOLO_ADMIN`) | **P-2** |
| `P-2.interruptor_solo_admin.prueba.sql` | Su prueba (verde con el SQL anterior aplicado; roja sin él) | **P-2** |

Cómo probarlos: levantar la base de la batería (`run.sh` deja una; o aplicar la cadena de migraciones en un PostgreSQL
desechable), aplicar el `.sql` de la alternativa y correr la prueba con `psql -v ON_ERROR_STOP=1 -f`.
