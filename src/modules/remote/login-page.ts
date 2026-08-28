// src/modules/remote/login-page.ts
// 远程访问登录页（未认证的 HTML 导航请求由请求门卫直接返回本页）。
// 中英双语、支持错误提示与锁定倒计时；cache-control: no-store（防 PWA/浏览器缓存）。

export interface LoginPageOptions {
  /** false=首次打开 | true=密码错误 | 'locked'=锁定中（带剩余秒数） */
  error: false | true | 'locked';
  /** 作用域提示：局域网 / 公网 */
  isPublic: boolean;
  /** 锁定剩余秒数（error === 'locked' 时展示） */
  retryAfter?: number;
}

/** 登录页 HTML（POST /remote/login 表单提交，成功后 302 回 /）。 */
export function loginPageHtml(opts: LoginPageOptions): string {
  const where = opts.isPublic ? '此公网地址' : '此局域网地址';
  const whereEn = opts.isPublic ? 'This public address' : 'This LAN address';
  const errMsg = opts.error === 'locked'
    ? `尝试次数过多，请 ${opts.retryAfter ?? 60} 秒后再试 | Too many attempts — try again in ${opts.retryAfter ?? 60}s`
    : opts.error
      ? '密码错误，请重试 | Wrong PIN, try again'
      : '';
  const errBlock = errMsg ? `<div class="err">${errMsg}</div>` : '<div class="err"></div>';
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>MOSS · 远程访问验证</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.card{background:#181b24;border:1px solid #2a2f3d;border-radius:14px;padding:30px 26px;max-width:340px;width:calc(100% - 48px);text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.4)}
h1{font-size:17px;margin:0 0 6px;color:#e7eaf2}
p{font-size:13px;color:#9aa3b5;margin:0 0 18px;line-height:1.6}
input{width:100%;box-sizing:border-box;padding:12px;font-size:20px;letter-spacing:8px;text-align:center;border:1px solid #333950;border-radius:9px;outline:none;margin-bottom:14px;background:#12141c;color:#e7eaf2}
input:focus{border-color:#5b7cfa}
button{width:100%;padding:12px;font-size:15px;background:#4f6ef7;color:#fff;border:none;border-radius:9px;cursor:pointer}
button:hover{background:#4361e6}
.err{color:#f06a6a;font-size:12px;margin-bottom:10px;min-height:16px;line-height:1.5}
.hint{font-size:11px;color:#5c6478;margin-top:14px;line-height:1.6}
</style></head><body><div class="card">
<h1>🔐 MOSS 远程访问</h1>
<p>${where}受访问密码保护，请输入 8 位数字密码<br>${whereEn} is password-protected — enter the 8-digit PIN</p>
${errBlock}
<form method="post" action="/remote/login">
<input name="token" type="password" inputmode="numeric" maxlength="8" autocomplete="one-time-code" autofocus required>
<button type="submit">进入 | Enter</button>
</form>
<div class="hint">登录一次后长期免输（MOSS 重启后需重新输入）<br>Log in once — re-enter after MOSS restarts</div>
</div></body></html>`;
}

/** 局域网访问已关闭的提示页（浏览器导航时显示；API 返回 403 JSON）。 */
export function lanDisabledPageHtml(): string {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>MOSS · 局域网访问已关闭</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.card{background:#181b24;border:1px solid #2a2f3d;border-radius:14px;padding:30px 26px;max-width:360px;width:calc(100% - 48px);text-align:center}
h1{font-size:16px;margin:0 0 10px;color:#e7eaf2}
p{font-size:13px;color:#9aa3b5;margin:0;line-height:1.7}
</style></head><body><div class="card">
<h1>🔒 MOSS</h1>
<p>局域网访问已关闭，扫码/链接均不可用。<br>请在电脑上重新开启后再试。<br><br>LAN access is disabled — re-enable it on the computer to continue.</p>
</div></body></html>`;
}

/** 公网隧道未运行的提示页（伪造 trycloudflare Host 直连时显示）。 */
export function tunnelNotRunningPageHtml(): string {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>MOSS · 公网隧道未开启</title>
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
.card{background:#181b24;border:1px solid #2a2f3d;border-radius:14px;padding:30px 26px;max-width:360px;width:calc(100% - 48px);text-align:center}
h1{font-size:16px;margin:0 0 10px;color:#e7eaf2}
p{font-size:13px;color:#9aa3b5;margin:0;line-height:1.7}
</style></head><body><div class="card">
<h1>🔒 MOSS</h1>
<p>公网隧道未开启或已关闭。<br>Public tunnel is not running.</p>
</div></body></html>`;
}
