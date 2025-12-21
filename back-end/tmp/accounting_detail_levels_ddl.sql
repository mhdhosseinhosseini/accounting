--
-- PostgreSQL database dump
--

\restrict x1aSeaAO2JgTd1FsDHARt9A6UUjJivdWuChSKj59ZEzelUhuXxLzToWHt5EplRo

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
-- Name: detail_levels; Type: TABLE; Schema: accounting; Owner: -
--

CREATE TABLE accounting.detail_levels (
    id text NOT NULL,
    code text NOT NULL,
    title text NOT NULL,
    parent_id text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: detail_levels detail_levels_code_key; Type: CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.detail_levels
    ADD CONSTRAINT detail_levels_code_key UNIQUE (code);


--
-- Name: detail_levels detail_levels_pkey; Type: CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.detail_levels
    ADD CONSTRAINT detail_levels_pkey PRIMARY KEY (id);


--
-- Name: idx_detail_levels_parent; Type: INDEX; Schema: accounting; Owner: -
--

CREATE INDEX idx_detail_levels_parent ON accounting.detail_levels USING btree (parent_id);


--
-- Name: detail_levels detail_levels_parent_id_fkey; Type: FK CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.detail_levels
    ADD CONSTRAINT detail_levels_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES accounting.detail_levels(id) ON DELETE SET NULL;


--
-- Name: detail_levels fk_detail_levels_parent; Type: FK CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.detail_levels
    ADD CONSTRAINT fk_detail_levels_parent FOREIGN KEY (parent_id) REFERENCES accounting.detail_levels(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict x1aSeaAO2JgTd1FsDHARt9A6UUjJivdWuChSKj59ZEzelUhuXxLzToWHt5EplRo

