import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import type {
  Invitation,
  Trial,
  ParticipationStore,
} from "../../../modules/lighttick/participation/participation.types.ts";
import type { QueryResult } from "./postgres-lighttick-owner-transaction.ts";
export class PostgresParticipationStore implements ParticipationStore {
  constructor(
    private readonly query: (
      sql: string,
      args?: unknown[],
    ) => Promise<QueryResult>,
  ) {}
  private map(r: any): Invitation {
    return {
      id: r.id,
      userId: r.user_id,
      createdAt: new Date(r.created_at).toISOString(),
      expiresAt: new Date(r.expires_at).toISOString(),
      revoked: r.revoked,
      usedAt: r.used_at ? new Date(r.used_at).toISOString() : null,
      tokenHash: r.token_hash,
    };
  }
  async activeCount(o: LightTickOwner, now: string) {
    return Number(
      (
        await this.query(
          "SELECT count(*) AS n FROM zook_lighttick_registration_invitations WHERE app_id=$1 AND user_id=$2 AND used_at IS NULL AND revoked=FALSE AND expires_at>$3",
          [o.appId, o.userId, now],
        )
      ).rows[0].n,
    );
  }
  async list(o: LightTickOwner) {
    return (
      await this.query(
        "SELECT * FROM zook_lighttick_registration_invitations WHERE app_id=$1 AND user_id=$2 ORDER BY created_at DESC,id DESC LIMIT 100",
        [o.appId, o.userId],
      )
    ).rows.map((r) => this.map(r));
  }
  async get(id: string, lock = false) {
    const r = (
      await this.query(
        "SELECT * FROM zook_lighttick_registration_invitations WHERE app_id=$1 AND id=$2" +
          (lock ? " FOR UPDATE" : ""),
        ["lighttick", id],
      )
    ).rows[0];
    return r ? this.map(r) : undefined;
  }
  async save(o: LightTickOwner, i: Invitation) {
    await this.query(
      "INSERT INTO zook_lighttick_registration_invitations VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(app_id,user_id,id) DO UPDATE SET revoked=EXCLUDED.revoked,used_at=EXCLUDED.used_at",
      [
        o.appId,
        o.userId,
        i.id,
        i.createdAt,
        i.expiresAt,
        i.revoked,
        i.usedAt,
        i.tokenHash,
      ],
    );
  }
  async claim(o: LightTickOwner, id: string) {
    await this.query(
      "INSERT INTO zook_lighttick_invitation_claims VALUES($1,$2,$3)",
      [o.appId, o.userId, id],
    );
  }
  async claimed(o: LightTickOwner) {
    return (
      await this.query(
        "SELECT invitation_id FROM zook_lighttick_invitation_claims WHERE app_id=$1 AND user_id=$2",
        [o.appId, o.userId],
      )
    ).rows[0]?.invitation_id as string | undefined;
  }
  async trial(o: LightTickOwner) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_trial_participation WHERE app_id=$1 AND user_id=$2",
        [o.appId, o.userId],
      )
    ).rows[0]?.payload as Trial | undefined;
  }
  async saveTrial(o: LightTickOwner, t: Trial) {
    await this.query(
      "INSERT INTO zook_lighttick_trial_participation VALUES($1,$2,$3) ON CONFLICT(app_id,user_id) DO UPDATE SET payload=EXCLUDED.payload",
      [o.appId, o.userId, t],
    );
  }
}
