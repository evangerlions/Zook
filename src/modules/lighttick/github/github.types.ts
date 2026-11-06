import type { LightTickOwner } from "../lighttick.types.ts";
import type { AesGcmJsonEnvelope } from "../../../services/aes-gcm-payload-crypto.service.ts";
export interface GitHubState {
  mode: "default" | "custom";
  revision: number;
  repository: string | null;
  branch: string | null;
  secret: AesGcmJsonEnvelope | null;
  updated_at: string | null;
}
export interface GitHubTest extends LightTickOwner {
  id: string;
  revision: number;
  settings_revision: number;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  target: "saved" | "draft";
  draft_secret: AesGcmJsonEnvelope | null;
  request_key: string;
  attempt: number;
  fence: string | null;
  lease_until: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}
export interface GitHubRepository {
  get(o: LightTickOwner): Promise<GitHubState | undefined>;
  save(o: LightTickOwner, row: GitHubState, base: number): Promise<void>;
  test(o: LightTickOwner, id: string): Promise<GitHubTest | undefined>;
  saveTest(row: GitHubTest, base: number): Promise<void>;
  active(o: LightTickOwner): Promise<boolean>;
  running(o: LightTickOwner, now: string): Promise<number>;
  recent(o: LightTickOwner, since: string): Promise<GitHubTest[]>;
  recoverable(now: string): Promise<GitHubTest[]>;
}
