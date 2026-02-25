--
-- PostgreSQL database cluster dump
--

\restrict VWe3RYnQZ21IzYZLGwqiGUKkKbvvErGMfsg8WRi0tVAjGBTHBOIavabApRRra7B

SET default_transaction_read_only = off;

SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;

--
-- Roles
--

CREATE ROLE postgres;
ALTER ROLE postgres WITH SUPERUSER INHERIT CREATEROLE CREATEDB LOGIN REPLICATION BYPASSRLS PASSWORD 'SCRAM-SHA-256$4096:ad1n83rkwPBYd78IaxvMPQ==$epnF+2NbRiRoOil6B0ED/j5Xh+LRfzqzvk0Tw04C+sg=:jkw4o7amLac0A/nkSItQiMLdiqKD5IUf3NIjdxaqZY4=';

--
-- User Configurations
--








\unrestrict VWe3RYnQZ21IzYZLGwqiGUKkKbvvErGMfsg8WRi0tVAjGBTHBOIavabApRRra7B

--
-- PostgreSQL database cluster dump complete
--

