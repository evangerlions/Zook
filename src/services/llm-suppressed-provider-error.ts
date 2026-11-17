import { ApplicationError } from '../shared/errors.ts';

/** Preserve actionable classification without retaining provider-controlled text. */
export function suppressProviderError(error: unknown, provider: string): ApplicationError {
  const original = error instanceof ApplicationError ? error : undefined;
  const allowedCodes = new Set([
    'LLM_PROVIDER_REQUEST_FAILED',
    'LLM_PROVIDER_RESPONSE_INVALID',
    'LLM_PROVIDER_CONTENT_SENSITIVE',
  ]);
  const code = original && allowedCodes.has(original.code)
    ? original.code
    : 'LLM_PROVIDER_REQUEST_FAILED';
  const details = original?.details && typeof original.details === 'object' && !Array.isArray(original.details)
    ? original.details as Record<string, unknown>
    : {};
  const statusCode = typeof details.statusCode === 'number' && Number.isInteger(details.statusCode) && details.statusCode >= 100 && details.statusCode <= 599
    ? details.statusCode
    : undefined;
  const reason = details.reason === 'timeout' || details.reason === 'network_error' ? details.reason : undefined;
  const isOpenRouterCredit = details.limitSource === 'openrouter_credits';
  return new ApplicationError(
    original?.statusCode ?? 502,
    code,
    'Upstream model request failed.',
    {
      provider,
      ...(statusCode === undefined ? {} : { statusCode }),
      ...(details.errorCode === 402 || details.errorCode === '402'
        ? { errorCode: 402 }
        : details.errorCode === 'insufficient_user_quota' ? { errorCode: 'insufficient_user_quota' } : {}),
      ...(reason === undefined ? {} : { reason }),
      ...(isOpenRouterCredit ? { limitSource: 'openrouter_credits',
        ...(details.creditReason === 'weight_exceeds_budget' || details.creditReason === 'unknown'
          ? { creditReason: details.creditReason } : {}) } : {}),
    },
  );
}
