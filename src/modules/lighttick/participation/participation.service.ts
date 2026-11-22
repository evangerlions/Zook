import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { ApplicationError } from "../../../shared/errors.ts";
import { sha256 } from "../../../shared/utils.ts";
import { assertIanaTimezone } from "../lighttick-profile.service.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import type { Trial, Invitation } from "./participation.types.ts";
function fail(status: number, message: string): never {
  throw new ApplicationError(
    status,
    status === 409
      ? "LIGHTTICK_VERSION_CONFLICT"
      : status === 404
        ? "LIGHTTICK_RESOURCE_NOT_FOUND"
        : "LIGHTTICK_PARTICIPATION_REJECTED",
    message,
  );
}
const exact = (v: any, keys: string[]) => {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !keys.includes(k))
  )
    fail(422, "请求格式无效。");
};
const localDay = (date: Date, zone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
export function trialWindow(t: Trial, now: Date) {
  const start = localDay(new Date(t.enrolled_at), t.timezone),
    today = localDay(now, t.timezone),
    day = Math.floor((Date.parse(today) - Date.parse(start)) / 86400000) + 1;
  return {
    start,
    end: new Date(Date.parse(start) + 13 * 86400000).toISOString().slice(0, 10),
    day,
    mature: day > 14,
  };
}
export function validateSurvey(b: any) {
  exact(b, ["day", "version", "clarity_score", "progress_score"]);
  if (
    ![7, 14].includes(b.day) ||
    !Number.isInteger(b.version) ||
    b.version < 1 ||
    ![b.clarity_score, b.progress_score].every(
      (x) => Number.isInteger(x) && x >= 1 && x <= 5,
    )
  )
    fail(422, "请选择问卷日期、当前版本和两项1至5分的回答。");
  return b as {
    day: 7 | 14;
    version: number;
    clarity_score: number;
    progress_score: number;
  };
}
export type ParticipantIdentity = {
  active: boolean;
  joinedAt: string;
  test: boolean;
};
export class ParticipationService {
  constructor(
    private readonly repo: LightTickRepository,
    private readonly secrets: string[],
    private readonly identity: (id: string) => Promise<ParticipantIdentity>,
    private readonly clock = () => new Date(),
  ) {}
  private get store() {
    if (!this.repo.participation || !this.secrets[0])
      return fail(503, "邀请与试用暂不可用。");
    return this.repo.participation;
  }
  private signature(id: string, key = this.secrets[0]) {
    return createHmac("sha256", key)
      .update("lighttick-registration-invite-v1:" + id)
      .digest("hex");
  }
  private token(id: string) {
    return id + "." + this.signature(id);
  }
  private parse(token: unknown) {
    if (
      typeof token !== "string" ||
      !/^[a-f0-9-]{36}\.[a-f0-9]{64}$/.test(token)
    )
      return fail(404, "邀请已失效、已使用或已撤销。");
    const [id, sig] = token.split(".");
    if (
      !this.secrets.some((k) =>
        timingSafeEqual(
          Buffer.from(sig, "hex"),
          Buffer.from(this.signature(id, k), "hex"),
        ),
      )
    )
      return fail(404, "邀请已失效、已使用或已撤销。");
    return id;
  }
  private view(i: Invitation) {
    return {
      id: i.id,
      created_at: i.createdAt,
      expires_at: i.expiresAt,
      status: i.usedAt
        ? "used"
        : i.revoked
          ? "revoked"
          : Date.parse(i.expiresAt) <= +this.clock()
            ? "expired"
            : "active",
    };
  }
  private async active(o: LightTickOwner) {
    const i = await this.identity(o.userId);
    if (
      o.appId !== "lighttick" ||
      !i.active ||
      (await this.repo.getGuestIdentity(o))
    )
      return fail(403, "请使用有效的LightTick注册账户。");
    return i;
  }
  async read(o: LightTickOwner) {
    await this.active(o);
    const t = await this.store.trial(o);
    return {
      invitations: (await this.store.list(o)).map((i) => this.view(i)),
      invitation_claimed: !!(await this.store.claimed(o)),
      trial: t ? { ...t, window: trialWindow(t, this.clock()) } : null,
    };
  }
  async command(
    o: LightTickOwner,
    key: string,
    action: string,
    b: any,
    authorize = async () => {},
  ) {
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(key)) fail(422, "请提供原请求标识。");
    const fields: Record<string, string[]> = {
      create: [],
      revoke: ["id"],
      accept: ["token"],
      enroll: ["timezone", "consent"],
      survey: ["day", "version", "clarity_score", "progress_score"],
    };
    if (!fields[action]) fail(422, "未知操作。");
    exact(b, fields[action]);
    const hash = sha256(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(b).sort(([a], [c]) => a.localeCompare(c)),
        ),
      ),
    );
    return this.repo.transaction(o, async () => {
      await this.repo.lockPlanningOwner(o);
      await authorize();
      const identity = await this.active(o),
        op = "participation:" + key,
        old = await this.repo.getOperation(o, op);
      if (old) {
        if (old.action !== action || old.payloadHash !== hash)
          fail(409, "原请求内容不同，请先恢复原请求。");
        return old.resultPayload;
      }
      const now = this.clock(),
        stamp = now.toISOString();
      let result: any;
      if (action === "create") {
        if ((await this.store.activeCount(o, stamp)) >= 20)
          fail(429, "最多保留20个有效邀请，请先撤销已有邀请。");
        const id = randomUUID(),
          token = this.token(id),
          i = {
            id,
            userId: o.userId,
            createdAt: stamp,
            expiresAt: new Date(+now + 7 * 86400000).toISOString(),
            usedAt: null,
            revoked: false,
            tokenHash: sha256(token),
          };
        await this.store.save(o, i);
        result = {
          invitation: this.view(i),
          path: "/grow/participation#invite=" + token,
        };
      }
      if (action === "revoke") {
        if (typeof b.id !== "string") fail(422, "邀请编号无效。");
        const i = await this.store.get(b.id, true);
        if (!i || i.userId !== o.userId) fail(404, "邀请不存在。");
        if (i.usedAt) fail(409, "邀请已使用，不能撤销已注册账户。");
        i.revoked = true;
        await this.store.save(o, i);
        result = { invitation: this.view(i) };
      }
      if (action === "accept") {
        const id = this.parse(b.token),
          previous = await this.store.claimed(o);
        if (previous) {
          if (previous !== id) fail(409, "此账户已确认另一邀请。");
          result = { accepted: true };
        } else {
          const i = await this.store.get(id, true);
          if (
            !i ||
            i.userId === o.userId ||
            this.view(i).status !== "active" ||
            i.tokenHash !== sha256(b.token) ||
            (await this.identity(i.userId)).active !== true
          )
            fail(404, "邀请已失效、已使用或已撤销。");
          const joined = Date.parse(identity.joinedAt);
          if (
            !Number.isFinite(joined) ||
            joined < Date.parse(i.createdAt) ||
            joined > +now ||
            +now - joined > 7 * 86400000
          )
            fail(
              403,
              "邀请仅供刚加入LightTick的新账户确认；已有账户可直接使用工作台。",
            );
          i.usedAt = stamp;
          await this.store.save({ appId: o.appId, userId: i.userId }, i);
          await this.store.claim(o, id);
          result = { accepted: true };
        }
      }
      if (action === "enroll") {
        if (b.consent !== true || typeof b.timezone !== "string")
          fail(422, "请自愿确认参与并选择时区。");
        assertIanaTimezone(b.timezone);
        if (identity.test) fail(403, "测试账户不加入真实使用观察。");
        const t = (await this.store.trial(o)) ?? {
          id: randomUUID(),
          version: 1,
          enrolled_at: stamp,
          timezone: b.timezone,
          surveys: {},
        };
        await this.store.saveTrial(o, t);
        result = { trial: t };
      }
      if (action === "survey") {
        const answer = validateSurvey(b),
          t = await this.store.trial(o);
        if (!t) fail(409, "请先自愿加入两周试用。");
        if (identity.test) fail(403, "测试账户不加入真实使用观察。");
        if (t.version !== answer.version)
          fail(409, "问卷已有变化，请核对后再提交。");
        if (trialWindow(t, now).day < answer.day)
          fail(409, "尚未到本次问卷的本地日期。");
        const history = t.surveys[String(answer.day)] ?? [];
        if (history.length >= 100) fail(409, "此问卷已达到修改上限。");
        history.push({
          clarity_score: answer.clarity_score,
          progress_score: answer.progress_score,
          saved_at: stamp,
        });
        t.surveys[String(answer.day)] = history;
        t.version++;
        await this.store.saveTrial(o, t);
        result = { trial: t };
      }
      await this.repo.saveOperation({
        ...o,
        operationId: op,
        deviceId: "http",
        payloadHash: hash,
        entityType: "participation",
        entityId: o.userId,
        action,
        requestPayload: { action },
        resultPayload: structuredClone(result),
        status: "accepted",
        createdAt: stamp,
        updatedAt: stamp,
      });
      return result;
    });
  }
}
