--
-- PostgreSQL database dump
--

\restrict D1c05ShjdhJsuBd5ofYmgoHPEyTsphW7Xypy4CNjdP4j5lvfLJYX89gG3sTqWPx

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
-- Name: banks; Type: TABLE; Schema: accounting; Owner: -
--

CREATE TABLE accounting.banks (
    id text NOT NULL,
    name text NOT NULL,
    branch_number integer,
    branch_name text,
    city text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: banks banks_pkey; Type: CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.banks
    ADD CONSTRAINT banks_pkey PRIMARY KEY (id);


--
-- Name: idx_banks_branch_number; Type: INDEX; Schema: accounting; Owner: -
--

CREATE INDEX idx_banks_branch_number ON accounting.banks USING btree (branch_number);


--
-- Name: idx_banks_city; Type: INDEX; Schema: accounting; Owner: -
--

CREATE INDEX idx_banks_city ON accounting.banks USING btree (city);


--
-- PostgreSQL database dump complete
--

\unrestrict D1c05ShjdhJsuBd5ofYmgoHPEyTsphW7Xypy4CNjdP4j5lvfLJYX89gG3sTqWPx

