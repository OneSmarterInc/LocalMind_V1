/** Native course downloads use SQLite; queued work remains in its separate durable store. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
export const META={owner:'@owner',me:'@me',lastSync:'@last-sync',version:'@version'};
const GLOBAL=new Set([META.owner,META.me]);let scope:string|null=null;
export function setOfflineScope(userId:string|null){scope=userId;}
export function offlineScope(){return scope;}
const scoped=(key:string,owner=scope)=>GLOBAL.has(key)?key:owner?`u:${owner}:${key}`:null;
let database:Promise<SQLite.SQLiteDatabase>|undefined;
async function db(){if(!database)database=(async()=>{
 const d=await SQLite.openDatabaseAsync('localmind-course-cache.db');
 await d.execAsync('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS entries (key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY NOT NULL,value TEXT NOT NULL)');
 if(!await d.getFirstAsync("SELECT key FROM metadata WHERE key='legacy-migrated'")){
  const keys=(await AsyncStorage.getAllKeys()).filter(k=>k.startsWith('localmind.offline.')),rows=await AsyncStorage.multiGet(keys);
  await d.withExclusiveTransactionAsync(async tx=>{for(const [key,value] of rows)if(value!==null)await tx.runAsync('INSERT OR IGNORE INTO entries VALUES (?,?)',key.slice('localmind.offline.'.length),value);await tx.runAsync("INSERT OR IGNORE INTO metadata VALUES ('legacy-migrated','1')");});
 }
 return d;
})();return database;}
export async function readEntry<T=unknown>(key:string):Promise<T|undefined>{const k=scoped(key);if(!k)return undefined;const row=await(await db()).getFirstAsync<{value:string}>('SELECT value FROM entries WHERE key=?',k);return row?JSON.parse(row.value) as T:undefined;}
export async function writeEntry(key:string,value:unknown,owner:string|null=scope):Promise<void>{if(!GLOBAL.has(key)&&(!owner||owner!==scope))return;const k=scoped(key,owner);const d=await db();if(!GLOBAL.has(key)&&owner!==scope)return;await d.runAsync('INSERT INTO entries VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',k!,JSON.stringify(value));}
export async function replaceEntries(entries:Record<string,unknown>,owner:string){if(owner!==scope)return;const d=await db();await d.withExclusiveTransactionAsync(async tx=>{
 if(owner!==scope)return;const prefix=`u:${owner}:`;await tx.runAsync('DELETE FROM entries WHERE substr(key,1,?)=? AND key NOT IN (?,?)',prefix.length,prefix,prefix+META.lastSync,prefix+META.version);
 for(const [key,value] of Object.entries(entries))await tx.runAsync('INSERT OR REPLACE INTO entries VALUES (?,?)',prefix+key,JSON.stringify(value));
 });}
export async function clearAll(){await(await db()).runAsync('DELETE FROM entries');}
