// webui/src/utils/shortcut.ts
// 发送快捷键的解析 / 归一化 / 录制 / 匹配。
// 格式规范：小写、'+' 分隔；修饰键顺序固定 mod/ctrl/alt/shift，最后是主键
// （e.key 小写，空格写作 space）。示例：'enter'、'mod+enter'、'ctrl+shift+enter'、'f2'。
// 旧格式 'ctrl-enter' 兼容：normalizeShortcut 会迁移为 'mod+enter'。

/** 事件的最小结构（KeyboardEvent 兼容，便于纯函数测试） */
export interface ShortcutEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const MODIFIER_ORDER = ['mod', 'ctrl', 'alt', 'shift'] as const;

/** 把 ctrl/meta/cmd/command 统一映射为 mod；其余原样返回 */
function mapModifierToken(token: string): string {
  if (token === 'ctrl' || token === 'meta' || token === 'cmd' || token === 'command') {
    return 'mod';
  }
  return token;
}

/** 归一化主键：小写；空格 → space */
function normalizeMainKey(key: string): string {
  const lower = key.toLowerCase();
  return lower === ' ' ? 'space' : lower;
}

/**
 * 归一化快捷键字符串：
 * - 兼容旧格式（'-' 分隔，如 'ctrl-enter'）
 * - ctrl/meta/cmd 统一为 mod（旧 'ctrl-enter' 因此迁移为 'mod+enter'，语义不变）
 * - 修饰键去重并按 mod/ctrl/alt/shift 排序
 */
export function normalizeShortcut(raw: string): string {
  const tokens = raw
    .toLowerCase()
    .split('+')
    .flatMap((part) => part.split('-'))
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return '';

  const modifiers = new Set<string>();
  const mains: string[] = [];
  for (const token of tokens) {
    const mapped = mapModifierToken(token);
    if ((MODIFIER_ORDER as readonly string[]).includes(mapped)) {
      modifiers.add(mapped);
    } else {
      mains.push(normalizeMainKey(token));
    }
  }
  if (mains.length === 0) return '';

  const ordered = MODIFIER_ORDER.filter((m) => modifiers.has(m));
  return [...ordered, mains[mains.length - 1]].join('+');
}

const MAIN_KEY_LABELS: Record<string, string> = {
  enter: 'Enter',
  space: 'Space',
  escape: 'Esc',
  tab: 'Tab',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
};

/** 主键显示：F1-F12 / 单字母原样大写，其余首字母大写或查表 */
function mainKeyLabel(key: string): string {
  const mapped = MAIN_KEY_LABELS[key];
  if (mapped) return mapped;
  if (/^f\d{1,2}$/.test(key)) return key.toUpperCase();
  if (key.length === 1) return key.toUpperCase();
  return key.charAt(0).toUpperCase() + key.slice(1);
}

const isMac =
  typeof navigator !== 'undefined' && /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);

/** 生成显示标签，如 "Ctrl+Shift+Enter"、"F2"；mod 在 mac 显示 ⌘ 否则 Ctrl */
export function formatShortcutLabel(shortcut: string): string {
  const normalized = normalizeShortcut(shortcut);
  if (!normalized) return '';
  return normalized
    .split('+')
    .map((token) => {
      switch (token) {
        case 'mod':
          return isMac ? '⌘' : 'Ctrl';
        case 'ctrl':
          return 'Ctrl';
        case 'alt':
          return isMac ? '⌥' : 'Alt';
        case 'shift':
          return isMac ? '⇧' : 'Shift';
        default:
          return mainKeyLabel(token);
      }
    })
    .join(isMac ? '' : '+');
}

/** 从 keydown 事件提取快捷键字符串；纯修饰键 / Escape 返回 null（录制场景用） */
export function eventToShortcut(e: ShortcutEventLike): string | null {
  const key = e.key;
  // 纯修饰键按下：等待用户继续按主键
  if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') return null;
  // Escape 保留给「取消录制」
  if (key === 'Escape') return null;

  const modifiers: string[] = [];
  // 录制场景 Ctrl/Cmd 统一归 mod（显式仅 Ctrl 的组合无实际需求）
  if (e.ctrlKey || e.metaKey) modifiers.push('mod');
  if (e.altKey) modifiers.push('alt');
  if (e.shiftKey) modifiers.push('shift');

  const parts = [...modifiers, normalizeMainKey(key)];
  return normalizeShortcut(parts.join('+'));
}

/** keydown 事件是否命中快捷键（shortcut 为归一化或旧格式均可） */
export function matchesShortcut(e: ShortcutEventLike, shortcut: string): boolean {
  const normalized = normalizeShortcut(shortcut);
  if (!normalized) return false;

  const tokens = normalized.split('+');
  const mainKey = tokens[tokens.length - 1];
  const modifierSet = new Set(tokens.slice(0, -1));

  const needMod = modifierSet.has('mod');
  const needCtrl = modifierSet.has('ctrl');
  const needAlt = modifierSet.has('alt');
  const needShift = modifierSet.has('shift');

  // mod：ctrl 或 meta 任一命中即可；ctrl（显式）：要求 ctrlKey 且非 meta
  const modOk = needMod ? e.ctrlKey || e.metaKey : true;
  const ctrlOk = needCtrl ? e.ctrlKey && !e.metaKey : true;
  const altOk = needAlt ? e.altKey : !e.altKey;
  const shiftOk = needShift ? e.shiftKey : !e.shiftKey;

  return modOk && ctrlOk && altOk && shiftOk && normalizeMainKey(e.key) === mainKey;
}
