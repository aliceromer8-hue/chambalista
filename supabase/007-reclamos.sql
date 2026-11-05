-- Libro de Reclamaciones virtual (2026-11-05).
--
-- Cada hoja recibe su número correlativo (CL-AÑO-000001) al registrarse.
-- Solo el servidor escribe y lee (clave de servicio): RLS activado y SIN
-- políticas, así que nadie puede leer los reclamos de otros desde el navegador.
-- Respuesta en un máximo de 15 días hábiles: /admin los lista por antigüedad.
create table if not exists reclamos (
  id              bigint generated always as identity primary key,
  numero          text unique,
  creado          timestamptz not null default now(),
  usuario         uuid references auth.users(id) on delete set null,
  nombre          text not null,
  documento_tipo  text not null default 'DNI',
  documento       text not null,
  domicilio       text not null,
  telefono        text,
  correo          text not null,
  apoderado       text,
  bien_tipo       text not null default 'servicio',
  monto           numeric(10,2),
  descripcion     text not null,
  tipo            text not null check (tipo in ('reclamo', 'queja')),
  detalle         text not null,
  pedido          text not null,
  respuesta       text,
  respondido      timestamptz
);
alter table reclamos enable row level security;
create index if not exists reclamos_pendientes on reclamos (respondido, creado);
