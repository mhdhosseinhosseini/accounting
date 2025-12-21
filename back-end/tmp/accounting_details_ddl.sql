--
-- PostgreSQL database dump
--

\restrict uRn2XwI7Ue0wrGEiYZSSxHorbCfa5QTl5qQJ6UNkLZyjxZ2ORZWwnQpfsMnmveo

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
-- Name: details; Type: TABLE; Schema: accounting; Owner: -
--

CREATE TABLE accounting.details (
    id text NOT NULL,
    code text NOT NULL,
    title text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    kind boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: details details_code_key; Type: CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.details
    ADD CONSTRAINT details_code_key UNIQUE (code);


--
-- Name: details details_pkey; Type: CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.details
    ADD CONSTRAINT details_pkey PRIMARY KEY (id);


--
-- PostgreSQL database dump complete
--

\unrestrict uRn2XwI7Ue0wrGEiYZSSxHorbCfa5QTl5qQJ6UNkLZyjxZ2ORZWwnQpfsMnmveo

