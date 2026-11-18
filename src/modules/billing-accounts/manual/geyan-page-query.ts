import type { Page } from "playwright";
import { ApplicationError } from "../../../shared/errors.ts";
import type { BalanceSample } from "../../llm-balances/balance-models.ts";

interface QueryResponse { businessCode: "ct-login" | "ct-login-h5"; status: number; errno: unknown; remainderNum: unknown; }
export interface GeyanPageResult { authenticated: boolean; responses: QueryResponse[]; }

/** Serialized into the existing official page. Secrets never leave its JS context. */
export async function queryGeyanInPage(): Promise<GeyanPageResult> {
  const deadline = AbortSignal.timeout(15000);
  const loginResponse = await fetch("/gt_dev_center/account/getLoginInfo", {
    method: "POST", credentials: "same-origin", redirect: "error", signal: deadline,
    headers: { "Content-Type": "application/json" }, body: "{}",
  });
  if (!loginResponse.ok) return { authenticated: loginResponse.status !== 401 && loginResponse.status !== 403, responses: [] };
  const login = await loginResponse.json();
  if (login.errno !== 0 || login.data?.result !== 0 || typeof login.data?.data?.token !== "string") return { authenticated: false, responses: [] };
  let token = login.data.data.token;
  const responses: QueryResponse[] = [];
  for (const businessCode of ["ct-login", "ct-login-h5"] as const) {
    const response = await fetch("/getui_dev_center/gop/ccp/remainder/queryAccountBiz", {
      method: "POST", credentials: "same-origin", redirect: "error", signal: deadline,
      headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest", token }, body: JSON.stringify({ businessCode }),
    });
    if (response.status === 401 || response.status === 403) return { authenticated: false, responses: [] };
    token = response.headers.get("token") ?? token;
    const body = await response.json();
    if (body.errno === 102) return { authenticated: false, responses: [] };
    responses.push({ businessCode, status: response.status, errno: body.errno, remainderNum: body.data?.remainderNum });
  }
  return { authenticated: true, responses };
}

export function parseGeyanPageResult(result: GeyanPageResult): BalanceSample {
  if (!result.authenticated) throw new ApplicationError(409, "REQ_INVALID_BODY", "登录尚未完成或已过期，请在官方页面完成验证后重试。");
  const codes = ["ct-login", "ct-login-h5"] as const;
  const valid = result.responses.length === codes.length && codes.every(code => {
    const matching = result.responses.filter(r => r.businessCode === code);
    return matching.length === 1 && matching[0].status === 200 && matching[0].errno === 0 &&
      typeof matching[0].remainderNum === "number" && Number.isSafeInteger(matching[0].remainderNum) && matching[0].remainderNum >= 0;
  });
  if (!valid) return { status: "error", metrics: [], detail: "个验余量接口返回异常，未保存新余额。" };
  return { status: "ok", metrics: codes.map(code => ({ kind: code === "ct-login" ? "geyan_app_remaining" : "geyan_h5_remaining",
    scope: "account", remaining: result.responses.find(r => r.businessCode === code)!.remainderNum as number, unit: "次" })) };
}

export async function readGeyanBalance(page: Page): Promise<BalanceSample> {
  if (new URL(page.url()).origin !== "https://dev.getui.com") throw new ApplicationError(409, "REQ_INVALID_BODY", "请先打开个验官方登录页面。");
  return parseGeyanPageResult(await page.evaluate(queryGeyanInPage));
}
