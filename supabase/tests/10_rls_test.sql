-- Tests des politiques de sécurité (scénarios 13 et 14 côté serveur).
-- Chaque vérification lève une exception en cas d'échec.
\set ON_ERROR_STOP on
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test'),     -- premier compte → admin
  ('00000000-0000-0000-0000-00000000000b', 'fred@test'),      -- accompagnateur A
  ('00000000-0000-0000-0000-00000000000c', 'autre@test'),     -- accompagnateur B
  ('00000000-0000-0000-0000-00000000000d', 'resp@test');      -- responsable
update public.profiles set role = 'responsable' where email = 'resp@test';

create function pg_temp.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); execute 'set role authenticated'; end $$;
create function pg_temp.check(cond boolean, msg text) returns void language plpgsql as $$
begin if not cond then raise exception 'ÉCHEC : %', msg; end if; raise notice 'OK : %', msg; end $$;

do $$ begin perform pg_temp.check((select role from profiles where email='admin@test')='admin', 'le premier compte est administrateur'); end $$;

-- A crée un dossier et une rencontre via sync_push
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ declare r jsonb; begin
  r := sync_push('youth_profiles', '{"id":"11111111-1111-1111-1111-111111111111","data":{"firstName":"Kossi"}}', 0);
  perform pg_temp.check(r->>'status' = 'ok' and (r->>'version')::int = 1, 'A crée un dossier (version 1)');
  r := sync_push('accompaniment_sessions', '{"id":"22222222-2222-2222-2222-222222222222","youth_id":"11111111-1111-1111-1111-111111111111","data":{"notes":"Confidentiel"}}', 0);
  perform pg_temp.check(r->>'status' = 'ok', 'A crée une rencontre');
  r := sync_push('accompaniment_sessions', '{"id":"22222222-2222-2222-2222-222222222222","youth_id":"11111111-1111-1111-1111-111111111111","data":{"notes":"Confidentiel"}}', 1);
  perform pg_temp.check((r->>'version')::int = 2, 'rejeu idempotent : mise à jour, pas de doublon');
  perform pg_temp.check((select count(*) from accompaniment_sessions) = 1, 'une seule rencontre en base');
  -- conflit : écriture avec une version de base périmée
  r := sync_push('accompaniment_sessions', '{"id":"22222222-2222-2222-2222-222222222222","youth_id":"11111111-1111-1111-1111-111111111111","data":{"notes":"Autre appareil"}}', 1);
  perform pg_temp.check(r->>'status' = 'conflict' and r->'server'->'data'->>'notes' = 'Confidentiel', 'conflit détecté, version serveur renvoyée, rien écrasé');
end $$;
reset role;

-- B (autre accompagnateur) : aucun accès
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$ declare r jsonb; begin
  perform pg_temp.check((select count(*) from youth_profiles) = 0, 'B ne voit pas le dossier de A');
  perform pg_temp.check((select count(*) from accompaniment_sessions) = 0, 'B ne voit pas les rencontres de A');
  begin
    r := sync_push('accompaniment_sessions', '{"id":"22222222-2222-2222-2222-222222222222","youth_id":"11111111-1111-1111-1111-111111111111","data":{"notes":"piraté"}}', 2);
    perform pg_temp.check(false, 'B ne doit pas pouvoir écrire');
  exception when unique_violation or insufficient_privilege then perform pg_temp.check(true, 'B ne peut pas écraser la rencontre de A');
  end;
  begin
    insert into accompaniment_sessions (id, owner_id, youth_id, data) values (gen_random_uuid(), '00000000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', '{}');
    perform pg_temp.check(false, 'B ne doit pas pouvoir ajouter une rencontre au dossier de A');
  exception when insufficient_privilege then perform pg_temp.check(true, 'B ne peut pas ajouter de rencontre au dossier de A');
  end;
  begin
    update profiles set role = 'admin' where id = auth.uid();
    perform pg_temp.check(false, 'B ne doit pas pouvoir se promouvoir');
  exception when insufficient_privilege then perform pg_temp.check(true, 'B ne peut pas modifier son propre rôle');
  end;
end $$;
reset role;

-- L'administrateur gère les accès mais ne lit pas les dossiers
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin
  perform pg_temp.check((select count(*) from youth_profiles) = 0, 'l’administrateur ne lit pas automatiquement les dossiers');
  perform pg_temp.check((select count(*) from profiles) = 4, 'l’administrateur voit les profils');
  insert into accompaniment_assignments (youth_id, user_id, access) values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000d', 'superviseur');
  perform pg_temp.check(true, 'l’administrateur attribue une supervision explicite');
end $$;
reset role;

-- Le responsable lit le dossier attribué, sans pouvoir le modifier
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
do $$ declare r jsonb; begin
  perform pg_temp.check((select count(*) from accompaniment_sessions) = 1, 'le responsable lit le dossier qui lui est attribué');
  begin
    r := sync_push('accompaniment_sessions', '{"id":"22222222-2222-2222-2222-222222222222","youth_id":"11111111-1111-1111-1111-111111111111","data":{"notes":"modif"}}', 2);
    perform pg_temp.check(false, 'la supervision est en lecture seule');
  exception when unique_violation or insufficient_privilege then perform pg_temp.check(true, 'la supervision est en lecture seule');
  end;
end $$;
reset role;

-- Compte désactivé : plus aucun accès (opération d'administration hors requête utilisateur)
select set_config('request.jwt.claim.sub', '', false);
update profiles set active = false where email = 'fred@test';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin
  perform pg_temp.check((select count(*) from youth_profiles) = 0, 'un compte désactivé perd l’accès à ses dossiers');
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false);
update profiles set active = true where email = 'fred@test';

-- Journal et purge
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin
  perform pg_temp.check((select count(*) from audit_logs where table_name = 'accompaniment_sessions') >= 2, 'écritures journalisées');
  perform purge_youth('11111111-1111-1111-1111-111111111111');
  perform pg_temp.check((select count(*) from accompaniment_sessions) = 0, 'purge du dossier en cascade');
end $$;
reset role;
\echo 'TOUS LES TESTS RLS SONT PASSÉS'
