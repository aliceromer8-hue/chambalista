-- Saldo de postulaciones por cuenta, pases y referidos (2026-10-02).
--
-- Sin pasarela: se cobra por Yape/Plin (sin comisión) y Ali acredita el
-- pack o el pase desde /admin. Ver saldo.py.
--
--   postulaciones  las de los packs (30 por S/ 15, 100 por S/ 29)
--   pase_hasta     mientras no venza, postula sin descontar (hasta el tope
--                  diario seguro). La prueba gratis de 18 días es un pase.
--   codigo         su código para invitar (8 caracteres)
--   referido_por   quién la invitó (una sola vez por cuenta)
--
-- Solo el servidor escribe (clave de servicio). La persona puede LEER su
-- propio saldo y nada más; los pagos no los ve nadie desde el navegador.
create table if not exists saldos (
  usuario        uuid primary key references auth.users(id) on delete cascade,
  postulaciones  integer not null default 0 check (postulaciones >= 0),
  pase_hasta     timestamptz,
  codigo         text unique,
  referido_por   uuid references auth.users(id) on delete set null,
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
