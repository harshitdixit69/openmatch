-- Migration Part 1: Add 'passed' enum value to match_status_type.
-- IMPORTANT: ALTER TYPE ... ADD VALUE cannot be used in the same transaction as
-- statements referencing the new value. This file ONLY commits the enum change.
-- All RPCs and column changes that reference 'passed' are in migration 501.

alter type public.match_status_type add value if not exists 'passed';
