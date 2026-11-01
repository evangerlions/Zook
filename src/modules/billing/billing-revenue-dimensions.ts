import { ApplicationError } from '../../shared/errors.ts';
import type { BillingRevenueDimension } from '../../shared/types/billing-admin.ts';

export const BILLING_REVENUE_DIMENSIONS = ['appId', 'productKey', 'source', 'market'] as const;
export const DEFAULT_BILLING_REVENUE_DIMENSIONS: BillingRevenueDimension[] = ['appId'];

/** Canonical ordering also makes repeated combinations share one query/cache identity. */
export function parseBillingRevenueDimensions(value?: string): BillingRevenueDimension[] {
  if (value === undefined) return [...DEFAULT_BILLING_REVENUE_DIMENSIONS];
  const values = value.split(',');
  if (!values.length || values.some(item => !BILLING_REVENUE_DIMENSIONS.includes(item as BillingRevenueDimension)) || new Set(values).size !== values.length) {
    throw new ApplicationError(400, 'ADMIN_BILLING_INVALID_QUERY', 'groupBy must contain distinct appId, productKey source or market dimensions.');
  }
  return BILLING_REVENUE_DIMENSIONS.filter(item => values.includes(item));
}
