CREATE TABLE IF NOT EXISTS zook_frogsleep_support_policies (
 app_id text NOT NULL, relationship_id text NOT NULL, policy_version integer NOT NULL DEFAULT 1 CHECK(policy_version=1),
 enrolled_at timestamptz NOT NULL, PRIMARY KEY(app_id,relationship_id)
);
CREATE TABLE IF NOT EXISTS zook_frogsleep_support_permissions (
 app_id text NOT NULL, relationship_id text NOT NULL, recipient_id text NOT NULL, enabled boolean NOT NULL DEFAULT false,
 revision integer NOT NULL CHECK(revision>0), updated_at timestamptz NOT NULL,
 PRIMARY KEY(app_id,relationship_id,recipient_id)
);
CREATE TABLE IF NOT EXISTS zook_frogsleep_support_notes (
 app_id text NOT NULL, id text NOT NULL, relationship_id text NOT NULL, domain text NOT NULL CHECK(domain IN ('sleep','focus')),
 sender_id text NOT NULL, recipient_id text NOT NULL, template_key text, template_version integer NOT NULL DEFAULT 1,
 flower boolean NOT NULL DEFAULT false, context jsonb, created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 PRIMARY KEY(app_id,id), CHECK(sender_id<>recipient_id), CHECK(template_key IS NOT NULL OR flower),
 CHECK(expires_at>created_at), CHECK(context IS NULL OR jsonb_typeof(context)='object')
);
CREATE INDEX IF NOT EXISTS idx_support_sent ON zook_frogsleep_support_notes(app_id,sender_id,recipient_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_inbox ON zook_frogsleep_support_notes(app_id,recipient_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_support_outbox ON zook_frogsleep_support_notes(app_id,sender_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_support_relationship ON zook_frogsleep_support_notes(app_id,relationship_id);
CREATE INDEX IF NOT EXISTS idx_support_expiry ON zook_frogsleep_support_notes(expires_at,id);
CREATE TABLE IF NOT EXISTS zook_frogsleep_support_operations (
 app_id text NOT NULL, actor_id text NOT NULL, operation_id text NOT NULL, command_type text NOT NULL CHECK(command_type IN ('send','permission','ack')),
 relationship_id text NOT NULL, request_digest text NOT NULL, state text NOT NULL CHECK(state IN ('accepted','not_sent')),
 resource_id text, result jsonb, created_at timestamptz NOT NULL, PRIMARY KEY(app_id,actor_id,operation_id)
);
CREATE INDEX IF NOT EXISTS idx_support_operations_expiry ON zook_frogsleep_support_operations(created_at);
CREATE TABLE IF NOT EXISTS zook_frogsleep_support_acknowledgements (
 app_id text NOT NULL, note_id text NOT NULL, recipient_id text NOT NULL, acknowledged_at timestamptz NOT NULL,
 PRIMARY KEY(app_id,note_id), FOREIGN KEY(app_id,note_id) REFERENCES zook_frogsleep_support_notes(app_id,id) ON DELETE CASCADE
);
