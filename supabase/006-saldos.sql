-- Saldo de postulaciones por cuenta, y registro de pagos (2026-10-02).
--
-- Sin pasarela: se cobra por Yape/Plin (sin comisión) y Ali acredita el
-- pack desde /admin. Ver saldo.py.
--
-- Solo el servidor escribe (clave de servicio). La persona puede LEER su
-- propio saldo y nada más; los pagos no los ve nadie desde el navegador.
create table if not exists saldos (
  usuario        uuid primary key references auth.users(id) on delete cascade,
  postulaciones  integer not null default 5 check (postulaciones >= 0),
  actualizado    timestamptz not null default now()
);
alter table saldos enable row level security;
drop policy if exists "cada quien lee su saldo" on saldos;
create policy "cada quien lee su saldo" on saldos for select using (auth.uid() = usuario);

create table if not exists pagos (
  id             bigint generated always as identity primary key,
  usuario        uuid not null references auth.users(id) on delete cascade,
  postulaciones  integer not null,
  soles          numeric(8,2) not null default 0,
  nota           text,
  creado         timestamptz not null default now()
);
alter table pagos enable row level security;
