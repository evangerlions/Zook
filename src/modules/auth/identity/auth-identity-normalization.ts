import { badRequest } from "../../../shared/errors.ts";

export function normalizeAuthEmail(email: string): string {
  const value = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) badRequest("REQ_INVALID_BODY", "email must be a valid email address.");
  return value;
}

export function normalizeAuthPhone(phone: string, phoneNa?: string): string {
  const country = phoneNa?.trim() || "+86";
  const prefix = country.startsWith("+") ? country : `+${country}`;
  const digits = phone.trim().replace(/[^\d]/g, "");
  if (!/^\+\d{1,4}$/.test(prefix)) badRequest("REQ_INVALID_BODY", "phoneNa must be a valid country calling code.");
  if (!/^\d{4,20}$/.test(digits) || (prefix === "+86" && !/^1\d{10}$/.test(digits))) badRequest("REQ_INVALID_BODY", "phone must be a valid phone number.");
  return `${prefix}${digits}`;
}
