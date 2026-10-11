import type {
  UsageFilter,
  UsageReport,
  UsageSource,
  UsageUser,
  CreditUsageEvent,
  UsagePayment,
} from "../../shared/types/ai-novel-usage-admin.ts";
import {
  analyzeTier,
  points,
  replayConsumption,
} from "./ai-novel-usage-windows.ts";
import {
  LOCAL_CREDIT_QUOTAS,
  type CreditsTier,
} from "../ai-novel/credits/ai-novel-credits-model.ts";

const TIERS: CreditsTier[] = ["free", "plus", "pro"];
const add = (a: number, b: number) => {
  const result = a + b;
  if (!Number.isFinite(result) || Math.abs(result) > Number.MAX_SAFE_INTEGER)
    throw new Error("Usage report aggregate exceeds safe range");
  return result;
};

export function buildUsageReport(
  source: UsageSource,
  filter: UsageFilter,
): UsageReport {
  const matches = (tier: CreditsTier) =>
    filter.tier === "all" || tier === filter.tier;
  const events = source.events.filter((e) => matches(e.tier));
  const payments = source.payments.filter(
    (p) => matches(p.tier) && p.sandbox === filter.sandbox,
  );
  const endedWindows = source.windows.filter((w) => w.end <= filter.asOf);
  const users = new Map<string, UsageUser>(),
    daily = new Map<string, UsageReport["daily"][number]>();
  const money = new Map<string, UsageReport["money"][number]>(),
    models = new Map<string, UsageReport["models"][number]>();
  const accounts = new Map(source.accounts.map((a) => [a.userId, a]));
  const user = usageUserResolver(users, accounts);
  const paying = new Set<string>(),
    active = new Set<string>();
  aggregateEvents(events, { user, daily, models, active });
  aggregatePayments(payments, { user, money, paying });
  if (filter.userId && accounts.has(filter.userId)) user(filter.userId);
  const allUsers = [...users.values()].sort(
    (a, b) =>
      b.chargedPoints - a.chargedPoints || a.userId.localeCompare(b.userId),
  );
  const total = (
    key: "chargedPoints" | "giftPoints" | "absorbedPoints" | "denied",
  ) => allUsers.reduce((sum, u) => add(sum, u[key]), 0);
  return {
    filter,
    reportingSince: source.reportingSince,
    summary: {
      payingUsers: paying.size,
      activeUsers: active.size,
      chargedPoints: total("chargedPoints"),
      giftPoints: total("giftPoints"),
      absorbedPoints: total("absorbedPoints"),
      denied: total("denied"),
    },
    money: [...money.values()].sort((a, b) => a.date.localeCompare(b.date)),
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
    tiers: TIERS.filter(matches).map((t) => analyzeTier(t, endedWindows)),
    models: [...models.values()].sort((a, b) => b.points - a.points),
    users: allUsers.slice(0, 200),
    simulation: TIERS.map((t) => ({
      tier: t,
      limitPoints: LOCAL_CREDIT_QUOTAS[t],
      consumption: replayConsumption(endedWindows, source.events, t),
    })),
    ...(filter.userId
      ? {
          detailEvents: events.slice(-100).reverse(),
          detailPayments: payments.slice(-100).reverse(),
        }
      : {}),
  };
}

function usageUserResolver(
  users: Map<string, UsageUser>,
  accounts: Map<string, UsageSource["accounts"][number]>,
) {
  return (userId: string): UsageUser => {
    if (users.has(userId)) return users.get(userId)!;
    const stored = accounts.get(userId);
    const value: UsageUser = {
      userId,
      tier: stored?.account.tier ?? null,
      chargedPoints: 0,
      periodicPoints: 0,
      giftPoints: 0,
      absorbedPoints: 0,
      denied: 0,
      payments: [],
      balance: stored
        ? {
            periodicPoints: points(stored.account.periodicMicros),
            giftPoints: points(stored.account.giftMicros),
            refreshAt: stored.account.refreshAt,
            observedAt: stored.observedAt,
          }
        : null,
    };
    users.set(userId, value);
    return value;
  };
}

function aggregateEvents(
  events: CreditUsageEvent[],
  context: {
    user: (id: string) => UsageUser;
    daily: Map<string, UsageReport["daily"][number]>;
    models: Map<string, UsageReport["models"][number]>;
    active: Set<string>;
  },
) {
  const { user, daily, models, active } = context;
  for (const e of events) {
    const u = user(e.userId!),
      date = e.at.slice(0, 10);
    const day = daily.get(date) ?? {
      date,
      periodicPoints: 0,
      giftPoints: 0,
      absorbedPoints: 0,
      denied: 0,
    };
    switch (e.kind) {
      case "denied":
        u.denied++;
        day.denied++;
        break;
      case "debit": {
        const periodic = points(e.periodicMicros),
          gift = points(e.giftMicros),
          absorbed = points(e.absorbedMicros);
        u.periodicPoints = add(u.periodicPoints, periodic);
        u.giftPoints = add(u.giftPoints, gift);
        u.chargedPoints = add(u.chargedPoints, periodic + gift);
        u.absorbedPoints = add(u.absorbedPoints, absorbed);
        day.periodicPoints = add(day.periodicPoints, periodic);
        day.giftPoints = add(day.giftPoints, gift);
        day.absorbedPoints = add(day.absorbedPoints, absorbed);
        const key = e.modelKey ?? "unknown",
          model = models.get(key) ?? { modelKey: key, points: 0, calls: 0 };
        model.points = add(model.points, periodic + gift + absorbed);
        model.calls++;
        models.set(key, model);
        active.add(u.userId);
        break;
      }
      case "grant":
        break;
      default: {
        const unsupported: never = e.kind;
        throw new Error(`Unsupported credit reporting event: ${unsupported}`);
      }
    }
    daily.set(date, day);
  }
}

function aggregatePayments(
  payments: UsagePayment[],
  context: {
    user: (id: string) => UsageUser;
    money: Map<string, UsageReport["money"][number]>;
    paying: Set<string>;
  },
) {
  const { user, money, paying } = context;
  for (const p of payments) {
    const u = user(p.userId),
      date = p.at.slice(0, 10),
      key = JSON.stringify([date, p.currency]);
    const row = money.get(key) ?? {
      date,
      currency: p.currency,
      grossMinor: 0,
      refundMinor: 0,
    };
    const balance = u.payments.find((v) => v.currency === p.currency) ?? {
      currency: p.currency,
      grossMinor: 0,
      refundMinor: 0,
    };
    if (!u.payments.includes(balance)) u.payments.push(balance);
    const field = p.kind === "purchase" ? "grossMinor" : "refundMinor";
    row[field] = add(row[field], p.amountMinor);
    balance[field] = add(balance[field], p.amountMinor);
    money.set(key, row);
    if (p.kind === "purchase") paying.add(p.userId);
  }
}
