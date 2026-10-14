#!/usr/bin/env bash
# Exécute les migrations puis les tests RLS sur une base PostgreSQL vide.
# Usage : PGHOST=... PGPORT=... PGUSER=postgres ./supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")"
DB=berger_rls_test
psql -q -c "drop database if exists $DB" -c "create database $DB"
psql -q -d $DB -v ON_ERROR_STOP=1 -f 00_supabase_stub.sql
for f in ../migrations/*.sql; do psql -q -d $DB -v ON_ERROR_STOP=1 -f "$f"; done
psql -q -d $DB -v ON_ERROR_STOP=1 -f 10_rls_test.sql 2>&1 | sed 's/^psql:[^:]*:[0-9]*: //'
