-- Chamba Lista — esquema de la base de datos.
--
-- Se ejecuta una vez en el editor SQL de Supabase.
--
-- CÓMO SE IDENTIFICA A CADA PERSONA
--
-- Por un identificador de dispositivo que genera la extensión, no por
-- una cuenta. Nadie se registra, nadie da un correo. El identificador es
-- un UUID aleatorio que vive en el navegador de la persona y viaja en la
-- cabecera X-Dispositivo, que ya se usaba para la cuota de IA.
--
-- Lo que eso significa, dicho claro: si la persona borra los datos del
-- navegador o cambia de computadora, pierde el acceso a lo guardado. No
-- hay forma de recuperarlo, porque no hay nada que la vincule a esos
-- datos. Es el precio de no pedir un correo, y es una decisión, no un
-- descuido. El día que haya que cobrar hará falta una cuenta de verdad y
-- entonces se añade un correo a esta misma tabla.
--
-- POR QUÉ TODO ESTO LLEVA RLS
--
-- El servidor usa la clave de servicio, que se salta las políticas. Pero
-- si algún día una clave anónima llega al navegador —y en un producto
-- web es cuestión de tiempo—, sin RLS cualquiera podría leer la tabla
-- entera: los CV, los DNI y las postulaciones de todo el mundo. Las
-- políticas de abajo dejan la lectura pública imposible por defecto.

-- ---------------------------------------------------------------------
-- Dispositivos
-- ---------------------------------------------------------------------
create table if not exists dispositivos (
  id            uuid primary key default gen_random_uuid(),
  -- El identificador que manda la extensión. Se guarda con hash: si
  -- alguien se lleva un volcado de la base, no le sirve para hacerse
  -- pasar por nadie.
  huella        text unique not null,
  creado        timestamptz not null default now(),
  visto         timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- El CV
-- ---------------------------------------------------------------------
-- Un perfil por dispositivo. `datos` es el JSON del CV estructurado, tal
-- como lo produce cv_parser: nombre, contacto y las ocho secciones.
create table if not exists perfiles (
  dispositivo   uuid primary key references dispositivos(id) on delete cascade,
  datos         jsonb not null,
  actualizado   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Postulaciones
-- ---------------------------------------------------------------------
-- Esto es lo que de verdad duele perder: el historial de dónde postuló y
-- en qué quedó cada una. Vivía solo en el navegador.
create table if not exists postulaciones (
  id            bigint generated always as identity primary key,
  dispositivo   uuid not null references dispositivos(id) on delete cascade,
  url           text not null,
  titulo        text,
  empresa       text,
  portal        text,
  estado        text not null default 'por_postular'
                check (estado in ('por_postular','enviada','entrevista','oferta','descartada','omitida')),
  motivo        text,
  creado        timestamptz not null default now(),
  actualizado   timestamptz not null default now(),
  -- La misma vacante no se anota dos veces para la misma persona.
  unique (dispositivo, url)
);

create index if not exists postulaciones_por_dispositivo
  on postulaciones (dispositivo, actualizado desc);

-- ---------------------------------------------------------------------
-- Métricas anónimas
-- ---------------------------------------------------------------------
-- Sin dispositivo y sin nada que apunte a una persona: solo cuenta qué
-- pasa, para saber si el producto funciona y dónde falla el parser.
create table if not exists eventos (
  id            bigint generated always as identity primary key,
  tipo          text not null,
  detalle       jsonb,
  dia           date not null default current_date,
  creado        timestamptz not null default now()
);

create index if not exists eventos_por_dia on eventos (dia, tipo);

-- ---------------------------------------------------------------------
-- Seguridad
-- ---------------------------------------------------------------------
-- RLS activo y SIN políticas de acceso público. Con esto, una clave
-- anónima no puede leer ni escribir nada: solo la clave de servicio, que
-- vive en el servidor y nunca sale de ahí.
alter table dispositivos   enable row level security;
alter table perfiles       enable row level security;
alter table postulaciones  enable row level security;
alter table eventos        enable row level security;

-- Se dejan escritas y comentadas las políticas que harían falta el día
-- que se pase a cuentas de verdad con Supabase Auth. Sin cuentas,
-- auth.uid() es nulo y estas políticas no dejarían pasar nada, que es
-- justo lo que se quiere ahora.
--
-- create policy "cada quien ve lo suyo" on perfiles
--   for all using (dispositivo = auth.uid()) with check (dispositivo = auth.uid());
-- create policy "cada quien ve sus postulaciones" on postulaciones
--   for all using (dispositivo = auth.uid()) with check (dispositivo = auth.uid());

-- ---------------------------------------------------------------------
-- Borrado
-- ---------------------------------------------------------------------
-- La Ley 29733 da derecho a que le borren a uno sus datos. Con el
-- cascade de arriba, borrar el dispositivo borra el CV y las
-- postulaciones. Esta función lo deja en una sola llamada.
create or replace function borrar_dispositivo(huella_dada text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from dispositivos where huella = huella_dada;
$$;
