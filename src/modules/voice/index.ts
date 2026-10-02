// src/modules/voice/index.ts
// Voice 模块入口：注册 VoiceServiceImpl 到 ServiceNames.VOICE_SERVICE。
//
// 语音输入默认关闭（appConfig.voice.enabled=false）；模块初始化只做轻量注册，
// sherpa-onnx 运行时异步预热（不阻塞内核启动与其他模块）。

import type { Module, ModuleContext } from '../../core/types';
import { ServiceNames } from '../../core/types';
import { VoiceServiceImpl } from './service';

class VoiceModule implements Module {
  async initialize(ctx: ModuleContext): Promise<void> {
    const service = new VoiceServiceImpl({
      logger: ctx.logger,
      config: ctx.config,
      dataDir: ctx.env.dataDir,
    });

    ctx.services.register(ServiceNames.VOICE_SERVICE, service, { scope: 'voice' });

    // 后台预热原生运行时（失败仅记日志，不影响模块可用性与其它功能）
    service.warmup();

    ctx.logger.info('voice module initialized', {
      enabled: service.getStatus().enabled,
      modelsRoot: ctx.env.dataDir,
    });
  }
}

export default (): Module => new VoiceModule();

export { VoiceServiceImpl } from './service';
export { VOICE_MODEL_CATALOG, defaultModelId, findModelDef } from './catalog';
export type {
  VoiceService,
  VoiceSession,
  VoiceStatus,
  VoiceModelStatus,
  VoiceResult,
  VoiceLocalEngine,
} from './types';