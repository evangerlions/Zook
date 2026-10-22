import { createHmac, timingSafeEqual } from "node:crypto";
import { ApplicationError } from "../../../shared/errors.ts";
import type { PersonalSyncState } from "./personal-sync.types.ts";

export interface PersonalCursor { user: string; epoch: string; mode: "restore" | "changes" | "browse"; boundary: number; after: number; expires: number; kind?: string; since?: string; reportAfter?: { time: string; id: string } }
export function encodePersonalCursor(cursor: PersonalCursor, state: PersonalSyncState) {
  const body = Buffer.from(JSON.stringify(cursor)).toString("base64url");
  return `${body}.${createHmac("sha256", state.cursorSecret).update(body).digest("base64url")}`;
}
export function decodePersonalCursor(token: string, user: string, mode: string, state: PersonalSyncState): PersonalCursor {
  try {
    const [body, signature, extra] = token.split(".");
    const expected = createHmac("sha256", state.cursorSecret).update(body).digest();
    const actual = Buffer.from(signature ?? "", "base64url");
    if (extra || expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error();
    const cursor = JSON.parse(Buffer.from(body, "base64url").toString());
    if (cursor.user !== user || cursor.epoch !== state.epoch || cursor.mode !== mode || !Number.isSafeInteger(cursor.after) || cursor.after < 0 || !Number.isSafeInteger(cursor.boundary) || cursor.boundary < 0 || cursor.after > state.sequence || cursor.boundary > state.sequence || !Number.isFinite(cursor.expires) || cursor.expires < Date.now()) throw new Error();
    return cursor;
  } catch { throw new ApplicationError(409, "FROGSLEEP_SYNC_CURSOR_INVALID", "Cursor is invalid or expired; start a new restore."); }
}
