import { chromium } from "playwright";
import { BrowserLoginSession } from "../src/modules/billing-accounts/manual/browser-session.ts";
const browser = await chromium.launch({ channel: "chromium", headless: true, chromiumSandbox: true });
try {
 const context = await browser.newContext({ viewport: { width: 1120, height: 760 } });
 await context.route('https://dev.getui.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<html><body><label>账户名称 <input id="username" placeholder="账户名称"></label><label>密码 <input id="password" type="password" placeholder="密码"></label><button onclick="document.getElementById(\'state\').textContent=\'login submitted\'">立即登录</button><button onclick="document.getElementById(\'state\').textContent=\'code sent\'">发送验证码</button><label>验证码 <input id="code"></label><div id="state"></div></body></html>' }));
 await context.route('https://dev.getui.com/gt_dev_center/account/getLoginInfo', route => route.fulfill({json:{errno:0,data:{result:0,data:{token:'fixture-only-token'}}}}));
 await context.route('https://dev.getui.com/getui_dev_center/gop/ccp/remainder/queryAccountBiz', route => route.fulfill({json:{errno:0,data:{remainderNum:route.request().postDataJSON().businessCode==='ct-login'?88:0}}}));
 const page = await context.newPage(); await page.goto('https://dev.getui.com/gy/');
 const session = new BrowserLoginSession('session','account','admin','geyan',browser,context,page,Date.now()+600000);
 await session.exclusive(() => session.input({ kind: "credentials", username: "fixture-user", password: "fixture-pass" }));
 if (await page.locator('#username').inputValue() !== 'fixture-user' || await page.locator('#password').inputValue() !== 'fixture-pass' || await page.locator('#state').innerText() !== 'login submitted') throw Error('Credential login form did not submit correctly');
 const box = await page.locator('#code').boundingBox();
 await session.exclusive(async () => { await session.input({kind:'pointer',points:[{x:box!.x+5,y:box!.y+5}]}); await session.input({kind:'text',text:'test-verification'}); });
 if (await page.locator('#code').inputValue() !== 'test-verification') throw Error('Input did not reach selected field');
 const result = await session.exclusive(() => session.read());
 if (result.status !== 'ok' || result.metrics[0].remaining !== 88) throw Error('Automatic balance read failed');
 const view = await session.exclusive(() => session.view());
 if (!view.image.startsWith('data:image/jpeg;base64,')) throw Error('Missing login view');
 console.log('Real Chromium fixture: pointer input, verification field, screenshot and automatic balance read passed.');
} finally { await browser.close(); }
// Against the isolated local Admin test server: prove a late A response cannot close B.
const uiBrowser = await chromium.launch({ channel: "chromium", headless: true, chromiumSandbox: true });
let releaseRead!: () => void;
let releaseStart!: () => void;
const startGate = new Promise<void>(resolve => { releaseStart = resolve; });
const readGate = new Promise<void>(resolve => { releaseRead = resolve; });
try {
 const page = await uiBrowser.newPage(); let holdMetadata = false; let releaseMetadata!: () => void; const metadataGate = new Promise<void>(resolve => { releaseMetadata = resolve; }); const closes: string[] = []; let firstAStart = true;
 const envelope = (data: unknown) => ({ code: "OK", message: "OK", data, requestId: "manual-browser-fixture" });
 const view = (id: string) => ({ sessionId: id, width:1120, height:760, expiresAt:"2030-01-01", image:"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7ZkAAAAASUVORK5CYII=" });
 await page.route("**/api/v1/admin/billing-accounts**", async route => {
  const path = new URL(route.request().url()).pathname;
  if (path.includes("/A/") && path.endsWith("/start") && firstAStart) {
    firstAStart = false;
    await startGate;
    await route.fulfill({ status:409, contentType:"application/json", body:JSON.stringify({code:"REQ_INVALID_BODY",message:"登录窗口占用，请重新连接",data:null,requestId:"recovery-fixture"}) }); return;
  }
  if (path.endsWith("billing-accounts") && holdMetadata) await metadataGate;
  let data: unknown;
  if (path.endsWith("billing-accounts")) data = { accounts:["A","B"].map(id => ({ id, name:`Fixture ${id}`, type:"geyan", providers:[], mode:"manual", alerts:false, credentialConfigured:false, warning:1, critical:0, alert:{ level:"healthy" } })), config:{ intervalMinutes:5,warningRepeatHours:24,criticalRepeatHours:4,failureCount:3,recoverySamples:2,rules:[] } };
  else if (path.endsWith("/start")) data = view(path.includes("/A/") ? "session-A" : "session-B");
  else if (path.endsWith("/read")) { await readGate; data={ sample:{status:"ok"} }; }
  else if (path.endsWith("/close")) { closes.push(path); data={closed:true}; }
  else data=view("session-B");
  await route.fulfill({contentType:"application/json",body:JSON.stringify(envelope(data))});
 });
 await page.goto("http://127.0.0.1:3197/login");
 await page.getByRole("textbox",{name:"admin",exact:true}).fill("feishu-local");
 await page.getByRole("textbox",{name:"输入密码",exact:true}).fill("local-acceptance-only");
 await page.getByRole("button",{name:"进入后台"}).click();
 await page.waitForURL("**/apps"); await page.goto("http://127.0.0.1:3197/balance-accounts");
 await page.getByRole("row").filter({hasText:"Fixture A"}).getByRole("button",{name:"刷新余额",exact:true}).click();
 await page.getByRole("status").filter({hasText:"正在打开官方窗口并恢复登录状态"}).waitFor();
 releaseStart();
 await page.getByRole("button",{name:"重新连接",exact:true}).waitFor();
 await page.getByLabel("账户名称",{exact:true}).fill("fixture-draft-user");
 await page.getByLabel("密码",{exact:true}).fill("fixture-draft-password");
 await page.getByRole("button",{name:"重新连接",exact:true}).click();
 await page.getByAltText("官方账号登录窗口").waitFor();
 if (await page.getByLabel("账户名称",{exact:true}).inputValue() !== "fixture-draft-user" || await page.getByLabel("密码",{exact:true}).inputValue() !== "fixture-draft-password") throw Error("Reconnecting erased the credential draft");
 await page.getByRole("button",{name:"登录完成，读取余额",exact:true}).click();
 await page.getByRole("button",{name:/^关\s*闭$/}).click();
 await page.getByRole("row").filter({hasText:"Fixture B"}).getByRole("button",{name:"刷新余额",exact:true}).click();
 await page.getByText("Fixture B · 个验 · 登录并刷新余额",{exact:true}).waitFor();
 const readResponse = page.waitForResponse(response => response.url().includes("/A/login/session-A/read"));
 releaseRead();
 // A's response must be processed before checking B's surviving window.
 await readResponse;
 await page.getByText("Fixture B · 个验 · 登录并刷新余额",{exact:true}).waitFor();
 if (closes.some(path => path.includes("/B/"))) throw Error("Late A response closed B");
 await page.getByRole("button",{name:/^关\s*闭$/}).click();
 holdMetadata = true;
 await page.goto("http://127.0.0.1:3197/balance-accounts/A/login");
 await page.getByRole("button",{name:/^返\s*回$/}).waitFor();
 await page.getByRole("button",{name:/^返\s*回$/}).click();
 holdMetadata = false; releaseMetadata();
 await page.waitForURL("**/balance-accounts");
 await page.getByRole("row").filter({hasText:"Fixture A"}).waitFor();
 console.log("Local Admin browser: visible progress, metadata-load return, reconnect drafts and stale-response isolation passed.");
} finally { releaseStart(); releaseRead(); await uiBrowser.close(); }
