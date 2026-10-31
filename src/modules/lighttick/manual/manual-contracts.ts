import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats, { type FormatsPlugin } from "ajv-formats";
import {
  LightTickManualDraftSchema,
  LightTickManualEditSchema,
  LightTickManualConfirmSchema,
  LightTickLocalAdoptionSchema,
} from "../../../generated/openapi/public-contracts.generated.ts";
import { ApplicationError } from "../../../shared/errors.ts";
const ajv = new Ajv2020({ strict: false, allErrors: true });
(addFormats as unknown as FormatsPlugin)(ajv);
const validators = {
  create: ajv.compile(LightTickManualDraftSchema),
  edit: ajv.compile(LightTickManualEditSchema),
  confirm: ajv.compile(LightTickManualConfirmSchema),
  adopt: ajv.compile(LightTickLocalAdoptionSchema),
};
export function validateManualRequest(
  kind: keyof typeof validators,
  value: unknown,
) {
  if (!validators[kind](value))
    throw new ApplicationError(
      422,
      "LIGHTTICK_PLAN_CONSTRAINT_FAILED",
      "Check the reviewed fields, dates and effort.",
    );
}
