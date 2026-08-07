import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

interface MossDBSchema extends DBSchema {
  settings: {
    key: string;
    value: unknown;
  };
}

const DB_NAME = 'moss-db';
const DB_VERSION = 1;
const SETTINGS_STORE = 'settings';

const memoryCache = new Map<string, unknown>();
let dbPromise: Promise<IDBPDatabase<MossDBSchema>> | null = null;

function getDB(): Promise<IDBPDatabase<MossDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<MossDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
          db.createObjectStore(SETTINGS_STORE);
        }
      },
    });
  }
  return dbPromise;
}

// 异步读取：优先读内存缓存，未命中则读 IndexedDB 并回填缓存
export async function idbGet<T>(key: string): Promise<T | undefined> {
  if (memoryCache.has(key)) {
    return memoryCache.get(key) as T;
  }
  const db = await getDB();
  const value = (await db.get(SETTINGS_STORE, key)) as T | undefined;
  memoryCache.set(key, value);
  return value;
}

// 同步读取：仅读内存缓存（需先经过 idbGet 预填充，例如 main.tsx 启动时）
export function idbGetSync<T>(key: string): T | undefined {
  return memoryCache.get(key) as T | undefined;
}

// 写入：同时更新内存缓存与 IndexedDB
export async function idbSet<T>(key: string, value: T): Promise<void> {
  memoryCache.set(key, value);
  const db = await getDB();
  await db.put(SETTINGS_STORE, value, key);
}

// 删除：同时清理内存缓存与 IndexedDB
export async function idbDel(key: string): Promise<void> {
  memoryCache.delete(key);
  const db = await getDB();
  await db.delete(SETTINGS_STORE, key);
}
