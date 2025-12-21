--
-- PostgreSQL database dump
--

\restrict 3CfXopTQXZ8Gr4wu9SjydQH1UGWubIDoSaXtKjS56qcOZ4BOjrXVGinHvM7YZyb

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
-- Name: settings; Type: TABLE; Schema: accounting; Owner: -
--

CREATE TABLE accounting.settings (
    id text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    value jsonb,
    type text,
    special_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    special_code text
);


--
-- Name: settings settings_code_key; Type: CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.settings
    ADD CONSTRAINT settings_code_key UNIQUE (code);


--
-- Name: settings settings_pkey; Type: CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.settings
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);


--
-- Name: idx_settings_code; Type: INDEX; Schema: accounting; Owner: -
--

CREATE INDEX idx_settings_code ON accounting.settings USING btree (code);


--
-- PostgreSQL database dump complete
--

\unrestrict 3CfXopTQXZ8Gr4wu9SjydQH1UGWubIDoSaXtKjS56qcOZ4BOjrXVGinHvM7YZyb

