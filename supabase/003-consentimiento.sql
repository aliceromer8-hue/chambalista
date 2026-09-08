-- Constancia de que cada cuenta aceptó la política, y qué versión aceptó.
--
-- POR QUÉ HACE FALTA UNA TABLA
--
-- El servidor ya rechazaba crear la cuenta sin la casilla marcada. Pero
-- comprobar la casilla y no anotarla deja el sistema sin nada que
-- enseñar: si alguien reclama, «lo aceptó» sin fecha ni versión es una
-- afirmación nuestra, no una prueba.
--
-- La Ley 29733 pide consentimiento previo, expreso e informado. «Previo»
-- y «expreso» se demuestran con la fecha; «informado» se demuestra con
-- la versión del documento que estaba publicado ese día. Por eso se
-- guardan las dos cosas y no solo un booleano.

create table if not exists consentimientos (
  usuario   uuid primary key references auth.users(id) on delete cascade,
  version   text not null,
  cuando    timestamptz not null default now()
);

-- Se activa RLS y NO se crea ninguna política de escritura.
--
-- Eso significa que, con su propio token, la persona no puede insertar,
-- editar ni borrar su registro de consentimiento: solo el servidor, con
-- la clave de servicio, escribe aquí. Un consentimiento que su titular
-- puede modificar no prueba nada.
--
-- Sí puede leerlo, para saber qué aceptó y cuándo.
alter table consentimientos enable row level security;

drop policy if exists "cada quien lee su aceptacion" on consentimientos;
create policy "cada quien lee su aceptacion" on consentimientos
  for select using (usuario = auth.uid());

-- Ojo con borrar_mis_datos(): borra el CV y el historial, pero NO esta
-- fila. Es deliberado. Mientras la cuenta exista, la constancia de que
-- aceptó tiene que existir; si se elimina la cuenta entera, el cascade
-- se la lleva y entonces sí desaparece todo.
