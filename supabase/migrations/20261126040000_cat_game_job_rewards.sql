-- Cat Game V2: work-order rewards for the six seeded jobs.
-- The core migration only seeded job codes and display names with empty rewards,
-- so work orders were not playable. This turns every job on with per-hour pay
-- anchored to the app's own wage model (200/day over 8h = 25 coins per hour).
-- Longer orders pay slightly above linear to reward committing to one shift.
-- Tunable here: adjust the updates below; values are copied to the running
-- database by executing this file in the SQL editor.
begin;

update public.game_job_catalog set is_active=true, rewards_by_duration='{"60":{"coins":20},"120":{"coins":42},"240":{"coins":88},"480":{"coins":185}}'::jsonb where job_code='bakery';
update public.game_job_catalog set is_active=true, rewards_by_duration='{"60":{"coins":25},"120":{"coins":52},"240":{"coins":110},"480":{"coins":230}}'::jsonb where job_code='delivery';
update public.game_job_catalog set is_active=true, rewards_by_duration='{"60":{"coins":25},"120":{"coins":52},"240":{"coins":110},"480":{"coins":230}}'::jsonb where job_code='foraging';
update public.game_job_catalog set is_active=true, rewards_by_duration='{"60":{"coins":28},"120":{"coins":58},"240":{"coins":122},"480":{"coins":255}}'::jsonb where job_code='fishing';
update public.game_job_catalog set is_active=true, rewards_by_duration='{"60":{"coins":32},"120":{"coins":66},"240":{"coins":140},"480":{"coins":290}}'::jsonb where job_code='blacksmith';
update public.game_job_catalog set is_active=true, rewards_by_duration='{"60":{"coins":32},"120":{"coins":66},"240":{"coins":140},"480":{"coins":290}}'::jsonb where job_code='mining';

commit;
