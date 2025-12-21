--
-- PostgreSQL database dump
--

\restrict a7I5wPdQN6ucj9aHgk8d1qSMgI4jjjAyZdGt5Izx4Z2EuQJ8oTPbVuc2bNtUdTX

-- Dumped from database version 17.5
-- Dumped by pg_dump version 17.7 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: checkbooks; Type: TABLE; Schema: accounting; Owner: -
--

CREATE TABLE accounting.checkbooks (
    id text NOT NULL,
    bank_account_id text NOT NULL,
    series text,
    start_number integer NOT NULL,
    page_count integer NOT NULL,
    issue_date timestamp with time zone,
    received_date timestamp with time zone,
    status text DEFAULT 'active'::text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sayadi_code text,
    CONSTRAINT checkbooks_status_check CHECK ((status = ANY (ARRAY['active'::text, 'archived'::text, 'exhausted'::text, 'lost'::text, 'damaged'::text])))
);


--
-- Name: checkbooks checkbooks_pkey; Type: CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.checkbooks
    ADD CONSTRAINT checkbooks_pkey PRIMARY KEY (id);


--
-- Name: idx_checkbooks_bank_account; Type: INDEX; Schema: accounting; Owner: -
--

CREATE INDEX idx_checkbooks_bank_account ON accounting.checkbooks USING btree (bank_account_id);


--
-- Name: checkbooks checkbooks_bank_account_id_fkey; Type: FK CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.checkbooks
    ADD CONSTRAINT checkbooks_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES accounting.bank_accounts(id) ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--

\unrestrict a7I5wPdQN6ucj9aHgk8d1qSMgI4jjjAyZdGt5Izx4Z2EuQJ8oTPbVuc2bNtUdTX

