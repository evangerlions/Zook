import type { LightTickOwner } from "../lighttick.types.ts";
import type { AesGcmJsonEnvelope } from "../../../services/aes-gcm-payload-crypto.service.ts";
export interface ModelSelection {
  mode: "platform" | "personal";
  revision: number;
}
export interface PersonalModelState extends ModelSelection {
  base_url: string | null;
  model_name: string | null;
  secret: AesGcmJsonEnvelope | null;
  updated_at: string | null;
}
export interface ModelTest extends LightTickOwner {
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
export interface PersonalModelRepository {
  get(o: LightTickOwner): Promise<PersonalModelState | undefined>;
  save(o: LightTickOwner, row: PersonalModelState, base: number): Promise<void>;
  test(o: LightTickOwner, id: string): Promise<ModelTest | undefined>;
  saveTest(row: ModelTest, base: number): Promise<void>;
  active(o: LightTickOwner): Promise<boolean>;
  running(o: LightTickOwner, now: string): Promise<number>;
  recent(o: LightTickOwner, since: string): Promise<ModelTest[]>;
  recoverable(now: string): Promise<ModelTest[]>;
}
