--
-- PostgreSQL database dump
--

\restrict QYH6I1L4HrOMTWihehBn0qZysaTpags8SQcHBO2ObGbSBSANV4boJ3mpxmOXed6

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
-- Name: receipt_items; Type: TABLE; Schema: accounting; Owner: -
--

CREATE TABLE accounting.receipt_items (
    id text NOT NULL,
    receipt_id text NOT NULL,
    instrument_type text NOT NULL,
    amount numeric(18,2) NOT NULL,
    "position" integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reference text,
    bank_account_id text,
    card_reader_id text,
    check_id text,
    CONSTRAINT receipt_items_instrument_type_check CHECK ((instrument_type = ANY (ARRAY['cash'::text, 'card'::text, 'transfer'::text, 'check'::text])))
);


--
-- Name: receipt_items receipt_items_pkey; Type: CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.receipt_items
    ADD CONSTRAINT receipt_items_pkey PRIMARY KEY (id);


--
-- Name: idx_receipt_items_receipt; Type: INDEX; Schema: accounting; Owner: -
--

CREATE INDEX idx_receipt_items_receipt ON accounting.receipt_items USING btree (receipt_id);


--
-- Name: uniq_receipt_items_reference; Type: INDEX; Schema: accounting; Owner: -
--

CREATE UNIQUE INDEX uniq_receipt_items_reference ON accounting.receipt_items USING btree (reference) WHERE (reference IS NOT NULL);


--
-- Name: receipt_items receipt_items_bank_account_id_fkey; Type: FK CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.receipt_items
    ADD CONSTRAINT receipt_items_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES accounting.bank_accounts(id) ON DELETE SET NULL;


--
-- Name: receipt_items receipt_items_card_reader_id_fkey; Type: FK CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.receipt_items
    ADD CONSTRAINT receipt_items_card_reader_id_fkey FOREIGN KEY (card_reader_id) REFERENCES accounting.card_readers(id) ON DELETE SET NULL;


--
-- Name: receipt_items receipt_items_check_id_fkey; Type: FK CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.receipt_items
    ADD CONSTRAINT receipt_items_check_id_fkey FOREIGN KEY (check_id) REFERENCES accounting.checks(id) ON DELETE SET NULL;


--
-- Name: receipt_items receipt_items_receipt_id_fkey; Type: FK CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.receipt_items
    ADD CONSTRAINT receipt_items_receipt_id_fkey FOREIGN KEY (receipt_id) REFERENCES accounting.receipts(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict QYH6I1L4HrOMTWihehBn0qZysaTpags8SQcHBO2ObGbSBSANV4boJ3mpxmOXed6

