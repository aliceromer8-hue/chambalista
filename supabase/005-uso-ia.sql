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
