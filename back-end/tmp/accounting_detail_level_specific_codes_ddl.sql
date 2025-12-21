--
-- PostgreSQL database dump
--

\restrict oGTUTCQ1gVihm7eiZBh73QgedhabLtvMHyGJvO2w98FB5KqOSQsXkttvMzmmKcO

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
-- Name: detail_level_specific_codes; Type: TABLE; Schema: accounting; Owner: -
--

CREATE TABLE accounting.detail_level_specific_codes (
    detail_level_id text NOT NULL,
    code_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: detail_level_specific_codes detail_level_specific_codes_pkey; Type: CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.detail_level_specific_codes
    ADD CONSTRAINT detail_level_specific_codes_pkey PRIMARY KEY (detail_level_id, code_id);


--
-- Name: idx_detail_level_specific_codes_code; Type: INDEX; Schema: accounting; Owner: -
--

CREATE INDEX idx_detail_level_specific_codes_code ON accounting.detail_level_specific_codes USING btree (code_id);


--
-- Name: idx_detail_level_specific_codes_level; Type: INDEX; Schema: accounting; Owner: -
--

CREATE INDEX idx_detail_level_specific_codes_level ON accounting.detail_level_specific_codes USING btree (detail_level_id);


--
-- Name: detail_level_specific_codes detail_level_specific_codes_code_id_fkey; Type: FK CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.detail_level_specific_codes
    ADD CONSTRAINT detail_level_specific_codes_code_id_fkey FOREIGN KEY (code_id) REFERENCES accounting.codes(id) ON DELETE RESTRICT;


--
-- Name: detail_level_specific_codes detail_level_specific_codes_detail_level_id_fkey; Type: FK CONSTRAINT; Schema: accounting; Owner: -
--

ALTER TABLE ONLY accounting.detail_level_specific_codes
    ADD CONSTRAINT detail_level_specific_codes_detail_level_id_fkey FOREIGN KEY (detail_level_id) REFERENCES accounting.detail_levels(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict oGTUTCQ1gVihm7eiZBh73QgedhabLtvMHyGJvO2w98FB5KqOSQsXkttvMzmmKcO

