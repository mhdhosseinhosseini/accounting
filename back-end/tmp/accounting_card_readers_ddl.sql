--
-- PostgreSQL database dump
--

\restrict g0VdflzL76XaGoTxSdn2gz3UR62arKFj0rMem26QohrEPBHqeI32Uxg6jjef6Ov

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
-- Name: card_readers; Type: TABLE; Schema: accounting; Owner: -
--

CREATE TABLE accounting.card_readers (
    id text NOT NULL,
    bank_account_id text NOT NULL,
    psp_provider text NOT NULL,
    terminal_id text NOT NULL,
    merchant_id text,
    device_serial text,
    brand text,
    model text,
    install_date timestamp with time zone,
    last_settlement_date timestamp with time zone,
    is_active boolean DEFAULT true NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    handler_detail_id text
);


--
-- Name: card_readers card_readers_pkey; Type: CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.card_readers
    ADD CONSTRAINT card_readers_pkey PRIMARY KEY (id);


--
-- Name: idx_card_readers_bank_account; Type: INDEX; Schema: accounting; Owner: -
--

CREATE INDEX idx_card_readers_bank_account ON accounting.card_readers USING btree (bank_account_id);


--
-- Name: uniq_card_readers_psp_terminal; Type: INDEX; Schema: accounting; Owner: -
--

CREATE UNIQUE INDEX uniq_card_readers_psp_terminal ON accounting.card_readers USING btree (psp_provider, terminal_id);


--
-- Name: card_readers card_readers_bank_account_id_fkey; Type: FK CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.card_readers
    ADD CONSTRAINT card_readers_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES accounting.bank_accounts(id) ON DELETE RESTRICT;


--
-- Name: card_readers card_readers_handler_detail_id_fkey; Type: FK CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.card_readers
    ADD CONSTRAINT card_readers_handler_detail_id_fkey FOREIGN KEY (handler_detail_id) REFERENCES accounting.details(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict g0VdflzL76XaGoTxSdn2gz3UR62arKFj0rMem26QohrEPBHqeI32Uxg6jjef6Ov

