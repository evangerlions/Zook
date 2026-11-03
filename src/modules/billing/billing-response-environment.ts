import type { HttpResponse } from "../../shared/types.ts";
import { inBillingEnvironment, type BillingEnvironment } from "./billing-environment.ts";

/** Stream iteration outlives the dispatch transaction; bind only billing scope. */
export function bindBillingResponseEnvironment<T>(
  response: HttpResponse<T>,
  environment: BillingEnvironment,
): HttpResponse<T> {
  const source = response.streamBody;
  if (!source) return response;
  return {
    ...response,
    streamBody: {
      [Symbol.asyncIterator]() {
        const iterator = inBillingEnvironment(environment, () => source[Symbol.asyncIterator]());
        return {
          next: (...args: [] | [unknown]) =>
            inBillingEnvironment(environment, () => iterator.next(...args)),
          ...(iterator.return ? {
            return: (value?: unknown) =>
              inBillingEnvironment(environment, () => iterator.return!(value)),
          } : {}),
          ...(iterator.throw ? {
            throw: (error?: unknown) =>
              inBillingEnvironment(environment, () => iterator.throw!(error)),
          } : {}),
        };
      },
    },
  };
}
