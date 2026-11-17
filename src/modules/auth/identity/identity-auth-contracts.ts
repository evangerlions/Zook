import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { badRequest } from "../../../shared/errors.ts";
import {
  IdentityChangeCreateRequestSchema, IdentityCodeRequestSchema, IdentityCurrentProofRequestSchema,
  IdentityCompleteRequestSchema, ThirdPartyAuthorizationRequestSchema, ThirdPartyLoginRequestSchema,
  type IdentityChangeCreateRequest, type IdentityCodeRequest, type IdentityCurrentProofRequest,
  type IdentityCompleteRequest, type ThirdPartyAuthorizationRequest, type ThirdPartyLoginRequest,
} from "../../../generated/openapi/public-contracts.generated.ts";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
function parser<T>(schema: object): (input: unknown) => T {
  const validate: ValidateFunction = ajv.compile(schema);
  return input => {
    if (!validate(input)) badRequest("REQ_INVALID_BODY", "Invalid identity authentication request.");
    return input as T;
  };
}

export const identityContracts = {
  create: parser<IdentityChangeCreateRequest>(IdentityChangeCreateRequestSchema),
  code: parser<IdentityCodeRequest>(IdentityCodeRequestSchema),
  current: parser<IdentityCurrentProofRequest>(IdentityCurrentProofRequestSchema),
  complete: parser<IdentityCompleteRequest>(IdentityCompleteRequestSchema),
  authorization: parser<ThirdPartyAuthorizationRequest>(ThirdPartyAuthorizationRequestSchema),
  login: parser<ThirdPartyLoginRequest>(ThirdPartyLoginRequestSchema),
};
