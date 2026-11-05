-- ===== La Clínica del Gym · base de datos (paso 1) =====
-- Pegar completo en Supabase → SQL Editor → New query → Run.

-- 1) Perfiles: quién es cada persona y qué rol tiene
create table if not exists public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  usuario text not null unique,
  nombre text not null,
  rol text not null check (rol in ('admin', 'tecnico', 'atencion'))
);

-- 2) Datos de la app: una fila por registro (clientes, órdenes, ítems, agenda, etc.)
create table if not exists public.docs (
  col text not null,
  id text not null,
  data jsonb not null,
  borrado boolean not null default false,
  actualizado timestamptz not null default now(),
  por uuid default auth.uid(),
  primary key (col, id)
);
create index if not exists docs_actualizado on public.docs (actualizado);

-- 3) Historial de cambios: quién cambió qué y cuándo
create table if not exists public.historial (
  id bigint generated always as identity primary key,
  col text not null,
  doc_id text not null,
  accion text not null,
  por uuid,
  cuando timestamptz not null default now(),
  antes jsonb,
  despues jsonb
);
create index if not exists historial_cuando on public.historial (cuando);

-- 4) Funciones de permisos
create or replace function public.es_miembro() returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.perfiles where id = auth.uid()) $$;

create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.perfiles where id = auth.uid() and rol = 'admin') $$;

-- Lo que ve solo el administrador (los demás ven solo lo que cargaron ellos)
create or replace function public.col_privada(c text) returns boolean
language sql immutable set search_path = public
as $$ select c in ('gastos', 'adelantos', 'pagosQuincena', 'sorteos') $$;

-- 5) Fecha y autor de cada cambio, y registro automático del historial
create or replace function public.docs_sello() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.actualizado := now();
  if tg_op = 'UPDATE' then new.por := coalesce(auth.uid(), new.por); end if;
  return new;
end
$$;
create or replace function public.docs_historial() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.historial (col, doc_id, accion, por, despues) values (new.col, new.id, 'creó', auth.uid(), new.data);
  elsif new.data is distinct from old.data or new.borrado is distinct from old.borrado then
    insert into public.historial (col, doc_id, accion, por, antes, despues)
    values (new.col, new.id, case when new.borrado and not old.borrado then 'borró' else 'cambió' end, auth.uid(), old.data, new.data);
  end if;
  return null;
end
$$;
drop trigger if exists docs_cambio on public.docs;
drop function if exists public.docs_cambio();
drop trigger if exists docs_sello on public.docs;
create trigger docs_sello before insert or update on public.docs for each row execute function public.docs_sello();
drop trigger if exists docs_historial on public.docs;
create trigger docs_historial after insert or update on public.docs for each row execute function public.docs_historial();

-- 6) Seguridad: solo entran ustedes cuatro
alter table public.perfiles enable row level security;
alter table public.docs enable row level security;
alter table public.historial enable row level security;

drop policy if exists "ver perfiles" on public.perfiles;
create policy "ver perfiles" on public.perfiles for select to authenticated using (public.es_miembro());
drop policy if exists "admin edita perfiles" on public.perfiles;
create policy "admin edita perfiles" on public.perfiles for all to authenticated using (public.es_admin()) with check (public.es_admin());

drop policy if exists "ver datos" on public.docs;
create policy "ver datos" on public.docs for select to authenticated
  using (public.es_miembro() and (not public.col_privada(col) or public.es_admin() or por = auth.uid()));
drop policy if exists "cargar datos" on public.docs;
create policy "cargar datos" on public.docs for insert to authenticated
  with check (public.es_miembro() and (not public.col_privada(col) or public.es_admin() or por = auth.uid()));
drop policy if exists "editar datos" on public.docs;
create policy "editar datos" on public.docs for update to authenticated
  using (public.es_miembro() and (not public.col_privada(col) or public.es_admin()))
  with check (public.es_miembro());
drop policy if exists "borrar datos" on public.docs;
create policy "borrar datos" on public.docs for delete to authenticated using (public.es_admin());

drop policy if exists "ver historial" on public.historial;
create policy "ver historial" on public.historial for select to authenticated using (public.es_admin());

revoke all on public.perfiles, public.docs, public.historial from anon;
grant select, insert, update, delete on public.perfiles to authenticated;
grant select, insert, update, delete on public.docs to authenticated;
grant select on public.historial to authenticated;
grant execute on function public.es_miembro(), public.es_admin(), public.col_privada(text) to authenticated;

-- 7) Cambios en vivo: lo que carga uno lo ven los demás al instante
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'docs') then
    alter publication supabase_realtime add table public.docs;
  end if;
end
$$;

select 'Listo: base creada' as resultado;
