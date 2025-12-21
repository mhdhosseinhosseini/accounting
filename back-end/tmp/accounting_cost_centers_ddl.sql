--
-- PostgreSQL database dump
--

\restrict BA8nau3sHb0TZJK1QKcjnT6T2I6gomYe2ac4re18fH4nzVtp5qncg6ylkc2hLEx

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
-- Name: cost_centers; Type: TABLE; Schema: accounting; Owner: -
--

CREATE TABLE accounting.cost_centers (
    id text NOT NULL,
    code text NOT NULL,
    title text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cost_centers cost_centers_code_key; Type: CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.cost_centers
    ADD CONSTRAINT cost_centers_code_key UNIQUE (code);


--
-- Name: cost_centers cost_centers_pkey; Type: CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.cost_centers
    ADD CONSTRAINT cost_centers_pkey PRIMARY KEY (id);


--
-- PostgreSQL database dump complete
--

\unrestrict BA8nau3sHb0TZJK1QKcjnT6T2I6gomYe2ac4re18fH4nzVtp5qncg6ylkc2hLEx

