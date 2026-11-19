import { Ajv } from "ajv";
import { FeishuMessageRequestSchema, FeishuExpenseRequestSchema } from "../../generated/openapi/public-contracts.generated.ts";
import { ApplicationError } from "../../shared/errors.ts";

const ajv = new Ajv({ allErrors: true, strict: false, multipleOfPrecision: 4 });
const message = ajv.compile(FeishuMessageRequestSchema);
const expense = ajv.compile(FeishuExpenseRequestSchema);
export function validateIntegrationInput(operation: "message" | "expense", input: unknown): void {
  const validator = operation === "message" ? message : expense;
  if (!validator(input)) throw new ApplicationError(400, "REQ_INVALID_BODY", "Invalid integration input.",
    { errors: validator.errors?.map(error => `${error.instancePath} ${error.message}`) });
}
