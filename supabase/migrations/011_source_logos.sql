-- 011_source_logos.sql
-- Populate sources.logo_url for all rows using the Google S2 favicon
-- service. The service is free, deterministic, and always-available:
--   https://www.google.com/s2/favicons?domain=<hostname>&sz=64
--
-- Rationale: the sources.logo_url column is currently NULL for all 144
-- rows. Having a per-source logo gives the UI a reliable visual fallback
-- when an article lacks an og:image, and it is also useful inside cluster
-- cards to show the source brand next to each article.
--
-- We derive the hostname from sources.url (e.g. https://www.sabah.com.tr)
-- by stripping the optional scheme and leading "www." prefix, then take
-- everything up to the first slash.
--
-- This is idempotent-adjacent: it only touches rows where logo_url IS
-- NULL, so re-running after a partial failure will not overwrite
-- previously populated rows. To intentionally refresh, clear logo_url
-- first.

begin;

update sources
set logo_url = 'https://www.google.com/s2/favicons?domain=' ||
               regexp_replace(url, '^https?://(www\.)?([^/]+).*$', '\2') ||
               '&sz=64'
where logo_url is null;

commit;
