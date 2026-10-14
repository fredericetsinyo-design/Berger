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

