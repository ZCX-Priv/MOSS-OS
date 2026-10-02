// webui/src/api/heartbeat-worker.ts
// 心跳定时 Worker：Chrome 的 Intensive Throttling 会把后台标签页（≥5 分钟）中
// timeout ≤5 分钟的主线程 timer 对齐到 1 分钟一次，主线程 setInterval(15s) 心跳
// 因此退化成 ≥60s 一拍，恰好踩穿后端 WebSocket idleTimeout → 空闲挂后台必断连。
// Web Worker 的定时器不参与标签页级节流调度，是标准解法。
// 极简设计：只负责按间隔 postMessage，所有判断留在主线程（ws.ts）。

let timer: ReturnType<typeof setInterval> | null = null;

self.onmessage = (e: MessageEvent<string>) => {
  if (e.data === 'start') {
    if (timer !== null) return;
    timer = setInterval(() => {
      self.postMessage('tick');
    }, 15_000);
  } else if (e.data === 'stop') {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }
};
