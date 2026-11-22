export function recordTextMatches(parameter: string) {
  return `(position(${parameter} in lower(payload->>'raw_text')) > 0
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(payload->'tags') = 'array'
        THEN payload->'tags' ELSE '[]'::jsonb END) AS tags(value)
      WHERE position(${parameter} in lower(tags.value)) > 0
    )
    OR EXISTS (
      SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(payload->'guided_answers') = 'object'
        THEN payload->'guided_answers' ELSE '{}'::jsonb END) AS answers(key, value)
      WHERE jsonb_typeof(answers.value) = 'string' AND position(${parameter} in lower(answers.value #>> '{}')) > 0
    ))`;
}
