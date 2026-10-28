import { createHash } from "node:crypto";
import { ApplicationError, badRequest } from "../../../shared/errors.ts";
import type { ErrorCode } from "../../../shared/types.ts";
import { supportTemplates, type SupportSubmission, type SupportContext } from "./buddy-support.types.ts";

export const appID = "frogsleep";
export const supportEnabled = () => process.env.FROGSLEEP_BUDDY_SUPPORT_ENABLED === "true";
export const timestamp = () => new Date().toISOString();
export const failure = (code: ErrorCode, status = 409, data?: unknown): never => {
  throw new ApplicationError(status, code, code, data);
};
export const unavailable = (): never => failure("BUDDY_SUPPORT_UNAVAILABLE", 404);
export function fields(input: Record<string, unknown>, allowed: string[]) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(x => !allowed.includes(x))) badRequest("REQ_INVALID_BODY", "Invalid support fields.");
}
export function identifier(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 128) badRequest("REQ_INVALID_BODY", "Invalid support identifier.");
  return value.trim();
}
export function submission(input: Record<string, unknown>): SupportSubmission {
  fields(input, ["relationship_id", "operation_id", "template_key", "flower", "context"]);
  const template = input.template_key ?? null;
  if (template !== null && (typeof template !== "string" || !Object.hasOwn(supportTemplates, template))) badRequest("REQ_INVALID_BODY", "Invalid support template.");
  if (input.flower !== undefined && typeof input.flower !== "boolean") badRequest("REQ_INVALID_BODY", "Invalid flower.");
  if (template === null && input.flower !== true) badRequest("REQ_INVALID_BODY", "Select a template or flower.");
  return { relationship_id: identifier(input.relationship_id), operation_id: identifier(input.operation_id),
    template_key: template as SupportSubmission["template_key"], flower: input.flower === true, context: context(input.context) };
}
function context(value: unknown): SupportContext | null {
  if (value === undefined || value === null) return null;
  fields(value as Record<string, unknown>, ["type", "id"]);
  const source = value as Record<string, unknown>;
  if (!["buddy_share", "buddy_joint_activity"].includes(String(source.type))) badRequest("REQ_INVALID_BODY", "Invalid support context.");
  return { type: source.type as SupportContext["type"], id: identifier(source.id) };
}
export const digest = (kind: string, input: unknown) => createHash("sha256").update(JSON.stringify([kind, input])).digest("hex");
export function bounded(value: unknown, fallback: number, maximum: number) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > maximum) badRequest("REQ_INVALID_QUERY", "Invalid page limit.");
  return number;
}
