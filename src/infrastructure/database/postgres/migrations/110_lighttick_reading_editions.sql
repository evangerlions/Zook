-- Immutable source editions retain old private facts and share a discoverable owner-scoped root.
CREATE INDEX IF NOT EXISTS lighttick_reading_edition_root_idx
 ON zook_lighttick_reading_articles(app_id,user_id,(payload->'provenance'->>'root_article_id'),id);
