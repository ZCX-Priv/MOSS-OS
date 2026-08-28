// src/modules/remote/types.ts
// remote 模块类型定义：远程控制 MOSS agent（局域网 + 公网隧道访问 webui）。

/** 远程访问配置（config.json 的 remote 段） */
export interface RemoteConfig {
  /** 远程访问总开关：true 时主 server 绑定 0.0.0.0 并启用请求门卫 */
  enabled: boolean;
  /** 局域网访问开关：false 时拒绝所有局域网来源请求（公网不受影响） */
  lanEnabled: boolean;
  /** 局域网密码开关：true 时局域网访问需要 8 位数字密码 */
  lanPasswordEnabled: boolean;
  /** 局域网地址手动覆盖（IPv4 字符串；空值表示自动选择） */
  lanIpOverride: string;
}

/** cloudflared 隧道状态机 */
export type TunnelPhase = 'idle' | 'downloading' | 'starting' | 'registering' | 'ready' | 'error';

/** 隧道运行状态快照 */
export interface TunnelState {
  phase: TunnelPhase;
  /** 进度/错误详情（人类可读，双语由前端 i18n 处理，这里给原始信息） */
  detail: string;
  startedAt: number | null;
}

/** GET /api/remote/status 响应（不含任何密码明文） */
export interface RemoteStatusSnapshot {
  /** 远程访问总开关 */
  enabled: boolean;
  /** 主 server 实际端口（二维码 URL 组成部分） */
  port: number;
  /** 局域网 */
  lanEnabled: boolean;
  lanPasswordEnabled: boolean;
  /** 自动选择的局域网 IPv4（考虑 override）；null 表示未探测到 */
  lanIp: string | null;
  /** 局域网访问 URL（lanIp 存在时） */
  lanUrl: string | null;
  /** 可手动选择的局域网 IP 候选（含 override） */
  lanCandidates: string[];
  /** 手动覆盖值（空串 = 自动） */
  lanIpOverride: string;
  /** 公网隧道 */
  tunnel: TunnelState;
  /** 公网 URL（隧道 ready 时） */
  tunnelUrl: string | null;
  /** 公网密码是否已自定义（自定义后开启隧道不再自动轮换） */
  publicPasswordCustomized: boolean;
}

/** 密码作用域：局域网 / 公网（严格分域：各自密码各自 cookie） */
export type RemoteScope = 'lan' | 'public';

/** 密码明文视图（GET /api/remote/passwords，仅已认证者可见） */
export interface RemotePasswordsView {
  lan: string | null;
  public: string | null;
  /** 局域网密码是否启用（false 时局域网免密） */
  lanPasswordEnabled: boolean;
  publicCustomized: boolean;
}
