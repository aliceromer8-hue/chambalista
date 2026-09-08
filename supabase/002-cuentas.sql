-- Migración: de identificador de navegador a cuentas de verdad.
--
-- POR QUÉ SE CAMBIA
--
-- El primer esquema colgaba los datos de una huella del navegador: sin
-- registro, sin correo. Servía para no perder el CV, pero no para saber
-- QUIÉN postula. Y quien postula está mandando su nombre y su historial
-- a empresas reales: eso no puede salir de un identificador anónimo que
-- cualquiera puede generar.
--
-- Ahora los datos cuelgan de auth.users, que es la tabla de cuentas de
-- Supabase. Se pierde la comodidad de no registrarse y se gana poder
-- responder «esta postulación la mandó esta persona».
--
-- LO QUE ESTO OBLIGA (Ley 29733)
--
-- Guardar correo + CV + historial es tratamiento de datos personales.
-- Hace falta decir para qué se guardan, poder borrarlos a petición, y no
-- usarlos para otra cosa. El borrado ya está: eliminar la cuenta arrastra
-- todo por cascade.

-- ---------------------------------------------------------------------
-- Las tablas pasan a colgar de la cuenta
-- ---------------------------------------------------------------------
-- Se borra y se recrea en vez de migrar filas: en periodo de prueba no
-- hay datos de nadie que conservar, y una migración de datos que no
-- existen es complejidad sin motivo.

drop table if exists postulaciones cascade;
drop table if exists perfiles cascade;
drop table if exists dispositivos cascade;

-- El CV. Uno por cuenta.
create table perfiles (
  usuario       uuid primary key references auth.users(id) on delete cascade,
  datos         jsonb not null,
  actualizado   timestamptz not null default now()
);

-- El historial de postulaciones.
create table postulaciones (
  id            bigint generated always as identity primary key,
  usuario       uuid not null references auth.users(id) on delete cascade,
  url           text not null,
  titulo        text,
  empresa       text,
  portal        text,
  estado        text not null default 'por_postular'
                check (estado in ('por_postular','enviada','entrevista','oferta','descartada','omitida')),
  motivo        text,
  creado        timestamptz not null default now(),
  actualizado   timestamptz not null default now(),
  unique (usuario, url)
);

create index postulaciones_por_usuario on postulaciones (usuario, actualizado desc);

-- ---------------------------------------------------------------------
-- Seguridad
-- ---------------------------------------------------------------------
-- Ahora SÍ hay políticas, y son las que importan: con cuentas de verdad,
-- auth.uid() devuelve quién pide, así que se puede decir «cada quien ve
-- lo suyo y nada más». Sin esto, cualquiera con la clave pública podría
-- leer los CV y los DNI de todos.

alter table perfiles      enable row level security;
alter table postulaciones enable row level security;

create policy "cada quien ve su CV" on perfiles
  for all using (usuario = auth.uid()) with check (usuario = auth.uid());

create policy "cada quien ve sus postulaciones" on postulaciones
  for all using (usuario = auth.uid()) with check (usuario = auth.uid());

-- ---------------------------------------------------------------------
-- Borrado a petición
-- ---------------------------------------------------------------------
-- El derecho a que le borren a uno sus datos no vale nada si no hay
-- forma de ejercerlo. Esto borra el CV y el historial; la cuenta en sí
-- se elimina desde la API de administración.
create or replace function borrar_mis_datos()
returns void
language sql
security definer
set search_path = public
as $$
  delete from postulaciones where usuario = auth.uid();
  delete from perfiles      where usuario = auth.uid();
$$;

-- La tabla de eventos anónimos se queda como estaba: no apunta a nadie
-- y sirve para saber si el producto se usa.
