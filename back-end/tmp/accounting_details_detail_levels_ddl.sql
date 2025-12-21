--
-- PostgreSQL database dump
--

\restrict zTOl5gMkcxvVdumm22okiK5BzYG16beCBmGw7D1aEutnL9DJhS0ASu3B93f6ALB

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
-- Name: details_detail_levels; Type: TABLE; Schema: accounting; Owner: -
--

CREATE TABLE accounting.details_detail_levels (
    detail_id text NOT NULL,
    detail_level_id text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    "position" integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: details_detail_levels details_detail_levels_pkey; Type: CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.details_detail_levels
    ADD CONSTRAINT details_detail_levels_pkey PRIMARY KEY (detail_id, detail_level_id);


--
-- Name: idx_details_detail_levels_detail; Type: INDEX; Schema: accounting; Owner: -
--

CREATE INDEX idx_details_detail_levels_detail ON accounting.details_detail_levels USING btree (detail_id);


--
-- Name: idx_details_detail_levels_level; Type: INDEX; Schema: accounting; Owner: -
--

CREATE INDEX idx_details_detail_levels_level ON accounting.details_detail_levels USING btree (detail_level_id);


--
-- Name: details_detail_levels details_detail_levels_detail_id_fkey; Type: FK CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.details_detail_levels
    ADD CONSTRAINT details_detail_levels_detail_id_fkey FOREIGN KEY (detail_id) REFERENCES accounting.details(id) ON DELETE RESTRICT;


--
-- Name: details_detail_levels details_detail_levels_detail_level_id_fkey; Type: FK CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.details_detail_levels
    ADD CONSTRAINT details_detail_levels_detail_level_id_fkey FOREIGN KEY (detail_level_id) REFERENCES accounting.detail_levels(id) ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--

\unrestrict zTOl5gMkcxvVdumm22okiK5BzYG16beCBmGw7D1aEutnL9DJhS0ASu3B93f6ALB

