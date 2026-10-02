// webui/src/components/shared/VoiceWaveform.tsx
// 录音中的跳动线条：高度由实时音量（level 0..1）驱动，每根条带不同相位系数。
// 用于替换麦克风图标，直观表达「正在收音」。

interface VoiceWaveformProps {
  /** 实时音量 0..1 */
  level: number;
  /** 条数（默认 4） */
  bars?: number;
}

/** 各条相位系数（固定错落，避免整齐划一） */
const PHASES = [0.45, 0.9, 0.62, 1, 0.75, 0.5];

export function VoiceWaveform({ level, bars = 4 }: VoiceWaveformProps) {
  return (
    <span className="flex h-4 items-center justify-center gap-[2px]" aria-hidden="true">
      {Array.from({ length: bars }).map((_, i) => {
        const factor = PHASES[i % PHASES.length];
        const height = Math.max(3, Math.min(16, level * 16 * factor * 1.8));
        return (
          <span
            key={i}
            className="w-[2px] rounded-full bg-current transition-[height] duration-75 ease-out"
            style={{ height: `${height}px` }}
          />
        );
      })}
    </span>
  );
}