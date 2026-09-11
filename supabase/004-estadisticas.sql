-- Leer el embudo sin tener que escribir SQL cada vez.
--
-- La tabla `eventos` guarda una fila por cosa que pasa. Estas vistas la
-- convierten en las preguntas que de verdad se hacen.
--
-- NADA DE ESTO IDENTIFICA A NADIE
--
-- `eventos` no tiene columna de usuario y el detalle solo admite valores
-- de una lista cerrada (ver CAMPOS_MEDIBLES en app_web.py). Así que esto
-- responde «cuántas postulaciones se enviaron ayer en Computrabajo» y no
-- puede responder «qué hizo fulano», que es exactamente la línea que la
-- política promete.

-- ---------------------------------------------------------------------
-- El embudo por día
-- ---------------------------------------------------------------------
create or replace view embudo_diario as
select
  dia,
  count(*) filter (where tipo = 'pagina_vista')          as visitas,
  count(*) filter (where tipo = 'cuenta_creada')         as cuentas,
  count(*) filter (where tipo = 'cv_convertido')         as cv_convertidos,
  count(*) filter (where tipo = 'sugerencias_vistas')    as vieron_puestos,
  count(*) filter (where tipo = 'extension_descargada')  as instalaron,
  count(*) filter (where tipo = 'busqueda')              as busquedas,
  count(*) filter (where tipo = 'postulacion_preparada') as preparadas,
  count(*) filter (where tipo = 'postulacion_enviada')   as enviadas,
  count(*) filter (where tipo = 'postulacion_omitida')   as omitidas,
  count(*) filter (where tipo = 'cuenta_borrada')        as bajas
from eventos
group by dia
order by dia desc;

-- ---------------------------------------------------------------------
-- Dónde se cae la gente
-- ---------------------------------------------------------------------
-- Los dos saltos que deciden si el producto existe:
--
--   visita -> cuenta      cuánto cuesta la puerta. Se puso delante de
--                         todo y nadie ha medido nunca lo que cuesta.
--   cv -> enviada         el salto de verdad. Convertir un CV lo hace
--                         mucha gente; postular solo, nosotros. Si la
--                         gente convierte y no llega a postular, el
--                         producto no es lo que creemos que es.
create or replace view saltos as
select
  dia, visitas, cuentas, cv_convertidos, instalaron, enviadas,
  round(100.0 * cuentas        / nullif(visitas, 0), 1)        as pct_se_registran,
  round(100.0 * cv_convertidos / nullif(cuentas, 0), 1)        as pct_convierten_cv,
  round(100.0 * instalaron     / nullif(cv_convertidos, 0), 1) as pct_instalan,
  round(100.0 * enviadas       / nullif(cv_convertidos, 0), 1) as pct_llegan_a_postular
from embudo_diario;

-- ---------------------------------------------------------------------
-- Por portal, y por qué se omite
-- ---------------------------------------------------------------------
create or replace view por_portal as
select
  detalle->>'portal' as portal,
  count(*) filter (where tipo = 'busqueda')              as busquedas,
  count(*) filter (where tipo = 'postulacion_preparada') as preparadas,
  count(*) filter (where tipo = 'postulacion_enviada')   as enviadas,
  count(*) filter (where tipo = 'postulacion_omitida')   as omitidas
from eventos
where detalle ? 'portal'
group by 1
order by enviadas desc nulls last;

-- Los motivos por los que una postulación no sale. Esto es la lista de
-- tareas ordenada por cuánto duele cada una.
create or replace view motivos_de_omision as
select detalle->>'motivo' as motivo, count(*) as veces
from eventos
where tipo = 'postulacion_omitida'
group by 1
order by veces desc;

-- ---------------------------------------------------------------------
-- Salud del modelo
-- ---------------------------------------------------------------------
-- Si `reglas` sube, el modelo está degradado y el producto está
-- funcionando a medias sin avisar. Ya pasó un día entero así.
create or replace view salud_ia as
select dia,
       count(*) filter (where detalle->>'con' = 'ia')     as con_modelo,
       count(*) filter (where detalle->>'con' = 'reglas') as por_reglas
from eventos
where tipo = 'cv_convertido'
group by dia
order by dia desc;
