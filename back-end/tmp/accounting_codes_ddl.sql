--
-- PostgreSQL database dump
--

\restrict GrUGDfZV1fi3lf8BtAaVYg4v7pBISZGwmsF6uFhbNYT181IWBi7LGfPo5fNcDOM

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
-- Name: codes; Type: TABLE; Schema: accounting; Owner: -
--

CREATE TABLE accounting.codes (
    id text NOT NULL,
    code text NOT NULL,
    title text NOT NULL,
    kind text NOT NULL,
    parent_id text,
    is_active boolean DEFAULT true NOT NULL,
    nature integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    can_have_details boolean DEFAULT true NOT NULL
);


--
-- Name: codes codes_code_key; Type: CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.codes
    ADD CONSTRAINT codes_code_key UNIQUE (code);


--
-- Name: codes codes_pkey; Type: CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.codes
    ADD CONSTRAINT codes_pkey PRIMARY KEY (id);


--
-- Name: codes codes_parent_id_fkey; Type: FK CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.codes
    ADD CONSTRAINT codes_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES accounting.codes(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict GrUGDfZV1fi3lf8BtAaVYg4v7pBISZGwmsF6uFhbNYT181IWBi7LGfPo5fNcDOM

