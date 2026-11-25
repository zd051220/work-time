-- Enforce the daily-wage ceiling for every write path to public.records,
-- including normal user sync and privileged RPCs.
ALTER TABLE public.records
  ADD CONSTRAINT records_wage_max_10000
  CHECK (wage IS NULL OR (wage >= 0 AND wage <= 10000));
