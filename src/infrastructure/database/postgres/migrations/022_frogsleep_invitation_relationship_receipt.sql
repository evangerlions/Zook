ALTER TABLE zook_frogsleep_buddy_invitation_domain_decisions
  ADD COLUMN IF NOT EXISTS relationship_id TEXT;

-- Recover only the relationship created by this decision, never the current slot.
UPDATE zook_frogsleep_buddy_invitation_domain_decisions d
SET relationship_id = r.id
FROM zook_frogsleep_buddy_invitation_bundles b,
     zook_frogsleep_buddy_domain_relationships r
WHERE d.app_id=b.app_id AND d.invitation_id=b.id AND d.status='accepted'
  AND d.relationship_id IS NULL AND r.app_id=d.app_id AND r.domain=d.domain
  AND r.user_id_low=LEAST(b.inviter_user_id,b.invitee_user_id)
  AND r.user_id_high=GREATEST(b.inviter_user_id,b.invitee_user_id)
  AND r.created_at=d.decided_at
  AND (SELECT COUNT(*) FROM zook_frogsleep_buddy_domain_relationships candidate
       WHERE candidate.app_id=r.app_id AND candidate.domain=r.domain
         AND candidate.user_id_low=r.user_id_low AND candidate.user_id_high=r.user_id_high
         AND candidate.created_at=d.decided_at)=1;
