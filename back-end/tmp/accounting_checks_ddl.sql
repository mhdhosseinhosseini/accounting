--
-- PostgreSQL database dump
--

\restrict rjxhi5IfctgZmbAPiUy08wO0O1uBk0crdOKJqIRx2tj0kvOlhQCNacZ8bexyFXt

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
-- Name: checks; Type: TABLE; Schema: accounting; Owner: -
--

CREATE TABLE accounting.checks (
    id text NOT NULL,
    type text NOT NULL,
    payment_id text,
    number text NOT NULL,
    bank_name text,
    issuer text,
    beneficiary text,
    issue_date timestamp with time zone NOT NULL,
    due_date timestamp with time zone,
    amount numeric(18,2) NOT NULL,
    currency text DEFAULT 'IRR'::text NOT NULL,
    status text DEFAULT 'created'::text NOT NULL,
    deposit_date timestamp with time zone,
    deposit_bank_account_id text,
    clear_date timestamp with time zone,
    return_date timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    checkbook_id text,
    beneficiary_detail_id text,
    sayadi_code text,
    cashbox_id text,
    CONSTRAINT checks_type_check CHECK ((type = ANY (ARRAY['incoming'::text, 'outgoing'::text]))),
    CONSTRAINT chk_checks_status CHECK ((status = ANY (ARRAY['created'::text, 'issued'::text, 'incashbox'::text, 'spent'::text, 'deposited'::text, 'cleared'::text, 'returned'::text])))
);


--
-- Name: checks checks_pkey; Type: CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.checks
    ADD CONSTRAINT checks_pkey PRIMARY KEY (id);


--
-- Name: idx_checks_cashbox; Type: INDEX; Schema: accounting; Owner: -
--

CREATE INDEX idx_checks_cashbox ON accounting.checks USING btree (cashbox_id);


--
-- Name: idx_checks_checkbook; Type: INDEX; Schema: accounting; Owner: -
--

CREATE INDEX idx_checks_checkbook ON accounting.checks USING btree (checkbook_id);


--
-- Name: idx_checks_deposit_bank; Type: INDEX; Schema: accounting; Owner: -
--

CREATE INDEX idx_checks_deposit_bank ON accounting.checks USING btree (deposit_bank_account_id);


--
-- Name: idx_checks_due_date; Type: INDEX; Schema: accounting; Owner: -
--

CREATE INDEX idx_checks_due_date ON accounting.checks USING btree (due_date);


--
-- Name: idx_checks_payment; Type: INDEX; Schema: accounting; Owner: -
--

CREATE INDEX idx_checks_payment ON accounting.checks USING btree (payment_id);


--
-- Name: idx_checks_status; Type: INDEX; Schema: accounting; Owner: -
--

CREATE INDEX idx_checks_status ON accounting.checks USING btree (status);


--
-- Name: uniq_outgoing_check_serial; Type: INDEX; Schema: accounting; Owner: -
--

CREATE UNIQUE INDEX uniq_outgoing_check_serial ON accounting.checks USING btree (checkbook_id, number) WHERE (type = 'outgoing'::text);


--
-- Name: checks checks_beneficiary_detail_id_fkey; Type: FK CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.checks
    ADD CONSTRAINT checks_beneficiary_detail_id_fkey FOREIGN KEY (beneficiary_detail_id) REFERENCES accounting.details(id) ON DELETE SET NULL;


--
-- Name: checks checks_cashbox_id_fkey; Type: FK CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.checks
    ADD CONSTRAINT checks_cashbox_id_fkey FOREIGN KEY (cashbox_id) REFERENCES accounting.cashboxes(id) ON DELETE SET NULL;


--
-- Name: checks checks_checkbook_id_fkey; Type: FK CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.checks
    ADD CONSTRAINT checks_checkbook_id_fkey FOREIGN KEY (checkbook_id) REFERENCES accounting.checkbooks(id) ON DELETE SET NULL;


--
-- Name: checks checks_deposit_bank_account_id_fkey; Type: FK CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.checks
    ADD CONSTRAINT checks_deposit_bank_account_id_fkey FOREIGN KEY (deposit_bank_account_id) REFERENCES accounting.bank_accounts(id) ON DELETE SET NULL;


--
-- Name: checks checks_payment_id_fkey; Type: FK CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.checks
    ADD CONSTRAINT checks_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES accounting.treasury_payments(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict rjxhi5IfctgZmbAPiUy08wO0O1uBk0crdOKJqIRx2tj0kvOlhQCNacZ8bexyFXt

