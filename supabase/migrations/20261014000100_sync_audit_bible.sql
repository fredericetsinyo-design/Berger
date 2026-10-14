-- =====================================================================
-- Synchronisation, journalisation, messagerie, Bible
-- =====================================================================

-- ---------------------------------------------------------------------
-- Journal d'audit (écritures) — lecture réservée à l'auteur et à l'administrateur
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id bigserial primary key,
  user_id uuid default auth.uid(),
  table_name text not null,
  record_id uuid,
  action text not null,           -- insert | update | soft_delete | purge | assignment
  at timestamptz not null default now()
);
alter table public.audit_logs enable row level security;
create policy audit_select on public.audit_logs for select to authenticated using (user_id = auth.uid() or is_admin());

create or replace function public.audit_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_logs (user_id, table_name, record_id, action)
  values (auth.uid(), tg_table_name, coalesce(new.id, old.id),
          case when tg_op = 'INSERT' then 'insert'
               when tg_op = 'UPDATE' and new.deleted and not old.deleted then 'soft_delete'
               else lower(tg_op) end);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['youth_profiles','accompaniment_sessions','session_notes','audio_recordings','transcriptions','goals',
    'action_items','appointments','timeline_events','bible_recommendations','message_queue','consent_records','message_templates','bible_bookmarks'] loop
    execute format('create trigger %I after insert or update on public.%I for each row execute function public.audit_write()', t || '_audit', t);
  end loop;
end $$;

create or replace function public.audit_assignment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_logs (user_id, table_name, record_id, action) values (auth.uid(), 'accompaniment_assignments', coalesce(new.youth_id, old.youth_id), 'assignment:' || lower(tg_op));
  return coalesce(new, old);
end $$;
create trigger assignments_audit after insert or update or delete on public.accompaniment_assignments for each row execute function public.audit_assignment();

-- ---------------------------------------------------------------------
-- Opérations de synchronisation (traçabilité, détection de rejeu)
-- ---------------------------------------------------------------------
create table public.sync_operations (
  id bigserial primary key,
  user_id uuid not null default auth.uid(),
  table_name text not null,
  record_id uuid not null,
  base_version integer not null,
  result text not null,           -- ok | conflict
  new_version integer,
  at timestamptz not null default now()
);
alter table public.sync_operations enable row level security;
create policy sync_ops_select on public.sync_operations for select to authenticated using (user_id = auth.uid());
create policy sync_ops_insert on public.sync_operations for insert to authenticated with check (user_id = auth.uid());

-- Écriture avec verrou optimiste. SECURITY INVOKER : toutes les politiques RLS s'appliquent.
-- Retour : {"status":"ok","version":n} | {"status":"conflict","server":{...}}
create or replace function public.sync_push(p_table text, p_row jsonb, p_base_version integer) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  allowed text[] := array['youth_profiles','accompaniment_sessions','session_notes','audio_recordings','transcriptions','goals',
    'action_items','appointments','timeline_events','bible_recommendations','message_queue','consent_records','message_templates','bible_bookmarks'];
  v_id uuid := (p_row->>'id')::uuid;
  v_current record;
  v_version integer;
begin
  if not (p_table = any(allowed)) then
    raise exception 'Table non synchronisable : %', p_table using errcode = '42501';
  end if;
  if not is_active_user() then
    raise exception 'Compte inactif' using errcode = '42501';
  end if;

  execute format('select version, to_jsonb(t.*) as row from public.%I t where id = $1 for update', p_table) into v_current using v_id;

  if v_current is null then
    -- Nouvel enregistrement (l'identifiant UUID vient de l'appareil : un rejeu ne crée pas de doublon)
    if p_table = 'youth_profiles' then
      execute format('insert into public.%I (id, owner_id, data, deleted, created_at) values ($1, auth.uid(), $2, $3, coalesce($4, now()))', p_table)
        using v_id, p_row->'data', coalesce((p_row->>'deleted')::boolean, false), (p_row->>'created_at')::timestamptz;
    else
      execute format('insert into public.%I (id, owner_id, youth_id, session_id, data, deleted, created_at) values ($1, auth.uid(), $2, $3, $4, $5, coalesce($6, now()))', p_table)
        using v_id, (p_row->>'youth_id')::uuid, (p_row->>'session_id')::uuid, p_row->'data', coalesce((p_row->>'deleted')::boolean, false), (p_row->>'created_at')::timestamptz;
    end if;
    v_version := 1;
  elsif v_current.version <> p_base_version then
    insert into sync_operations (table_name, record_id, base_version, result) values (p_table, v_id, p_base_version, 'conflict');
    return jsonb_build_object('status', 'conflict', 'server', v_current.row);
  else
    if p_table = 'youth_profiles' then
      execute format('update public.%I set data = $2, deleted = $3, version = version + 1, server_updated_at = clock_timestamp() where id = $1 returning version', p_table)
        into v_version using v_id, p_row->'data', coalesce((p_row->>'deleted')::boolean, false);
    else
      execute format('update public.%I set data = $2, deleted = $3, youth_id = $4, session_id = $5, version = version + 1, server_updated_at = clock_timestamp() where id = $1 returning version', p_table)
        into v_version using v_id, p_row->'data', coalesce((p_row->>'deleted')::boolean, false), (p_row->>'youth_id')::uuid, (p_row->>'session_id')::uuid;
    end if;
    if v_version is null then
      raise exception 'Modification refusée par la politique de sécurité' using errcode = '42501';
    end if;
  end if;

  insert into sync_operations (table_name, record_id, base_version, result, new_version) values (p_table, v_id, p_base_version, 'ok', v_version);
  return jsonb_build_object('status', 'ok', 'version', v_version);
end $$;
grant execute on function public.sync_push(text, jsonb, integer) to authenticated;

-- Purge définitive d'un dossier (droit à l'effacement) — propriétaire uniquement.
create or replace function public.purge_youth(p_youth uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from youth_profiles where id = p_youth and owner_id = auth.uid()) then
    raise exception 'Seul le propriétaire du dossier peut le purger' using errcode = '42501';
  end if;
  delete from youth_profiles where id = p_youth; -- cascade vers toutes les tables de suivi
  insert into audit_logs (user_id, table_name, record_id, action) values (auth.uid(), 'youth_profiles', p_youth, 'purge');
end $$;
grant execute on function public.purge_youth(uuid) to authenticated;

-- Purge des dossiers supprimés logiquement ou arrivés au terme de leur conservation.
-- À planifier (pg_cron) : select public.purge_expired();
create or replace function public.purge_expired(p_soft_deleted_days integer default 30) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with d as (
    delete from youth_profiles
    where (deleted and server_updated_at < now() - make_interval(days => p_soft_deleted_days))
       or (retention_until is not null and retention_until < current_date)
    returning id
  ) select count(*) into n from d;
  return n;
end $$;
revoke execute on function public.purge_expired(integer) from public, authenticated;

-- ---------------------------------------------------------------------
-- WhatsApp Business : journal des envois (écrit par les fonctions serveur)
-- ---------------------------------------------------------------------
create table public.message_delivery_logs (
  id bigserial primary key,
  message_id uuid references public.message_queue(id) on delete cascade,
  status text not null,            -- envoi_en_cours | envoye | remis | lu | echec | annule
  provider_message_id text,
  detail text,
  at timestamptz not null default now()
);
create index on public.message_delivery_logs (message_id);
create index on public.message_delivery_logs (provider_message_id);
alter table public.message_delivery_logs enable row level security;
create policy delivery_select on public.message_delivery_logs for select to authenticated
  using (exists (select 1 from message_queue m where m.id = message_id and (m.owner_id = auth.uid() or can_access_youth(m.youth_id, false))));

-- ---------------------------------------------------------------------
-- Bible (texte du domaine public, lisible par tous les utilisateurs connectés)
-- ---------------------------------------------------------------------
create table public.bible_translations (
  code text primary key,
  name text not null,
  language text not null,
  year integer,
  license text not null,
  license_note text,
  source_url text,
  can_display_text boolean not null default false  -- n'afficher le texte que si la licence l'autorise
);
create table public.bible_books (
  translation text references public.bible_translations(code) on delete cascade,
  book integer not null check (book between 1 and 66),
  osis text not null,
  name text not null,
  chapters integer not null,
  primary key (translation, book)
);
create table public.bible_verses (
  translation text references public.bible_translations(code) on delete cascade,
  book integer not null,
  chapter integer not null,
  verse integer not null,
  text text not null,
  primary key (translation, book, chapter, verse)
);
create index bible_verses_fts on public.bible_verses using gin (to_tsvector('french', text));
alter table public.bible_translations enable row level security;
alter table public.bible_books enable row level security;
alter table public.bible_verses enable row level security;
create policy bible_t_read on public.bible_translations for select to authenticated using (true);
create policy bible_b_read on public.bible_books for select to authenticated using (true);
create policy bible_v_read on public.bible_verses for select to authenticated using (true);
