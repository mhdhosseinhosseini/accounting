-- 0011_bank_accounts_link_bank_id.sql
-- Attempt to auto-link bank_accounts.bank_id based on composite bank_name label
-- Format expected: "BankName - BranchName - #BranchNumber"; variants without branch_name/number are also handled.

-- 1) Match by name + branch_name + branch_number when all are present
UPDATE bank_accounts a
SET bank_id = b.id
FROM banks b
WHERE a.bank_id IS NULL
  AND a.bank_name IS NOT NULL
  AND a.bank_name <> ''
  AND trim(split_part(a.bank_name, ' - ', 1)) = b.name
  AND trim(CASE WHEN a.bank_name LIKE '% - #%'
                THEN split_part(split_part(a.bank_name, ' - ', 2), ' - #', 1)
                ELSE split_part(a.bank_name, ' - ', 2)
           END) = COALESCE(b.branch_name, '')
  AND (
    CASE WHEN a.bank_name ~ '#[0-9]+$'
         THEN (regexp_replace(a.bank_name, '.*#([0-9]+)$', '\1'))::int
         ELSE NULL
    END
  ) IS NOT DISTINCT FROM b.branch_number;

-- 2) Match by name + branch_name when branch_number is absent
UPDATE bank_accounts a
SET bank_id = b.id
FROM banks b
WHERE a.bank_id IS NULL
  AND a.bank_name IS NOT NULL
  AND a.bank_name <> ''
  AND trim(split_part(a.bank_name, ' - ', 1)) = b.name
  AND trim(CASE WHEN a.bank_name LIKE '% - #%'
                THEN split_part(split_part(a.bank_name, ' - ', 2), ' - #', 1)
                ELSE split_part(a.bank_name, ' - ', 2)
           END) = COALESCE(b.branch_name, '')
  AND NOT (a.bank_name ~ '#[0-9]+$');

-- 3) Match by name + branch_number when branch_name is absent
UPDATE bank_accounts a
SET bank_id = b.id
FROM banks b
WHERE a.bank_id IS NULL
  AND a.bank_name IS NOT NULL
  AND a.bank_name <> ''
  AND trim(split_part(a.bank_name, ' - ', 1)) = b.name
  AND (
    CASE WHEN a.bank_name ~ '#[0-9]+$'
         THEN (regexp_replace(a.bank_name, '.*#([0-9]+)$', '\1'))::int
         ELSE NULL
    END
  ) IS NOT DISTINCT FROM b.branch_number
  AND (
    CASE WHEN a.bank_name LIKE '% - #%'
         THEN split_part(split_part(a.bank_name, ' - ', 2), ' - #', 1)
         ELSE split_part(a.bank_name, ' - ', 2)
    END
  ) IS NULL;

-- 4) Match by name only when branch info not present in label
UPDATE bank_accounts a
SET bank_id = b.id
FROM banks b
WHERE a.bank_id IS NULL
  AND a.bank_name IS NOT NULL
  AND a.bank_name <> ''
  AND trim(split_part(a.bank_name, ' - ', 1)) = b.name
  AND NOT (a.bank_name LIKE '% - %');