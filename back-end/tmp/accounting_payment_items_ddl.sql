--
-- PostgreSQL database dump
--

\restrict HWw1LUTQSEV3yz21jbgci1ft7zROSlqpKscjCOuHnZjQqDpATXWryaycFsJC2kf

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
-- Name: payment_items; Type: TABLE; Schema: accounting; Owner: -
--

CREATE TABLE accounting.payment_items (
    id text NOT NULL,
    payment_id text NOT NULL,
    instrument_type text NOT NULL,
    amount numeric(18,2) NOT NULL,
    "position" integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reference text,
    bank_account_id text,
    check_id text,
    CONSTRAINT payment_items_instrument_type_check CHECK ((instrument_type = ANY (ARRAY['cash'::text, 'card'::text, 'transfer'::text, 'check'::text, 'checkin'::text])))
);


--
-- Name: payment_items payment_items_pkey; Type: CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.payment_items
    ADD CONSTRAINT payment_items_pkey PRIMARY KEY (id);


--
-- Name: idx_payment_items_payment; Type: INDEX; Schema: accounting; Owner: -
--

CREATE INDEX idx_payment_items_payment ON accounting.payment_items USING btree (payment_id);


--
-- Name: uniq_payment_items_reference; Type: INDEX; Schema: accounting; Owner: -
--

CREATE UNIQUE INDEX uniq_payment_items_reference ON accounting.payment_items USING btree (reference) WHERE (reference IS NOT NULL);


--
-- Name: payment_items payment_items_bank_account_id_fkey; Type: FK CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.payment_items
    ADD CONSTRAINT payment_items_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES accounting.bank_accounts(id) ON DELETE SET NULL;


--
-- Name: payment_items payment_items_check_id_fkey; Type: FK CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.payment_items
    ADD CONSTRAINT payment_items_check_id_fkey FOREIGN KEY (check_id) REFERENCES accounting.checks(id) ON DELETE SET NULL;


--
-- Name: payment_items payment_items_payment_id_fkey; Type: FK CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.payment_items
    ADD CONSTRAINT payment_items_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES accounting.payments(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict HWw1LUTQSEV3yz21jbgci1ft7zROSlqpKscjCOuHnZjQqDpATXWryaycFsJC2kf

