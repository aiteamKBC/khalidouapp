-- Khaliduo 1.1.101: Alembic 20260923_000060 -> 20261017_000062
-- Run as one transaction. It stops (and changes nothing) if the database is
-- not at 20260923_000060.

BEGIN;

DO $$
BEGIN
  IF (SELECT version_num FROM alembic_version) <> '20260923_000060' THEN
    RAISE EXCEPTION 'Expected alembic version 20260923_000060, found %',
      (SELECT version_num FROM alembic_version);
  END IF;
END $$;

-- 20261017_000061: prayer-anchored breaks back to fixed clock times.
-- Dhuhr breaks start at 13:00 and Asr breaks at 16:45, each keeping its length.
CREATE TEMP TABLE _fixed_breaks ON COMMIT DROP AS
SELECT 'employee_work_profiles'::text AS tbl, p.id,
       (SELECT json_agg(
                 CASE
                   WHEN r.value->>'anchor' IN ('dhuhr', 'asr') THEN
                     (r.value::jsonb - 'anchor')
                     || jsonb_build_object(
                          'minutes', m.minutes,
                          'start_time', lpad((m.start_min / 60)::text, 2, '0') || ':' || lpad((m.start_min % 60)::text, 2, '0'),
                          'end_time',   lpad((m.end_min / 60)::text, 2, '0')   || ':' || lpad((m.end_min % 60)::text, 2, '0'))
                   ELSE r.value::jsonb
                 END ORDER BY r.ordinality)
          FROM json_array_elements(p.break_rules) WITH ORDINALITY AS r(value, ordinality)
          CROSS JOIN LATERAL (
            SELECT s.minutes, s.start_min, LEAST(s.start_min + s.minutes, 23 * 60 + 59) AS end_min
            FROM (SELECT COALESCE(NULLIF((r.value->>'minutes')::int, 0),
                                  CASE WHEN r.value->>'anchor' = 'dhuhr' THEN 30 ELSE 15 END) AS minutes,
                         CASE WHEN r.value->>'anchor' = 'dhuhr' THEN 13 * 60 ELSE 16 * 60 + 45 END AS start_min) s
          ) m)::json AS fixed
FROM employee_work_profiles p
WHERE p.break_rules IS NOT NULL
  AND json_typeof(p.break_rules) = 'array'
  AND EXISTS (SELECT 1 FROM json_array_elements(p.break_rules) e WHERE e->>'anchor' IN ('dhuhr', 'asr'))
UNION ALL
SELECT 'work_schedule_overrides', o.id,
       (SELECT json_agg(
                 CASE
                   WHEN r.value->>'anchor' IN ('dhuhr', 'asr') THEN
                     (r.value::jsonb - 'anchor')
                     || jsonb_build_object(
                          'minutes', m.minutes,
                          'start_time', lpad((m.start_min / 60)::text, 2, '0') || ':' || lpad((m.start_min % 60)::text, 2, '0'),
                          'end_time',   lpad((m.end_min / 60)::text, 2, '0')   || ':' || lpad((m.end_min % 60)::text, 2, '0'))
                   ELSE r.value::jsonb
                 END ORDER BY r.ordinality)
          FROM json_array_elements(o.break_rules) WITH ORDINALITY AS r(value, ordinality)
          CROSS JOIN LATERAL (
            SELECT s.minutes, s.start_min, LEAST(s.start_min + s.minutes, 23 * 60 + 59) AS end_min
            FROM (SELECT COALESCE(NULLIF((r.value->>'minutes')::int, 0),
                                  CASE WHEN r.value->>'anchor' = 'dhuhr' THEN 30 ELSE 15 END) AS minutes,
                         CASE WHEN r.value->>'anchor' = 'dhuhr' THEN 13 * 60 ELSE 16 * 60 + 45 END AS start_min) s
          ) m)::json
FROM work_schedule_overrides o
WHERE o.break_rules IS NOT NULL
  AND json_typeof(o.break_rules) = 'array'
  AND EXISTS (SELECT 1 FROM json_array_elements(o.break_rules) e WHERE e->>'anchor' IN ('dhuhr', 'asr'));

UPDATE employee_work_profiles p SET break_rules = f.fixed
FROM _fixed_breaks f WHERE f.tbl = 'employee_work_profiles' AND f.id = p.id;

UPDATE work_schedule_overrides o SET break_rules = f.fixed
FROM _fixed_breaks f WHERE f.tbl = 'work_schedule_overrides' AND f.id = o.id;

UPDATE alembic_version SET version_num = '20261017_000061';

-- 20261017_000062: saved-breaks on/off periods replace the single effective date.
CREATE TABLE financial_policy_periods (
  id UUID NOT NULL,
  company_id UUID NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE,
  started_by_admin_user_id UUID,
  ended_by_admin_user_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE CASCADE,
  FOREIGN KEY (started_by_admin_user_id) REFERENCES admin_users (id) ON DELETE SET NULL,
  FOREIGN KEY (ended_by_admin_user_id) REFERENCES admin_users (id) ON DELETE SET NULL
);
CREATE INDEX ix_financial_policy_periods_company_id ON financial_policy_periods (company_id);

-- A company that already had a start date keeps it as one open period.
INSERT INTO financial_policy_periods (id, company_id, starts_on)
SELECT gen_random_uuid(), company_id, financial_policy_effective_date
FROM company_payroll_settings
WHERE financial_policy_effective_date IS NOT NULL;

ALTER TABLE company_payroll_settings DROP COLUMN financial_policy_effective_date;

UPDATE alembic_version SET version_num = '20261017_000062';

COMMIT;
