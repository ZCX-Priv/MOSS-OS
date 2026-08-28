import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 touch-none items-center rounded-full transition-all outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-[size=default]:h-[18.4px] data-[size=default]:w-[32px] data-[size=sm]:h-[14px] data-[size=sm]:w-[24px] dark:aria-invalid:ring-destructive/40 data-checked:bg-primary data-unchecked:bg-input dark:data-unchecked:bg-input/80 data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      {/* 几何不变量（勿破坏，否则 thumb 不再贴边）：
          1) 轨道不设 border —— thumb 布局盒 = 可见轨道（背景默认延伸到边框下，
             加 border 会使 thumb 两端各退边框宽度）；
          2) 尺寸全部用 px，勿改回 rem 类（size-4 等）—— 应用按字号设置改 root
             font-size，rem thumb 会缩放而 px 轨道固定，比例漂移；
          3) 轨道宽 = 2 × thumb 宽（default 32/16，sm 24/12）—— translate-x-full
             （= thumb 自身宽）恰好从左缘滑到右缘，两端与 pill 端帽精确内切。 */}
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full bg-background ring-0 transition-transform group-data-[size=default]/switch:size-[16px] group-data-[size=sm]/switch:size-[12px] data-checked:translate-x-full data-checked:bg-white data-unchecked:translate-x-0 dark:data-unchecked:bg-foreground"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
