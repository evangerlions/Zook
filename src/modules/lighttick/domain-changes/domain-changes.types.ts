import type { LightTickOwner } from "../lighttick.types.ts";
import {
  fail,
  integer,
  keys,
  object,
} from "../learning/native-learning.validation.ts";
export const domains = [
  "reading",
  "experience",
  "knowledge",
  "learning",
  "records",
  "actions",
  "investments",
  "settings",
] as const;
export type Domain = (typeof domains)[number];
export interface DomainHint {
  domain: Domain;
  resource: string;
  id: string;
  revision: number;
  operation: "upsert" | "delete";
}
export interface DomainChange extends DomainHint {
  sequence: string;
  notified_at: string;
}
export type DomainNotifier = (
  o: LightTickOwner,
  hint: DomainHint,
) => Promise<void>;
export interface DomainChangesRepository {
  append: DomainNotifier;
  head(o: LightTickOwner, domain: Domain | null): Promise<string>;
  page(
    o: LightTickOwner,
    domain: Domain | null,
    after: string,
    limit: number,
  ): Promise<DomainChange[]>;
}
export function domainHint(raw: unknown): DomainHint {
  const b = object(raw);
  keys(b, ["domain", "resource", "id", "revision", "operation"]);
  if (
    !domains.includes(b.domain as Domain) ||
    typeof b.resource !== "string" ||
    !/^[a-z][a-z0-9_]{0,47}$/.test(b.resource) ||
    typeof b.id !== "string" ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(b.id) ||
    !["upsert", "delete"].includes(String(b.operation))
  )
    fail(422, "领域通知只能包含有效资源标识与修订。");
  const revision = integer(b.revision, 1, 2147483647);
  return {
    domain: b.domain as Domain,
    resource: b.resource as string,
    id: b.id as string,
    revision,
    operation: b.operation as DomainHint["operation"],
  };
}
