import { Ajv } from "ajv";
import * as contracts from "../../../generated/openapi/public-contracts.generated.ts";
import { reject, uuid } from "./protocol.ts";
const ajv = new Ajv({ allErrors: false, strict: false });
ajv.addFormat("uuid", { type:"string", validate:uuid });
const names: Record<string, string> = { challenges: "Challenge", recovery: "Recovery", bootstrap: "Bootstrap", sessions: "Session",
  enroll: "Enroll", recover: "Recover", inspect: "Inspect", "revoke-device": "RevokeDevice", "rotate-keys": "RotateKeys",
  logout: "Logout", "key-capsules": "KeyCapsules", "verify-operation": "VerifyOperation" };
const schemas = contracts as unknown as Record<string, object>;
const validators = new Map(Object.entries(names).map(([action, name]) => [action, ajv.compile(schemas[`YaoheziHealth${name}RequestSchema`])]));
export function validateHealthRequest(action: string, body: unknown): void {
  const validate = validators.get(action);
  if (!validate) reject("YAOHEZI_ROUTE_NOT_FOUND", 404);
  if (!validate(body)) reject("YAOHEZI_INVALID_COMMAND", 400);
}

const revisionValidator=ajv.compile(contracts.YaoheziHealthRevisionSchema);
export function validRevision(body:unknown):boolean {return !!revisionValidator(body);}

const trustDataValidator=ajv.compile(contracts.YaoheziHealthInspectDataSchema);
export function validTrustData(body:unknown):boolean {return !!trustDataValidator(body);}
