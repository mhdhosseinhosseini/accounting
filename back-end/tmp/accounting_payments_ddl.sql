--
-- PostgreSQL database dump
--

\restrict th2t5FqxS8myHgH422tFHdgFZnFHudRV9pxUyJbpb5IoY8pHXdWvgeASz9lE0uk

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
-- Name: payments; Type: TABLE; Schema: accounting; Owner: -
--

CREATE TABLE accounting.payments (
    id text NOT NULL,
    number text,
    status text DEFAULT 'draft'::text NOT NULL,
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
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: idx_payments_cashbox; Type: INDEX; Schema: accounting; Owner: -
--

CREATE INDEX idx_payments_cashbox ON accounting.payments USING btree (cashbox_id);


--
-- Name: idx_payments_date; Type: INDEX; Schema: accounting; Owner: -
--

CREATE INDEX idx_payments_date ON accounting.payments USING btree (date);


--
-- Name: idx_payments_fiscal_year; Type: INDEX; Schema: accounting; Owner: -
--

CREATE INDEX idx_payments_fiscal_year ON accounting.payments USING btree (fiscal_year_id);


--
-- Name: idx_payments_journal; Type: INDEX; Schema: accounting; Owner: -
--

CREATE INDEX idx_payments_journal ON accounting.payments USING btree (journal_id);


--
-- Name: idx_payments_special_code; Type: INDEX; Schema: accounting; Owner: -
--

CREATE INDEX idx_payments_special_code ON accounting.payments USING btree (special_code_id);


--
-- Name: uniq_payments_fiscal_number; Type: INDEX; Schema: accounting; Owner: -
--

CREATE UNIQUE INDEX uniq_payments_fiscal_number ON accounting.payments USING btree (fiscal_year_id, number) WHERE (number IS NOT NULL);


--
-- Name: payments payments_cashbox_id_fkey; Type: FK CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.payments
    ADD CONSTRAINT payments_cashbox_id_fkey FOREIGN KEY (cashbox_id) REFERENCES accounting.cashboxes(id) ON DELETE RESTRICT;


--
-- Name: payments payments_detail_id_fkey; Type: FK CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.payments
    ADD CONSTRAINT payments_detail_id_fkey FOREIGN KEY (detail_id) REFERENCES accounting.details(id) ON DELETE SET NULL;


--
-- Name: payments payments_fiscal_year_id_fkey; Type: FK CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.payments
    ADD CONSTRAINT payments_fiscal_year_id_fkey FOREIGN KEY (fiscal_year_id) REFERENCES accounting.fiscal_years(id) ON DELETE SET NULL;


--
-- Name: payments payments_journal_id_fkey; Type: FK CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.payments
    ADD CONSTRAINT payments_journal_id_fkey FOREIGN KEY (journal_id) REFERENCES accounting.journals(id) ON DELETE SET NULL;


--
-- Name: payments payments_special_code_id_fkey; Type: FK CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.payments
    ADD CONSTRAINT payments_special_code_id_fkey FOREIGN KEY (special_code_id) REFERENCES accounting.codes(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict th2t5FqxS8myHgH422tFHdgFZnFHudRV9pxUyJbpb5IoY8pHXdWvgeASz9lE0uk

