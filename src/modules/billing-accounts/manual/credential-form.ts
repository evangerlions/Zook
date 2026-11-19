import type { Page, Locator } from "playwright";
import { ApplicationError } from "../../../shared/errors.ts";
import { allowedProviderUrl, type ManualProvider } from "./provider-pages.ts";
async function visible(locator: Locator) {
  const matches: Locator[] = [];
  for (const candidate of await locator.all()) if (await candidate.isVisible()) matches.push(candidate);
  return matches;
}
async function passwordForms(page: Page, provider: ManualProvider) {
  const forms: { username: Locator; password: Locator; submit: Locator }[] = [];
  for (const frame of page.frames()) {
    if (!allowedProviderUrl(provider, frame.url())) continue;
    const passwords = await visible(frame.locator('input[type="password"]'));
    const usernames = await visible(frame.getByPlaceholder(/账户名称|账号|账户|用户名|邮箱|手机号|email|account|username/i));
    const submits = await visible(frame.getByRole("button", { name: /^(立即登录|登\s*录|sign in|log in)$/i }));
    if (passwords.length === 1 && usernames.length === 1 && submits.length === 1) forms.push({ username: usernames[0], password: passwords[0], submit: submits[0] });
  }
  return forms;
}
/** Locate a unique official password form before typing; selecting password mode is allowed, verification is left to the user. */
export async function submitCredentials(page: Page, provider: ManualProvider, username: string, password: string) {
  let forms = await passwordForms(page, provider);
  if (!forms.length) {
    const modes: Locator[] = [];
    for (const frame of page.frames()) {
      if (allowedProviderUrl(provider, frame.url())) modes.push(...await visible(frame.getByText(/^(账号密码登录|账户密码登录|密码登录|使用密码登录)$/)));
    }
    if (modes.length === 1) { await modes[0].click(); forms = await passwordForms(page, provider); }
  }
  if (forms.length !== 1) throw new ApplicationError(409, "REQ_INVALID_BODY", "请先在官方页面切换到账号密码登录，再点击保存并登录。");
  const form = forms[0];
  await form.username.fill(username); await form.password.fill(password); await form.submit.click();
}
