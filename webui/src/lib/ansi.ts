// UI/src/lib/ansi.ts
// 终端 ANSI 转义与 shell 结果解析工具

import AnsiToHtml from 'ansi-to-html';

// 浅色底可读的 ANSI 16 色调色板（0-15：标准色 + 亮色；深色形态使用库默认调色板）
const LIGHT_COLORS = [
  '#1f2937', '#b91c1c', '#15803d', '#a16207',
  '#1d4ed8', '#a21caf', '#0e7490', '#52525b',
  '#71717a', '#dc2626', '#16a34a', '#ca8a04',
  '#2563eb', '#c026d3', '#0891b2', '#3f3f46',
];

// 按主题各复用一个 converter 实例（escapeXML 防止 XSS，不转换换行以便 pre 保留格式）
const darkConverter = new AnsiToHtml({
  fg: '#d4d4d4',
  bg: '#1e1e1e',
  newline: false,
  escapeXML: true,
});
const lightConverter = new AnsiToHtml({
  fg: '#3f3f46',
  bg: '#ffffff',
  newline: false,
  escapeXML: true,
  colors: LIGHT_COLORS,
});

/** 将带 ANSI 转义的文本转为带颜色的 HTML（theme 默认 dark，向后兼容） */
export function ansiToHtml(text: string, theme: 'light' | 'dark' = 'dark'): string {
  return (theme === 'light' ? lightConverter : darkConverter).toHtml(text);
}

/** shell 工具结果解析（格式固定：Exit code / stdout / stderr 三段） */
export interface ParsedShellResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** 解析 shell 工具返回的 text content（格式：Exit code: N\n--- stdout ---\n...\n--- stderr ---\n...） */
export function parseShellResult(text: string): ParsedShellResult {
  const exitCodeMatch = text.match(/^Exit code:\s*(-?\d+)/);
  const exitCode = exitCodeMatch ? parseInt(exitCodeMatch[1], 10) : 0;
  const stdoutMatch = text.match(/--- stdout ---\r?\n([\s\S]*?)(?:\r?\n--- stderr ---|$)/);
  const stderrMatch = text.match(/--- stderr ---\r?\n([\s\S]*?)$/);
  return {
    exitCode,
    stdout: stdoutMatch ? stdoutMatch[1].replace(/\r?\n$/, '').trimEnd() : '',
    stderr: stderrMatch ? stderrMatch[1].replace(/\r?\n$/, '').trimEnd() : '',
  };
}

/** 从 toolCall.arguments（JSON 字符串）解析 shell 命令 */
export function parseShellCommand(argumentsJson: string): string {
  try {
    const parsed = JSON.parse(argumentsJson || '{}') as { command?: string };
    return parsed.command ?? '';
  } catch {
    return '';
  }
}
