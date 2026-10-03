-- Saldo de postulaciones por cuenta, packs, pase, referidos y avisos de
-- pago (2026-10-02, revisado el mismo día: lo gratis son 18 POSTULACIONES,
-- no 18 días).
--
-- Sin pasarela: se cobra por Yape/Plin (sin comisión). La persona pulsa
-- «Ya yapeé» (aviso de pago), Ali lo comprueba en su Yape y lo acredita
-- con un clic desde /admin. Ver saldo.py.
--
--   postulaciones  las que le quedan (regaladas + compradas - usadas)
--   regaladas      total histórico regalado: 18 al crear + bonos de invitar
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
  postulaciones  integer not null default 18 check (postulaciones >= 0),
  regaladas      integer not null default 18,
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
