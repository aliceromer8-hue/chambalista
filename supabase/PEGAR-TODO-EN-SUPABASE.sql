-- Pega TODO esto en Supabase → SQL Editor → New query → Run. Se puede correr más de una vez sin romper nada.

-- ═══════════════ 005-uso-ia.sql ═══════════════
-- Cuota de IA por CUENTA, persistente (2026-09-25).
--
-- Antes la cuota vivía en la memoria de cada instancia de Vercel y se
-- contaba por un identificador que manda el navegador: se podía saltar
-- cambiándolo o esperando a que la instancia se reiniciara, y cada salto
-- gasta la clave de Gemini del servidor.
--
-- Una fila por llamada al modelo. Solo el servidor escribe y lee (clave de
-- servicio): RLS activado y SIN políticas, así que desde el navegador no
-- se ve ni se toca nada.
create table if not exists uso_ia (
  id       bigint generated always as identity primary key,
  usuario  uuid not null references auth.users(id) on delete cascade,
  creado   timestamptz not null default now()
);
create index if not exists uso_ia_por_usuario on uso_ia (usuario, creado desc);
alter table uso_ia enable row level security;

-- Limpieza: lo de más de 3 días no sirve para nada.
-- (Opcional, si activas pg_cron:)
-- select cron.schedule('limpiar-uso-ia', '0 5 * * *', $$delete from uso_ia where creado < now() - interval '3 days'$$);

-- ═══════════════ 006-saldos.sql ═══════════════
-- Saldo de postulaciones por cuenta, packs, pase, referidos y avisos de
-- pago (2026-10-02, revisado el mismo día: lo gratis son 12 POSTULACIONES,
-- no 12 días).
--
-- Sin pasarela: se cobra por Yape/Plin (sin comisión). La persona pulsa
-- «Ya yapeé» (aviso de pago), Ali lo comprueba en su Yape y lo acredita
-- con un clic desde /admin. Ver saldo.py.
--
--   postulaciones  las que le quedan (regaladas + compradas - usadas)
--   regaladas      total histórico regalado: 12 al crear + bonos de invitar
--   compradas      total histórico comprado en packs
--   pase_hasta     mientras no venza, postula sin descontar (con el tope
--                  diario seguro); lo que tenga en postulaciones se guarda
--   codigo         su código para invitar (8 caracteres)
--   referido_por   quién la invitó (una sola vez por cuenta)
--   bono_pagado    si quien la invitó ya cobró su bono (se paga cuando la
--                  invitada envía su PRIMERA postulación: cuentas falsas
--                  para sumar bonos no sirven de nada)
--
-- Solo el servidor escribe (clave de servicio). La persona puede LEER su
-- propio saldo y nada más; pagos y avisos no los ve nadie desde el navegador.
create table if not exists saldos (
  usuario        uuid primary key references auth.users(id) on delete cascade,
  postulaciones  integer not null default 12 check (postulaciones >= 0),
  regaladas      integer not null default 12,
  compradas      integer not null default 0,
  pase_hasta     timestamptz,
  codigo         text unique,
  referido_por   uuid references auth.users(id) on delete set null,
  bono_pagado    boolean not null default false,
  creado         timestamptz not null default now(),
  actualizado    timestamptz not null default now()
);
alter table saldos enable row level security;
drop policy if exists "cada quien lee su saldo" on saldos;
create policy "cada quien lee su saldo" on saldos for select using (auth.uid() = usuario);

create table if not exists pagos (
  id             bigint generated always as identity primary key,
  usuario        uuid not null references auth.users(id) on delete cascade,
  postulaciones  integer not null default 0,
  dias           integer not null default 0,
  soles          numeric(8,2) not null default 0,
  nota           text,
  creado         timestamptz not null default now()
);
alter table pagos enable row level security;

-- «Ya yapeé»: lo que la persona dice que pagó. NO acredita nada: es la
-- lista que Ali ve en /admin para comprobar en su Yape y acreditar.
create table if not exists avisos_pago (
  id             bigint generated always as identity primary key,
  usuario        uuid references auth.users(id) on delete cascade,
  correo         text not null,
  plan           text not null,
  soles          numeric(8,2) not null default 0,
  operacion      text,
  atendido       boolean not null default false,
  creado         timestamptz not null default now()
);
alter table avisos_pago enable row level security;
create index if not exists avisos_pago_pendientes on avisos_pago (atendido, creado);

-- 2026-11-05: packs de 30/50/80 y «sumar postulaciones» al precio del pack.
alter table saldos add column if not exists ultimo_plan text;
alter table avisos_pago add column if not exists postulaciones integer not null default 0;

-- ═══════════════ 007-reclamos.sql ═══════════════
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

-- ═══════════════ COMPROBACIÓN ═══════════════
-- Debe devolver 5 filas: avisos_pago, pagos, reclamos, saldos, uso_ia.
select table_name from information_schema.tables
where table_schema = 'public' and table_name in ('uso_ia', 'saldos', 'pagos', 'avisos_pago', 'reclamos')
order by 1;
