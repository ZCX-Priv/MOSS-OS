// src/modules/context/healer/schema-fix.ts
// JSON Schema 校验 + 自动类型修正：
//   - 字符串型数字/布尔 ↔ 目标类型互转（模型常见输出形态）
//   - enum 大小写不敏感唯一匹配纠正
//   - required 缺失 / 类型不可修正 → 错误（回传自纠，不猜测补值）
//   - additionalProperties === false 时剔除未知字段，否则保留（保守）

export interface SchemaFixResult {
  /** 修正后的参数（原对象不被修改，返回新对象） */
  args: Record<string, unknown>;
  /** 已执行的自动修正说明 */
  fixes: string[];
  /** 无法自动修正的问题（非空 = valid=false） */
  errors: string[];
  valid: boolean;
}

/** JSON Schema 的鸭子结构（工具 inputSchema 的公共子集） */
interface JsonSchemaLike {
  type?: string | string[];
  properties?: Record<string, JsonSchemaLike>;
  required?: string[];
  enum?: Array<string | number | boolean | null>;
  additionalProperties?: boolean | JsonSchemaLike;
  items?: JsonSchemaLike;
}

/**
 * 校验并尽量修正参数对象。
 * @param args 修复后的参数对象（来自 args-repair）
 * @param inputSchema 工具的 JSON Schema（ToolRegistry.get(name).inputSchema）
 * @param fixEnabled 是否启用自动类型修正（config.context.healer.schemaFix）
 */
export function validateAndFixSchema(
  args: Record<string, unknown>,
  inputSchema: unknown,
  fixEnabled: boolean,
): SchemaFixResult {
  const fixes: string[] = [];
  const errors: string[] = [];

  if (!inputSchema || typeof inputSchema !== 'object') {
    // 无 schema 可校验：直接放行（工具自行处理）
    return { args, fixes, errors, valid: true };
  }
  const schema = inputSchema as JsonSchemaLike;
  if (schema.type && schema.type !== 'object' && !(Array.isArray(schema.type) && schema.type.includes('object'))) {
    // 非 object 型 schema：跳过校验（当前所有工具均为 object 参数）
    return { args, fixes, errors, valid: true };
  }

  const out: Record<string, unknown> = { ...args };
  const props = schema.properties ?? {};

  // 1. 逐属性校验 + 修正
  for (const [key, propSchema] of Object.entries(props)) {
    if (!(key in out)) continue;
    const fixed = fixPropertyValue(key, out[key], propSchema, fixEnabled);
    out[key] = fixed.value;
    fixes.push(...fixed.fixes);
    errors.push(...fixed.errors);
  }

  // 2. required 缺失检查
  for (const req of schema.required ?? []) {
    if (!(req in out) || out[req] === undefined || out[req] === null) {
      errors.push(`missing required parameter "${req}"`);
    }
  }

  // 3. 未知字段：schema 明确禁止时剔除（保守：默认保留）
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(out)) {
      if (!(key in props)) {
        delete out[key];
        fixes.push(`removed unknown parameter "${key}" (schema forbids additional properties)`);
      }
    }
  }

  return { args: out, fixes, errors, valid: errors.length === 0 };
}

/** 单属性值修正 */
function fixPropertyValue(
  key: string,
  value: unknown,
  schema: JsonSchemaLike,
  fixEnabled: boolean,
): { value: unknown; fixes: string[]; errors: string[] } {
  const fixes: string[] = [];
  const errors: string[] = [];
  if (value === undefined || value === null) return { value, fixes, errors };

  // enum 唯一匹配（大小写不敏感）
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    if (!schema.enum.includes(value as string | number | boolean | null)) {
      const lower = String(value).toLowerCase();
      const hits = schema.enum.filter(e => String(e).toLowerCase() === lower);
      if (fixEnabled && hits.length === 1) {
        fixes.push(`parameter "${key}": corrected "${String(value)}" to enum value "${String(hits[0])}"`);
        return { value: hits[0], fixes, errors };
      }
      errors.push(`parameter "${key}": value "${String(value)}" not in enum [${schema.enum.map(String).join(', ')}]`);
      return { value, fixes, errors };
    }
    return { value, fixes, errors };
  }

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (!type) return { value, fixes, errors };

  // 字符串目标
  if (type === 'string' && typeof value !== 'string') {
    if (fixEnabled && (typeof value === 'number' || typeof value === 'boolean')) {
      fixes.push(`parameter "${key}": converted ${typeof value} to string`);
      return { value: String(value), fixes, errors };
    }
    errors.push(`parameter "${key}": expected string, got ${typeof value}`);
    return { value, fixes, errors };
  }

  // 数字目标
  if (type === 'number' || type === 'integer') {
    if (typeof value === 'number') {
      if (type === 'integer' && !Number.isInteger(value) && fixEnabled) {
        fixes.push(`parameter "${key}": truncated ${value} to integer`);
        return { value: Math.trunc(value), fixes, errors };
      }
      return { value, fixes, errors };
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const num = Number(value);
      if (Number.isFinite(num)) {
        if (fixEnabled) {
          const final = type === 'integer' ? Math.trunc(num) : num;
          fixes.push(`parameter "${key}": converted string "${value}" to ${type}`);
          return { value: final, fixes, errors };
        }
      }
    }
    errors.push(`parameter "${key}": expected ${type}, got ${typeof value}`);
    return { value, fixes, errors };
  }

  // 布尔目标
  if (type === 'boolean' && typeof value !== 'boolean') {
    if (fixEnabled && typeof value === 'string') {
      const lower = value.trim().toLowerCase();
      if (lower === 'true' || lower === 'false') {
        fixes.push(`parameter "${key}": converted string "${value}" to boolean`);
        return { value: lower === 'true', fixes, errors };
      }
    }
    errors.push(`parameter "${key}": expected boolean, got ${typeof value}`);
    return { value, fixes, errors };
  }

  // 数组目标
  if (type === 'array' && !Array.isArray(value)) {
    errors.push(`parameter "${key}": expected array, got ${typeof value}`);
    return { value, fixes, errors };
  }

  // 对象目标
  if (type === 'object' && (typeof value !== 'object' || Array.isArray(value))) {
    errors.push(`parameter "${key}": expected object, got ${Array.isArray(value) ? 'array' : typeof value}`);
    return { value, fixes, errors };
  }

  return { value, fixes, errors };
}
