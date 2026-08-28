// src/modules/remote/guard.ts
// 请求门卫：远程访问开启时的统一认证层（HTTP + WS upgrade + /mcp + 静态资源全覆盖）。
//
// 判定逻辑（安全关键——不能只看 Host 头，局域网攻击者可伪造任意 Host）：
//   客户端 IP 是 loopback 且 Host 非 trycloudflare → 本机信任（现状行为完全不变）
//   Host 是 trycloudflare（无论客户端 IP）→ 公网：强制公网密码；隧道未运行则 403
//   客户端 IP 非 loopback 且 Host 非隧道域名 → 局域网（含伪造）：按 lanEnabled / lanPasswordEnabled 策略
//
// 安全原理：局域网攻击者无法把 TCP 源地址伪装成 loopback；公网攻击者经 Cloudflare
// 边缘时 Host 必须是已注册的隧道子域才能路由到本机（改 Host 头会路由失败）；
// 非 loopback 来源声称隧道域名 → 一律按公网强密码处理，伪造无收益。

import type { ConfigService } from '../../core/types';
import type {
  GuardRequestContext,
  GuardResponse,
  GuardVerdict,
  RequestGuard,
} from '../server/types';
import { RemoteAuth } from './auth';
import { lanDisabledPageHtml, loginPageHtml, tunnelNotRunningPageHtml } from './login-page';
import type { RemoteScope } from './types';

/** trycloudflare 快速隧道域名 */
const TUNNEL_HOST_RE = /trycloudflare\.com$/i;

/** 登录表单端点 */
const LOGIN_PATH = '/remote/login';

/** 判定地址是否 loopback（兼容 IPv6-mapped 格式 ::ffff:127.0.0.1） */
export function isLoopbackAddress(addr: string): boolean {
  let ip = String(addr ?? '').trim().toLowerCase();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip === '127.0.0.1' || ip === '::1' || ip === '0.0.0.0' || ip.startsWith('127.');
}

/** 从 Host 头提取主机名（去端口、去 IPv6 方括号） */
export function hostnameOf(host: string): string {
  let name = String(host ?? '').trim().toLowerCase();
  if (name.startsWith('[')) {
    const end = name.indexOf(']');
    if (end >= 0) return name.slice(1, end);
    return name;
  }
  return name.replace(/:\d+$/, '');
}

/** 该 Host 是否 trycloudflare 隧道域名 */
export function isTunnelHost(host: string): boolean {
  return TUNNEL_HOST_RE.test(hostnameOf(host));
}

/** 请求是否期望 HTML（浏览器导航 → 返回登录页；API/WS → 401） */
function isHtmlRequest(ctx: GuardRequestContext): boolean {
  const accept = String(ctx.headers['accept'] ?? '');
  const path = new URL(ctx.url, 'http://x').pathname;
  return accept.includes('text/html') || path === '/' || /\.html?$/i.test(path);
}

function htmlResponse(html: string, status = 200): GuardResponse {
  return {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    body: html,
  };
}

function jsonResponse(body: string, status: number): GuardResponse {
  return {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body,
  };
}

/**
 * 客户端真实 IP（速率限制用）：
 * 仅在隧道流量（trycloudflare Host）下信任 cf-connecting-ip（Cloudflare 在隧道入口
 * 设置的真实客户端 IP）；其余场景用 TCP 源地址。**不信任 x-forwarded-for**（可伪造）。
 */
export function effectiveClientIp(ctx: GuardRequestContext): string {
  if (isTunnelHost(ctx.headers['host'] ?? '')) {
    const cf = String(ctx.headers['cf-connecting-ip'] ?? '').trim();
    if (cf) return cf;
  }
  return ctx.clientIp || 'unknown';
}

export interface RemoteGuardOptions {
  config: ConfigService;
  auth: RemoteAuth;
  /** 隧道是否运行中（service 注入；避免 guard↔service 循环依赖） */
  isTunnelRunning: () => boolean;
}

/** 远程访问请求门卫实现。 */
export class RemoteGuard implements RequestGuard {
  private readonly config: ConfigService;
  private readonly auth: RemoteAuth;
  private readonly isTunnelRunning: () => boolean;

  constructor(opts: RemoteGuardOptions) {
    this.config = opts.config;
    this.auth = opts.auth;
    this.isTunnelRunning = opts.isTunnelRunning;
  }

  precheck(ctx: GuardRequestContext): GuardVerdict {
    const remote = this.config.getAppConfig().remote;
    if (!remote.enabled) return { action: 'pass' };

    const host = ctx.headers['host'] ?? '';
    const tunnelHost = isTunnelHost(host);
    const loopbackClient = isLoopbackAddress(ctx.clientIp);

    // ---- 公网（隧道域名；cloudflared 回连是 loopback 客户端 + 隧道 Host，伪造直连是非 loopback）----
    if (tunnelHost) {
      if (!this.isTunnelRunning()) {
        // 隧道未运行：任何声称隧道域名的请求都拒绝（含伪造直连）
        return {
          action: 'respond',
          response: isHtmlRequest(ctx)
            ? htmlResponse(tunnelNotRunningPageHtml(), 403)
            : jsonResponse('{"error":"tunnel-not-running"}', 403),
        };
      }
      if (this.isLoginPost(ctx)) return { action: 'login' };
      if (this.auth.checkCookie(ctx.headers['cookie'] ?? '', 'public')) {
        return this.authenticated(ctx);
      }
      return { action: 'respond', response: this.unauthenticated(ctx, true) };
    }

    // ---- 本机信任（loopback 客户端 + 非隧道 Host）→ 现状行为完全不变 ----
    if (loopbackClient) return { action: 'pass' };

    // ---- 局域网（非 loopback 客户端 + 非隧道 Host，含伪造） ----
    if (!remote.lanEnabled) {
      return {
        action: 'respond',
        response: isHtmlRequest(ctx)
          ? htmlResponse(lanDisabledPageHtml(), 403)
          : jsonResponse('{"error":"lan-disabled"}', 403),
      };
    }
    if (!remote.lanPasswordEnabled) return { action: 'pass' };

    if (this.isLoginPost(ctx)) return { action: 'login' };
    if (this.auth.checkCookie(ctx.headers['cookie'] ?? '', 'lan')) {
      return this.authenticated(ctx);
    }
    return { action: 'respond', response: this.unauthenticated(ctx, false) };
  }

  handleLogin(ctx: GuardRequestContext, body: string): GuardResponse {
    const scope: RemoteScope = isTunnelHost(ctx.headers['host'] ?? '') ? 'public' : 'lan';
    const ip = effectiveClientIp(ctx);

    // 速率限制：锁定期间直接 429
    const rl = this.auth.limiter.status(ip);
    if (rl.locked) {
      return htmlResponse(loginPageHtml({ error: 'locked', isPublic: scope === 'public', retryAfter: rl.retryAfter }), 429);
    }

    // 解析表单（application/x-www-form-urlencoded）
    let submitted = '';
    try {
      submitted = String(new URLSearchParams(body).get('token') ?? '');
    } catch {
      submitted = '';
    }

    if (this.auth.verifyPin(scope, submitted)) {
      this.auth.limiter.clear(ip);
      return {
        status: 302,
        headers: {
          location: '/',
          'set-cookie': this.auth.buildSetCookie(scope),
          'cache-control': 'no-store',
        },
        body: '',
      };
    }

    this.auth.limiter.record(ip);
    return htmlResponse(loginPageHtml({ error: true, isPublic: scope === 'public' }));
  }

  checkWS(ctx: GuardRequestContext): boolean {
    const verdict = this.precheck(ctx);
    return verdict.action === 'pass' || verdict.action === 'pass-authenticated';
  }

  // -------------------------------------------------------------------------

  /** 已认证放行：authToken 存在时注入 Authorization（"两者结合"：API 鉴权层认可远程会话）。 */
  private authenticated(ctx: GuardRequestContext): GuardVerdict {
    void ctx;
    const authToken = this.config.getAppConfig().security.authToken;
    if (!authToken) return { action: 'pass' };
    return { action: 'pass-authenticated', authorization: `Bearer ${authToken}` };
  }

  /** 未认证：HTML → 登录页；API/WS → 401 JSON。 */
  private unauthenticated(ctx: GuardRequestContext, isPublic: boolean): GuardResponse {
    if (isHtmlRequest(ctx)) {
      return htmlResponse(loginPageHtml({ error: false, isPublic }));
    }
    return jsonResponse('{"error":"unauthorized"}', 401);
  }

  private isLoginPost(ctx: GuardRequestContext): boolean {
    const path = new URL(ctx.url, 'http://x').pathname;
    return ctx.method.toUpperCase() === 'POST' && path === LOGIN_PATH;
  }
}
