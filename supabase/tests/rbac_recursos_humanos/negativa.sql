-- ════════════════════════════════════════════════════════════════════════════
-- NEGATIVA: la guarda de postcondición tiene que ABORTAR el despliegue.
--
-- Sin esto, el paso 6 de la migración es decorativo: nadie sabría si de verdad
-- se dispara. Aquí se rompe el catálogo a propósito —se renombra un tab, que es
-- exactamente la deriva que la guarda existe para atrapar— y se espera que la
-- migración falle. Si pasa en verde, la guarda no sirve.
-- ════════════════════════════════════════════════════════════════════════════

-- Renombrar el tab simula lo que haría una migración aguas arriba: las policies
-- que gatean sobre `condominios.tab.tareas_cond` quedarían apuntando al vacío.
--
-- Los grants se sueltan primero porque la FK de `permission_key` no lleva
-- ON UPDATE CASCADE: un rename real aguas arriba tendría que hacer lo mismo, y
-- ése es justamente el destrozo que la guarda debe atrapar — el catálogo pierde
-- la clave y nadie avisa.
DELETE FROM public.role_permissions
WHERE permission_key = 'condominios.tab.tareas_cond'
   OR permission_key LIKE 'condominios.tab.tareas\_cond.%';

UPDATE public.permissions
SET key = replace(key, 'condominios.tab.tareas_cond', 'condominios.tab.tareas_condominio')
WHERE key = 'condominios.tab.tareas_cond'
   OR key LIKE 'condominios.tab.tareas\_cond.%';
