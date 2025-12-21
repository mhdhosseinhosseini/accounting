SET search_path TO accounting, public;
SET session_replication_role = replica;
\i /Users/hsn/project/reacts/greenbunch/greenbunch/accounting/back-end/tmp/accounting_data.sql
SET session_replication_role = origin;