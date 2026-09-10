-- Bootstrap cryptographic primitives before any application migration that
-- depends on extensions.digest/crypt/gen_salt. Keep this idempotent so clean
-- databases and existing Supabase projects converge safely.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
