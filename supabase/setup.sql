-- Berger : installation complète de la base Supabase.
-- À coller dans Supabase → SQL Editor → New query, puis « Run ». À exécuter une seule fois.

-- ===== supabase/migrations/20261014000000_schema.sql =====
-- =====================================================================
-- Berger — Assistant d'accompagnement : schéma serveur (Supabase / PostgreSQL)
-- =====================================================================
-- Principes :
--  * chaque table de suivi possède des colonnes relationnelles (propriétaire, jeune,
--    rencontre, version, suppression logique, horodatage serveur) et un champ jsonb
--    "data" qui contient le détail métier (schéma défini dans src/lib/types.ts) ;
--  * moindre privilège : un utilisateur ne voit QUE ses dossiers et ceux qui lui ont
--    été explicitement attribués (table accompaniment_assignments). L'administrateur
--    gère les accès mais ne lit pas automatiquement les dossiers ;
--  * verrou optimiste : la fonction sync_push refuse une écriture dont la version de
--    base ne correspond plus à la version serveur (conflit renvoyé au client) ;
--  * toutes les écritures sont journalisées (audit_logs).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Profils et rôles
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null default '',
  role text not null default 'accompagnateur' check (role in ('admin', 'responsable', 'accompagnateur')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin' and active);
$$;

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active);
$$;

-- Création automatique du profil ; le tout premier compte devient administrateur.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, display_name, role)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    case when exists (select 1 from profiles) then 'accompagnateur' else 'admin' end
  );
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Un utilisateur ne peut pas modifier son propre rôle ni s'activer lui-même.
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role or new.active is distinct from old.active)
     and auth.uid() is not null and not is_admin() then
    raise exception 'Seul un administrateur peut modifier les rôles et l''activation' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger profiles_protect before update on public.profiles
  for each row execute function public.protect_profile();

alter table public.profiles enable row level security;
create policy profiles_select on public.profiles for select to authenticated using (id = auth.uid() or is_admin());
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid() or is_admin());

-- ---------------------------------------------------------------------
-- Dossiers des jeunes et attributions
-- ---------------------------------------------------------------------
create table public.youth_profiles (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id),
  youth_id uuid generated always as (id) stored,
  session_id uuid,
  data jsonb not null default '{}'::jsonb,  -- identité, contact, situation initiale, synthèse
  version integer not null default 1,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  server_updated_at timestamptz not null default clock_timestamp(),
  retention_until date                       -- politique de conservation (optionnelle)
);

create table public.accompaniment_assignments (
  youth_id uuid not null references public.youth_profiles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  access text not null check (access in ('accompagnateur', 'superviseur')),
  granted_by uuid references public.profiles(id) default auth.uid(),
  granted_at timestamptz not null default now(),
  primary key (youth_id, user_id)
);

-- Accès à un dossier : propriétaire, ou attribution explicite (lecture seule pour la supervision).
create or replace function public.can_access_youth(p_youth uuid, p_write boolean default false) returns boolean
language sql stable security definer set search_path = public as $$
  select is_active_user() and (
    exists (select 1 from youth_profiles y where y.id = p_youth and y.owner_id = auth.uid())
    or exists (
      select 1 from accompaniment_assignments a
      where a.youth_id = p_youth and a.user_id = auth.uid()
        and (not p_write or a.access = 'accompagnateur')
    )
  );
$$;

alter table public.youth_profiles enable row level security;
create policy youth_select on public.youth_profiles for select to authenticated using (can_access_youth(id, false));
create policy youth_insert on public.youth_profiles for insert to authenticated with check (owner_id = auth.uid() and is_active_user());
create policy youth_update on public.youth_profiles for update to authenticated using (can_access_youth(id, true)) with check (can_access_youth(id, true));
-- Pas de suppression directe : suppression logique via "deleted", purge via purge_youth().

alter table public.accompaniment_assignments enable row level security;
create policy assign_select on public.accompaniment_assignments for select to authenticated
  using (user_id = auth.uid() or is_admin() or exists (select 1 from youth_profiles y where y.id = youth_id and y.owner_id = auth.uid()));
create policy assign_write on public.accompaniment_assignments for all to authenticated
  using (is_admin() or exists (select 1 from youth_profiles y where y.id = youth_id and y.owner_id = auth.uid()))
  with check (is_admin() or exists (select 1 from youth_profiles y where y.id = youth_id and y.owner_id = auth.uid()));

-- ---------------------------------------------------------------------
-- Tables de suivi (structure commune)
-- ---------------------------------------------------------------------
create table public.accompaniment_sessions (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id),
  youth_id uuid references public.youth_profiles(id) on delete cascade,
  session_id uuid,
  data jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  server_updated_at timestamptz not null default clock_timestamp()
);
comment on table public.accompaniment_sessions is 'Rencontres : date, type, thème, sujets, notes, besoins, décisions, versets, compte rendu (brouillon IA, texte validé, fournisseur, sources, dates)';
create index on public.accompaniment_sessions (server_updated_at);
create index on public.accompaniment_sessions (youth_id);
alter table public.accompaniment_sessions enable row level security;
create policy accompaniment_sessions_select on public.accompaniment_sessions for select to authenticated
  using ((owner_id = auth.uid() and is_active_user() and youth_id is null) or (youth_id is not null and can_access_youth(youth_id, false)));
create policy accompaniment_sessions_insert on public.accompaniment_sessions for insert to authenticated
  with check (owner_id = auth.uid() and is_active_user() and (youth_id is null or can_access_youth(youth_id, true)));
create policy accompaniment_sessions_update on public.accompaniment_sessions for update to authenticated
  using ((owner_id = auth.uid() and is_active_user() and youth_id is null) or (youth_id is not null and can_access_youth(youth_id, true)))
  with check ((owner_id = auth.uid() and is_active_user() and youth_id is null) or (youth_id is not null and can_access_youth(youth_id, true)));

create table public.session_notes (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id),
  youth_id uuid references public.youth_profiles(id) on delete cascade,
  session_id uuid references public.accompaniment_sessions(id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  server_updated_at timestamptz not null default clock_timestamp()
);
comment on table public.session_notes is 'Notes écrites (markdown léger, étiquettes)';
create index on public.session_notes (server_updated_at);
create index on public.session_notes (youth_id);
alter table public.session_notes enable row level security;
create policy session_notes_select on public.session_notes for select to authenticated
  using ((owner_id = auth.uid() and is_active_user() and youth_id is null) or (youth_id is not null and can_access_youth(youth_id, false)));
create policy session_notes_insert on public.session_notes for insert to authenticated
  with check (owner_id = auth.uid() and is_active_user() and (youth_id is null or can_access_youth(youth_id, true)));
create policy session_notes_update on public.session_notes for update to authenticated
  using ((owner_id = auth.uid() and is_active_user() and youth_id is null) or (youth_id is not null and can_access_youth(youth_id, true)))
  with check ((owner_id = auth.uid() and is_active_user() and youth_id is null) or (youth_id is not null and can_access_youth(youth_id, true)));

create table public.audio_recordings (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id),
  youth_id uuid references public.youth_profiles(id) on delete cascade,
  session_id uuid references public.accompaniment_sessions(id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  server_updated_at timestamptz not null default clock_timestamp()
);
comment on table public.audio_recordings is 'Métadonnées des notes vocales. Le fichier audio reste chiffré sur l’appareil qui l’a enregistré.';
create index on public.audio_recordings (server_updated_at);
create index on public.audio_recordings (youth_id);
alter table public.audio_recordings enable row level security;
create policy audio_recordings_select on public.audio_recordings for select to authenticated
  using ((owner_id = auth.uid() and is_active_user() and youth_id is null) or (youth_id is not null and can_access_youth(youth_id, false)));
create policy audio_recordings_insert on public.audio_recordings for insert to authenticated
  with check (owner_id = auth.uid() and is_active_user() and (youth_id is null or can_access_youth(youth_id, true)));
create policy audio_recordings_update on public.audio_recordings for update to authenticated
  using ((owner_id = auth.uid() and is_active_user() and youth_id is null) or (youth_id is not null and can_access_youth(youth_id, true)))
  with check ((owner_id = auth.uid() and is_active_user() and youth_id is null) or (youth_id is not null and can_access_youth(youth_id, true)));

create table public.transcriptions (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id),
  youth_id uuid references public.youth_profiles(id) on delete cascade,
  session_id uuid references public.accompaniment_sessions(id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  server_updated_at timestamptz not null default clock_timestamp()
);
comment on table public.transcriptions is 'Transcriptions : texte brut du moteur (jamais modifié), version corrigée, langue, passages incertains, moteur';
create index on public.transcriptions (server_updated_at);
create index on public.transcriptions (youth_id);
alter table public.transcriptions enable row level security;
create policy transcriptions_select on public.transcriptions for select to authenticated
  using ((owner_id = auth.uid() and is_active_user() and youth_id is null) or (youth_id is not null and can_access_youth(youth_id, false)));
create policy transcriptions_insert on public.transcriptions for insert to authenticated
  with check (owner_id = auth.uid() and is_active_user() and (youth_id is null or can_access_youth(youth_id, true)));
create policy transcriptions_update on public.transcriptions for update to authenticated
  using ((owner_id = auth.uid() and is_active_user() and youth_id is null) or (youth_id is not null and can_access_youth(youth_id, true)))
  with check ((owner_id = auth.uid() and is_active_user() and youth_id is null) or (youth_id is not null and can_access_youth(youth_id, true)));

create table public.goals (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id),
  youth_id uuid references public.youth_profiles(id) on delete cascade,
  session_id uuid,
  data jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  server_updated_at timestamptz not null default clock_timestamp()
);
comment on table public.goals is 'Objectifs et observations de progression';
create index on public.goals (server_updated_at);
create index on public.goals (youth_id);
alter table public.goals enable row level security;
create policy goals_select on public.goals for select to authenticated
  using ((owner_id = auth.uid() and is_active_user() and youth_id is null) or (youth_id is not null and can_access_youth(youth_id, false)));
create policy goals_insert on public.goals for insert to authenticated
  with check (owner_id = auth.uid() and is_active_user() and (youth_id is null or can_access_youth(youth_id, true)));
create policy goals_update on public.goals for update to authenticated
  using ((owner_id = auth.uid() and is_active_user() and youth_id is null) or (youth_id is not null and can_access_youth(youth_id, true)))
  with check ((owner_id = auth.uid() and is_active_user() and youth_id is null) or (youth_id is not null and can_access_youth(youth_id, true)));

create table public.action_items (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id),
  youth_id uuid references public.youth_profiles(id) on delete cascade,
  session_id uuid references public.accompaniment_sessions(id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  server_updated_at timestamptz not null default clock_timestamp()
);
comment on table public.action_items is 'Actions (responsable accompagnateur ou jeune), échéance, priorité, statut, rappel, résultat';
create index on public.action_items (server_updated_at);
create index on public.action_items (youth_id);
alter table public.action_items enable row level security;
create policy action_items_select on public.action_items for select to authenticated
  using ((owner_id = auth.uid() and is_active_user() and youth_id is null) or (youth_id is not null and can_access_youth(youth_id, false)));
create policy action_items_insert on public.action_items for insert to authenticated
  with check (owner_id = auth.uid() and is_active_user() and (youth_id is null or can_access_youth(youth_id, true)));
create policy action_items_update on public.action_items for update to authenticated
  using ((owner_id = auth.uid() and is_active_user() and youth_id is null) or (youth_id is not null and can_access_youth(youth_id, true)))
  with check ((owner_id = auth.uid() and is_active_user() and youth_id is null) or (youth_id is not null and can_access_youth(youth_id, true)));

create table public.appointments (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id),
  youth_id uuid references public.youth_profiles(id) on delete cascade,
  session_id uuid references public.accompaniment_sessions(id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  server_updated_at timestamptz not null default clock_timestamp()
);
comment on table public.appointments is 'Rendez-vous : début, fin, mode, lieu, sujet, notes préparatoires, rappels, statut';
create index on public.appointments (server_updated_at);
create index on public.appointments (youth_id);
alter table public.appointments enable row level security;
create policy appointments_select on public.appointments for select to authenticated
  using ((owner_id = auth.uid() and is_active_user() and youth_id is null) or (youth_id is not null and can_access_youth(youth_id, false)));
create policy appointments_insert on public.appointments for insert to authenticated
  with check (owner_id = auth.uid() and is_active_user() and (youth_id is null or can_access_youth(youth_id, true)));
create policy appointments_update on public.appointments for update to authenticated
  using ((owner_id = auth.uid() and is_active_user() and youth_id is null) or (youth_id is not null and can_access_youth(youth_id, true)))
  with check ((owner_id = auth.uid() and is_active_user() and youth_id is null) or (youth_id is not null and can_access_youth(youth_id, true)));

create table public.timeline_events (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id),
  youth_id uuid references public.youth_profiles(id) on delete cascade,
  session_id uuid,
  data jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  server_updated_at timestamptz not null default clock_timestamp()
);
comment on table public.timeline_events is 'Éléments de chronologie : appels, relances, retours du jeune, bilans';
create index on public.timeline_events (server_updated_at);
create index on public.timeline_events (youth_id);
alter table public.timeline_events enable row level security;
create policy timeline_events_select on public.timeline_events for select to authenticated
  using ((owner_id = auth.uid() and is_active_user() and youth_id is null) or (youth_id is not null and can_access_youth(youth_id, false)));
create policy timeline_events_insert on public.timeline_events for insert to authenticated
  with check (owner_id = auth.uid() and is_active_user() and (youth_id is null or can_access_youth(youth_id, true)));
create policy timeline_events_update on public.timeline_events for update to authenticated
  using ((owner_id = auth.uid() and is_active_user() and youth_id is null) or (youth_id is not null and can_access_youth(youth_id, true)))
  with check ((owner_id = auth.uid() and is_active_user() and youth_id is null) or (youth_id is not null and can_access_youth(youth_id, true)));

create table public.bible_recommendations (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id),
  youth_id uuid references public.youth_profiles(id) on delete cascade,
  session_id uuid references public.accompaniment_sessions(id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  server_updated_at timestamptz not null default clock_timestamp()
);
comment on table public.bible_recommendations is 'Passages bibliques proposés, retenus ou étudiés (référence vérifiée, thème, commentaire, source)';
create index on public.bible_recommendations (server_updated_at);
create index on public.bible_recommendations (youth_id);
alter table public.bible_recommendations enable row level security;
create policy bible_recommendations_select on public.bible_recommendations for select to authenticated
  using ((owner_id = auth.uid() and is_active_user() and youth_id is null) or (youth_id is not null and can_access_youth(youth_id, false)));
create policy bible_recommendations_insert on public.bible_recommendations for insert to authenticated
  with check (owner_id = auth.uid() and is_active_user() and (youth_id is null or can_access_youth(youth_id, true)));
create policy bible_recommendations_update on public.bible_recommendations for update to authenticated
  using ((owner_id = auth.uid() and is_active_user() and youth_id is null) or (youth_id is not null and can_access_youth(youth_id, true)))
  with check ((owner_id = auth.uid() and is_active_user() and youth_id is null) or (youth_id is not null and can_access_youth(youth_id, true)));

create table public.message_queue (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id),
  youth_id uuid references public.youth_profiles(id) on delete cascade,
  session_id uuid,
  data jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  server_updated_at timestamptz not null default clock_timestamp(),
  status text generated always as (data->>'status') stored,
  channel text generated always as (data->>'channel') stored,
  scheduled_at_text text generated always as (data->>'scheduledAt') stored
);
comment on table public.message_queue is 'Messages WhatsApp : préparés (lien) ou programmés (API), statut, journal';
create index on public.message_queue (server_updated_at);
create index on public.message_queue (youth_id);
alter table public.message_queue enable row level security;
create policy message_queue_select on public.message_queue for select to authenticated
  using ((owner_id = auth.uid() and is_active_user() and youth_id is null) or (youth_id is not null and can_access_youth(youth_id, false)));
create policy message_queue_insert on public.message_queue for insert to authenticated
  with check (owner_id = auth.uid() and is_active_user() and (youth_id is null or can_access_youth(youth_id, true)));
create policy message_queue_update on public.message_queue for update to authenticated
  using ((owner_id = auth.uid() and is_active_user() and youth_id is null) or (youth_id is not null and can_access_youth(youth_id, true)))
  with check ((owner_id = auth.uid() and is_active_user() and youth_id is null) or (youth_id is not null and can_access_youth(youth_id, true)));

create table public.consent_records (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id),
  youth_id uuid references public.youth_profiles(id) on delete cascade,
  session_id uuid,
  data jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  server_updated_at timestamptz not null default clock_timestamp()
);
comment on table public.consent_records is 'Consentements horodatés (audio, IA, WhatsApp, autorisation parentale, conservation)';
create index on public.consent_records (server_updated_at);
create index on public.consent_records (youth_id);
alter table public.consent_records enable row level security;
create policy consent_records_select on public.consent_records for select to authenticated
  using ((owner_id = auth.uid() and is_active_user() and youth_id is null) or (youth_id is not null and can_access_youth(youth_id, false)));
create policy consent_records_insert on public.consent_records for insert to authenticated
  with check (owner_id = auth.uid() and is_active_user() and (youth_id is null or can_access_youth(youth_id, true)));
create policy consent_records_update on public.consent_records for update to authenticated
  using ((owner_id = auth.uid() and is_active_user() and youth_id is null) or (youth_id is not null and can_access_youth(youth_id, true)))
  with check ((owner_id = auth.uid() and is_active_user() and youth_id is null) or (youth_id is not null and can_access_youth(youth_id, true)));

create table public.message_templates (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id),
  youth_id uuid,
  session_id uuid,
  data jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  server_updated_at timestamptz not null default clock_timestamp()
);
comment on table public.message_templates is 'Modèles de messages personnels';
create index on public.message_templates (server_updated_at);
alter table public.message_templates enable row level security;
create policy message_templates_own on public.message_templates for all to authenticated
  using (owner_id = auth.uid() and is_active_user()) with check (owner_id = auth.uid() and is_active_user());

create table public.bible_bookmarks (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id),
  youth_id uuid,
  session_id uuid,
  data jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  server_updated_at timestamptz not null default clock_timestamp()
);
comment on table public.bible_bookmarks is 'Favoris, notes bibliques et historique de lecture personnels';
create index on public.bible_bookmarks (server_updated_at);
alter table public.bible_bookmarks enable row level security;
create policy bible_bookmarks_own on public.bible_bookmarks for all to authenticated
  using (owner_id = auth.uid() and is_active_user()) with check (owner_id = auth.uid() and is_active_user());


-- ===== supabase/migrations/20261014000100_sync_audit_bible.sql =====
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

