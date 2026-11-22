import type { Client } from "pg";

/** Convert the old Grow table layouts before the common migration files reference them. */
export async function prepareLegacyLightTickLayout(client: Client) {
  await client.query(`
    DO $layout$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('zook_lighttick_reading_articles')
          AND attname = 'payload' AND NOT attisdropped
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('zook_lighttick_reading_articles')
          AND attname = 'url' AND NOT attisdropped
      ) THEN
        IF to_regclass('zook_lighttick_independent_reading_articles') IS NOT NULL
          OR to_regclass('zook_lighttick_independent_reading_versions') IS NOT NULL THEN
          RAISE EXCEPTION 'Conflicting independent LightTick reading layouts need reconciliation';
        END IF;
        ALTER TABLE zook_lighttick_reading_articles RENAME TO zook_lighttick_independent_reading_articles;
        IF to_regclass('zook_lighttick_reading_versions') IS NOT NULL THEN
          ALTER TABLE zook_lighttick_reading_versions RENAME TO zook_lighttick_independent_reading_versions;
        END IF;
      END IF;

      IF EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('zook_lighttick_learning_modules')
          AND attname = 'payload' AND NOT attisdropped
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass('zook_lighttick_learning_modules')
          AND attname = 'title' AND NOT attisdropped
      ) THEN
        ALTER TABLE zook_lighttick_learning_modules
          ADD COLUMN title TEXT,
          ADD COLUMN description TEXT NOT NULL DEFAULT '',
          ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT true,
          ADD COLUMN source_type TEXT NOT NULL DEFAULT 'manual',
          ADD COLUMN source_url TEXT,
          ADD COLUMN source_path TEXT,
          ADD COLUMN template_id TEXT,
          ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          ALTER COLUMN payload DROP NOT NULL;
        UPDATE zook_lighttick_learning_modules SET
          title = payload->>'title',
          description = COALESCE(payload->>'description', ''),
          enabled = NOT COALESCE((payload->>'archived')::boolean, false),
          template_id = payload->>'templateId',
          created_at = COALESCE((payload->>'createdAt')::timestamptz, created_at),
          updated_at = COALESCE((payload->>'updatedAt')::timestamptz, updated_at);
        ALTER TABLE zook_lighttick_learning_modules ALTER COLUMN title SET NOT NULL;
      END IF;
    END
    $layout$;
  `);
}
