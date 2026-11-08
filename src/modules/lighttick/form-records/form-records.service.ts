import { formSection, patchFormSection } from "./form-sections.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import type { FormRecords, FormSnapshot } from "./form-records.types.ts";
import { formRecords } from "./form-records.validation.ts";
import {
  keys,
  integer,
  digest,
  fail,
} from "../learning/native-learning.validation.ts";
export const emptyFormRecords = (): FormRecords => ({
  modules: [],
  checkins: {},
  habits: {},
  customFields: [],
  customRecords: [],
  decisions: [],
  predictions: [],
  reviews: [],
  insights: [],
  todos: [],
});
export class FormRecordsService {
  constructor(
    readonly repo: LightTickRepository,
    readonly authorize: () => Promise<void> = async () => {},
    readonly clock = () => new Date(),
  ) {}
  async read(o: LightTickOwner): Promise<FormSnapshot> {
    return this.repo.transaction(o, async () => {
      await this.authorize();
      return (
        (await this.repo.formRecords.get(o)) ?? {
          revision: 0,
          data: emptyFormRecords(),
          updated_at: null,
        }
      );
    });
  }
  async receipt(o: LightTickOwner, key: string): Promise<FormSnapshot> {
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key)) fail(422, "请核对原请求编号。");
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const saved = await this.repo.getOperation(o, key);
      if (!saved || saved.entityType !== "form_records" || saved.entityId !== "forms")
        fail(404, "未找到当前账号的表单回执。");
      return structuredClone(saved.resultPayload) as unknown as FormSnapshot;
    });
  }
  async save(o: LightTickOwner, b: Record<string, unknown>, key: string) {
    keys(b, ["base_revision", "data"]);
    return this.mutate(o, b, key, "save");
  }
  async clear(o: LightTickOwner, b: Record<string, unknown>, key: string) {
    keys(b, ["base_revision"]);
    return this.mutate(o, b, key, "clear");
  }
  async patch(
    o: LightTickOwner,
    section: string,
    b: Record<string, unknown>,
    key: string,
  ) {
    keys(b, ["base_revision", "value"]);
    return this.mutate(o, b, key, "section:" + formSection(section));
  }
  private async mutate(
    o: LightTickOwner,
    b: Record<string, unknown>,
    key: string,
    action: string,
  ) {
    const request = structuredClone(b);
    const base = integer(request.base_revision, 0, 2147483646),
      hash = digest({ action, b: request });
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key)) fail(422, "请保留原请求编号。");
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const receipt = await this.repo.getOperation(o, key);
      if (receipt) {
        if (
          receipt.entityType !== "form_records" ||
          receipt.entityId !== "forms" ||
          receipt.payloadHash !== hash
        )
          fail(409, "原请求编号已用于另一项操作。");
        return receipt.resultPayload as unknown as FormSnapshot;
      }
      const current = await this.repo.formRecords.get(o);
      if ((current?.revision ?? 0) !== base)
        fail(409, "局部表单已变化，请保留输入并核对最新版本。");
      const data =
        action === "save"
          ? formRecords(request.data)
          : action === "clear"
            ? emptyFormRecords()
            : patchFormSection(
                current?.data ?? emptyFormRecords(),
                formSection(action.slice(8)),
                request.value,
              );
      const now = this.clock().toISOString(),
        snapshot = { revision: base + 1, data, updated_at: now };
      await this.repo.formRecords.save(o, snapshot, base);
      await this.repo.saveOperation({
        ...o,
        operationId: key,
        deviceId: "form-records-http",
        entityType: "form_records",
        entityId: "forms",
        action,
        payloadHash: hash,
        requestPayload: request,
        resultPayload: snapshot as unknown as Record<string, unknown>,
        status: "accepted",
        createdAt: now,
        updatedAt: now,
      });
      return snapshot;
    });
  }
}
