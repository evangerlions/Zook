import type { HttpRequest, HttpResponse } from "../shared/types.ts";

const ASSOCIATION_PATH = "/.well-known/apple-app-site-association";
const BODYLOG_APPLICATION_IDENTIFIER = "LTN9Y4UXN3.com.youwoai.habittap";
const LINK_PATHS = ["/i/*", "/invite/*", "/b/*", "/g/*", "/invite-code"];
const IDENTIFIER = /^[A-Za-z0-9_-]{1,512}$/;

export function tryHandleBodyLogAssociationRoutes(request: HttpRequest): HttpResponse<unknown> | undefined {
  if (request.method !== "GET") return undefined;
  if (request.path === ASSOCIATION_PATH) return {
    statusCode: 200,
    contentType: "application/json",
    headers: { "Cache-Control": "public, max-age=3600" },
    body: { applinks: { apps: [], details: [{ appID: BODYLOG_APPLICATION_IDENTIFIER, paths: LINK_PATHS }] } } as never,
  };
  let deepLink: string;
  if (request.path === "/invite-code") {
    const code = request.query?.code;
    if (typeof code !== "string" || !/^[A-Z2-9]{6}$/i.test(code)) return invalidLink(request);
    deepLink = `bodylog://invite-code/${code.toUpperCase()}`;
  } else {
    const match = request.path.match(/^\/(i|invite|b|g)\/([^/]+)$/);
    if (!match) return undefined;
    const [,kind,id] = match;
    if (!IDENTIFIER.test(id!)) return invalidLink(request);
    const token = request.query?.token;
    if (kind === "g" && (typeof token !== "string" || !IDENTIFIER.test(token))) return invalidLink(request);
    deepLink = kind === "g" ? `bodylog://group/${id}?token=${token}`
      : kind === "b" ? `bodylog://buddy/${id}` : `bodylog://invite/${id}`;
  }
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1"><title>HabitTap 邀请</title>`
    + `<style>body{background:#000;color:#eee;font:17px system-ui;margin:0}main{max-width:32rem;margin:10vh auto;padding:24px}h1{font-size:28px}p{line-height:1.7;color:#bbb}a,button{display:inline-block;background:#30d158;color:#000;border:0;border-radius:12px;padding:14px 20px;font:inherit;text-decoration:none}label{display:block;margin:28px 0 8px}input{background:#181818;color:white;border:1px solid #555;border-radius:12px;padding:12px;font:inherit;width:8em;margin:0 8px 12px 0}</style></head>`
    + `<body><main><h1>一起坚持身体好习惯</h1><p>打开 HabitTap 查看邀请。登录后仍需确认，打开此页不会自动加入或领取奖励。</p>`
    + `<a href="${deepLink}">在 HabitTap 中查看</a><p>还没安装？请先在 App Store 安装 HabitTap，再返回本页点击打开。安装本身不会自动保存或完成邀请归因。</p>`
    + `<p>也可以保留并重新打开原邀请链接；如果朋友另发了六位邀请码，可以在下方输入，再到 App 中核验。</p>`
    + `<form action="/invite-code" method="get"><label for="code">六位邀请码</label><input id="code" name="code" required maxlength="6" minlength="6" pattern="[A-Za-z2-9]{6}" autocapitalize="characters" autocomplete="off"><button type="submit">核验邀请码</button></form>`
    + `</main></body></html>`;
  return {
    statusCode: 200, contentType: "text/html; charset=utf-8",
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" },
    body: { code: "OK", message: "success", data: null, requestId: request.requestId } as never,
    streamBody: (async function* () { yield html; })(),
  };
}

function invalidLink(request: HttpRequest): HttpResponse<unknown> {
  return { statusCode:400,contentType:"application/json",headers:{"Cache-Control":"no-store"},
    body:{code:"BODYLOG_INVITATION_INVALID",message:"Invitation link is invalid.",data:null,requestId:request.requestId} as never };
}
