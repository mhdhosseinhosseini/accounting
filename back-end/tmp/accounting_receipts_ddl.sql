--
-- PostgreSQL database dump
--

\restrict U6KAmqba0BlZxmje5ozXXq8toEQ9EZOa5hDCNy3cp2wX1wjN7hrTR5j7CXayHUV

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
-- Name: receipts; Type: TABLE; Schema: accounting; Owner: -
--

CREATE TABLE accounting.receipts (
    id text NOT NULL,
    number text,
    status text DEFAULT 'temporary'::text NOT NULL,
    date timestamp with time zone NOT NULL,
    fiscal_year_id text,
    detail_id text,
    description text,
    total_amount numeric(18,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    special_code_id text,
    cashbox_id text,
    journal_id text
);


--
-- Name: receipts receipts_pkey; Type: CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.receipts
    ADD CONSTRAINT receipts_pkey PRIMARY KEY (id);


--
-- Name: idx_receipts_cashbox; Type: INDEX; Schema: accounting; Owner: -
--

CREATE INDEX idx_receipts_cashbox ON accounting.receipts USING btree (cashbox_id);


--
-- Name: idx_receipts_date; Type: INDEX; Schema: accounting; Owner: -
--

CREATE INDEX idx_receipts_date ON accounting.receipts USING btree (date);


--
-- Name: idx_receipts_fiscal_year; Type: INDEX; Schema: accounting; Owner: -
--

CREATE INDEX idx_receipts_fiscal_year ON accounting.receipts USING btree (fiscal_year_id);


--
-- Name: idx_receipts_journal; Type: INDEX; Schema: accounting; Owner: -
--

CREATE INDEX idx_receipts_journal ON accounting.receipts USING btree (journal_id);


--
-- Name: idx_receipts_special_code; Type: INDEX; Schema: accounting; Owner: -
--

CREATE INDEX idx_receipts_special_code ON accounting.receipts USING btree (special_code_id);


--
-- Name: uniq_receipts_fiscal_number; Type: INDEX; Schema: accounting; Owner: -
--

CREATE UNIQUE INDEX uniq_receipts_fiscal_number ON accounting.receipts USING btree (fiscal_year_id, number) WHERE (number IS NOT NULL);


--
-- Name: receipts receipts_cashbox_id_fkey; Type: FK CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.receipts
    ADD CONSTRAINT receipts_cashbox_id_fkey FOREIGN KEY (cashbox_id) REFERENCES accounting.cashboxes(id) ON DELETE RESTRICT;


--
-- Name: receipts receipts_detail_id_fkey; Type: FK CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.receipts
    ADD CONSTRAINT receipts_detail_id_fkey FOREIGN KEY (detail_id) REFERENCES accounting.details(id) ON DELETE SET NULL;


--
-- Name: receipts receipts_fiscal_year_id_fkey; Type: FK CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.receipts
    ADD CONSTRAINT receipts_fiscal_year_id_fkey FOREIGN KEY (fiscal_year_id) REFERENCES accounting.fiscal_years(id) ON DELETE SET NULL;


--
-- Name: receipts receipts_journal_id_fkey; Type: FK CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.receipts
    ADD CONSTRAINT receipts_journal_id_fkey FOREIGN KEY (journal_id) REFERENCES accounting.journals(id) ON DELETE SET NULL;


--
-- Name: receipts receipts_special_code_id_fkey; Type: FK CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.receipts
    ADD CONSTRAINT receipts_special_code_id_fkey FOREIGN KEY (special_code_id) REFERENCES accounting.codes(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict U6KAmqba0BlZxmje5ozXXq8toEQ9EZOa5hDCNy3cp2wX1wjN7hrTR5j7CXayHUV

