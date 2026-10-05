// render/data/SqlitePreview.tsx
// SQLite 数据库预览：sql.js（WASM，按需加载）读库 → 左侧表/视图列表 + 主区表格（分页）。
// 只读：不写回文件；BLOB 仅显示字节长度，NULL 以斜体区分。
// 本组件经 React.lazy 懒加载（FilePreviewPane 分发）。

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Database as DbIcon, Loader2, Play } from 'lucide-react';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { Button } from '../../components/ui/button';

/** 单次查询返回行数上限（防大表一次性挂载） */
const PAGE_SIZE = 200;

type SqlValue = string | number | Uint8Array | null;
type QueryResult = { columns: string[]; values: SqlValue[][] };

/** sql.js Database 的最小结构（避免引入其完整类型时的耦合） */
interface SqlDatabase {
  exec(sql: string): QueryResult[];
  close(): void;
  getRowsModified(): number;
}

interface SqlModule {
  Database: new (data?: Uint8Array) => SqlDatabase;
}

export interface SqlitePreviewProps {
  buffer: ArrayBuffer;
  fileName: string;
}

export function SqlitePreview({ buffer, fileName }: SqlitePreviewProps) {
  const { t } = useTranslation();
  const [db, setDb] = useState<SqlDatabase | null>(null);
  const [tables, setTables] = useState<string[]>([]);
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [rowLimit, setRowLimit] = useState(PAGE_SIZE);
  const [totalRows, setTotalRows] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 加载数据库
  useEffect(() => {
    let cancelled = false;
    let instance: SqlDatabase | null = null;
    setLoading(true);
    setError(null);
    setDb(null);
    void (async () => {
      try {
        const initSqlJs = (await import('sql.js')).default;
        const SQL = (await initSqlJs({ locateFile: () => wasmUrl })) as unknown as SqlModule;
        if (cancelled) return;
        instance = new SQL.Database(new Uint8Array(buffer));
        if (cancelled) {
          instance.close();
          return;
        }
        const list = instance.exec(
          "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
        );
        const names = (list[0]?.values ?? []).map((r) => String(r[0]));
        setDb(instance);
        setTables(names);
        setLoading(false);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      // 释放 wasm 侧数据库实例
      try {
        instance?.close();
      } catch {
        // 忽略
      }
    };
  }, [buffer]);

  // 选中表 → 查询数据
  useEffect(() => {
    if (!db || activeTable === null) {
      setResult(null);
      setTotalRows(null);
      return;
    }
    let cancelled = false;
    try {
      const quoted = `"${activeTable.replace(/"/g, '""')}"`;
      const count = db.exec(`SELECT COUNT(*) FROM ${quoted}`);
      const total = count[0]?.values?.[0]?.[0];
      const data = db.exec(`SELECT * FROM ${quoted} LIMIT ${rowLimit}`);
      if (!cancelled) {
        setResult(data[0] ?? null);
        setTotalRows(typeof total === 'number' ? total : Number(total ?? 0));
      }
    } catch (err: unknown) {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    }
    return () => {
      cancelled = true;
    };
  }, [db, activeTable, rowLimit]);

  if (error !== null) {
    return <div className="flex h-full items-center justify-center text-sm text-destructive">{error}</div>;
  }
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" />
        <span className="text-sm">{fileName}</span>
      </div>
    );
  }

  const renderCell = (v: SqlValue): { text: string; className: string } => {
    if (v === null) return { text: 'NULL', className: 'italic text-muted-foreground' };
    if (v instanceof Uint8Array) return { text: `BLOB(${v.byteLength} B)`, className: 'text-muted-foreground' };
    return { text: String(v), className: 'text-foreground' };
  };

  return (
    <div className="flex h-full min-h-0 gap-2">
      <div className="flex w-44 shrink-0 flex-col gap-1 overflow-auto rounded border border-border p-1">
        <div className="flex items-center gap-1.5 px-1 py-0.5 text-[11px] text-muted-foreground">
          <DbIcon className="size-3.5" />
          <span className="tabular-nums">{t('preview.sqliteTables', { count: tables.length })}</span>
        </div>
        {tables.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => {
              setActiveTable(name);
              setRowLimit(PAGE_SIZE);
            }}
            className={`truncate rounded px-2 py-1 text-left font-mono text-xs transition-colors ${
              name === activeTable ? 'bg-primary-strong/10 text-primary-strong' : 'text-foreground hover:bg-muted'
            }`}
            title={name}
          >
            {name}
          </button>
        ))}
        {tables.length === 0 && (
          <div className="px-2 py-2 text-xs text-muted-foreground">{t('preview.sqliteEmpty')}</div>
        )}
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1">
        {activeTable === null ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            {t('preview.sqlitePickTable')}
          </div>
        ) : (
          <>
            <div className="flex shrink-0 items-center justify-between gap-2 px-1 text-[11px] text-muted-foreground">
              <span className="truncate font-mono text-foreground">{activeTable}</span>
              <span className="tabular-nums">{totalRows ?? '?'}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-auto rounded border border-border">
              {result && result.columns.length > 0 ? (
                <table className="data-table w-full border-collapse text-xs">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      {result.columns.map((c) => (
                        <th key={c} className="border-b border-r border-border/60 px-2 py-1 text-left font-medium text-foreground">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.values.map((row, r) => (
                      <tr key={r} className="border-b border-border/60">
                        {row.map((cell, c) => {
                          const { text, className } = renderCell(cell);
                          return (
                            <td key={c} className={`border-r border-border/60 px-2 py-1 ${className}`} title={text}>
                              {text}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  {t('preview.sqliteEmptyTable')}
                </div>
              )}
            </div>
            {result && totalRows !== null && result.values.length < totalRows && (
              <div className="shrink-0 text-center">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-3 text-xs"
                  onClick={() => setRowLimit((n) => n + PAGE_SIZE)}
                >
                  <Play className="size-3" />
                  {result.values.length} / {totalRows}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}