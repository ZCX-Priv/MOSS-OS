// src/modules/server/routes/filesystem-drives.test.ts
// 「本机」卷枚举的纯函数与处理器测试：
//   1. parseLinuxMounts：过滤伪文件系统、排除 / 与系统前缀、去重（含尾斜杠）
//   2. selectDarwinVolumes：排除符号链接（Macintosh HD → /）、非目录与隐藏项
//   3. createListDrivesHandler：返回 200 + drives 数组；Android 分支至少含 home 入口
// 这些用例可在 Windows 上直接运行（不依赖真实 Mac/Linux/Android 主机）。

import { describe, it, expect } from 'bun:test';
import { parseLinuxMounts, selectDarwinVolumes, createListDrivesHandler } from './filesystem';
import type { Environment } from '../../../core/types';
import { homedir } from 'node:os';

/** 构造最小可用 Environment（字段完整，避免使用 any） */
function makeEnv(overrides: Partial<Environment>): Environment {
  const home = homedir();
  return {
    platform: 'linux',
    arch: 'x64',
    isWindows: false,
    isMac: false,
    isLinux: true,
    isAndroid: false,
    homeDir: home,
    dataDir: `${home}/.moss`,
    configDir: `${home}/.moss/config`,
    logsDir: `${home}/.moss/logs`,
    pidFile: `${home}/.moss/moss.pid`,
    runtimeVersion: 'test',
    pid: process.pid,
    packageRoot: process.cwd(),
    ...overrides,
  };
}

describe('parseLinuxMounts', () => {
  it('保留真实挂载点，过滤伪文件系统与系统前缀，并去重', () => {
    const text = [
      '/dev/sda1 / ext4 rw,relatime 0 0',
      'proc /proc proc rw 0 0',
      'sysfs /sys sysfs rw 0 0',
      'tmpfs /run tmpfs rw 0 0',
      'devtmpfs /dev devtmpfs rw 0 0',
      '/dev/sdb1 /home ext4 rw 0 0',
      '/dev/sdc1 /media/usb vfat rw 0 0',
      'overlay /var/lib/docker/overlay2/abc overlay rw 0 0',
      '/dev/loop0 /snap/core/123 squashfs ro 0 0',
      '/dev/nvme0n1p2 /mnt/data ext4 rw 0 0',
      '/dev/sdb1 /home/ ext4 rw 0 0', // 尾斜杠重复项 → 去重
      '/dev/sdd1 /run/media/user/USB ext4 rw 0 0', // 可移动介质 → 保留
      '',
    ].join('\n');

    expect(parseLinuxMounts(text)).toEqual([
      '/home',
      '/media/usb',
      '/mnt/data',
      '/run/media/user/USB',
    ]);
  });

  it('排除根 / 与不以 / 开头的挂载点', () => {
    const text = ['/dev/sda1 / ext4 rw 0 0', 'none swap sw 0 0'].join('\n');
    expect(parseLinuxMounts(text)).toEqual([]);
  });

  it('空文本返回空数组', () => {
    expect(parseLinuxMounts('')).toEqual([]);
  });
});

describe('selectDarwinVolumes', () => {
  it('排除符号链接、非目录与隐藏项，仅保留真实卷', () => {
    const entries = [
      { name: 'Macintosh HD', isSymlink: true, isDirectory: true }, // 指向 / 的链接
      { name: 'USB', isSymlink: false, isDirectory: true },
      { name: '.hidden', isSymlink: false, isDirectory: true },
      { name: 'file.txt', isSymlink: false, isDirectory: false },
      { name: '', isSymlink: false, isDirectory: true },
    ];
    expect(selectDarwinVolumes(entries)).toEqual(['USB']);
  });

  it('空列表返回空数组', () => {
    expect(selectDarwinVolumes([])).toEqual([]);
  });
});

describe('createListDrivesHandler', () => {
  it('Windows 分支：所有条目 kind=drive 且路径为盘符根', async () => {
    const handler = createListDrivesHandler(makeEnv({ isWindows: true, isLinux: false, platform: 'win32' }));
    const res = await handler({} as never);
    expect(res.status).toBe(200);
    const drives = (res.body as { drives: Array<{ kind: string; path: string }> }).drives;
    expect(Array.isArray(drives)).toBe(true);
    if (process.platform === 'win32') {
      expect(drives.length).toBeGreaterThan(0);
      for (const d of drives) {
        expect(d.kind).toBe('drive');
        expect(d.path).toMatch(/^[A-Za-z]:\\$/);
      }
    }
  });

  it('Android 分支：home 入口存在，kind 仅含 home/storage', async () => {
    const handler = createListDrivesHandler(
      makeEnv({ isAndroid: true, isLinux: false, platform: 'android' }),
    );
    const res = await handler({} as never);
    const drives = (res.body as { drives: Array<{ kind: string; path: string }> }).drives;
    // homeDir 必然存在 → 至少一个 home 入口
    expect(drives.some((d) => d.kind === 'home')).toBe(true);
    for (const d of drives) {
      expect(['home', 'storage']).toContain(d.kind);
    }
  });

  it('macOS 分支：返回 200 且条目 kind 仅含 root/volume', async () => {
    const handler = createListDrivesHandler(
      makeEnv({ isMac: true, isLinux: false, platform: 'darwin' }),
    );
    const res = await handler({} as never);
    expect(res.status).toBe(200);
    const drives = (res.body as { drives: Array<{ kind: string }> }).drives;
    for (const d of drives) {
      expect(['root', 'volume']).toContain(d.kind);
    }
  });
});
