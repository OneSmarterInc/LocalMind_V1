import type { Section, SourceVisual } from './core';
export type LocalFile = { name: string; uri: string; size?: number; file?: File };
export type Parsed = { hash: string; sections: Section[]; warnings: string[]; visuals?: SourceVisual[] };
export type Completion = {system:string;prompt:string;schema:object;maxTokens:number;temperature:number;signal:AbortSignal;progress?:(message:string)=>void};
export type ModelStatus = {installed:boolean;name?:string;loaded?:boolean;bytes?:number;hash?:string;threads?:number};
export interface Device {
  get<T>(key:string): Promise<T|undefined>;
  put(key:string,value:unknown): Promise<void>;
  list<T>(prefix:string): Promise<T[]>;
  removePrefix(prefix:string): Promise<void>;
  parse(file:LocalFile,signal?:AbortSignal,progress?:(message:string)=>void,saveVisual?:(visual:SourceVisual,hash:string)=>Promise<void>): Promise<Parsed>;
  downloadBook(url:string,headers:Record<string,string>,name:string,signal:AbortSignal): Promise<LocalFile>;
  releaseFile(file:LocalFile): Promise<void>;
  complete(req:Completion): Promise<unknown>;
  status(): Promise<ModelStatus>;
  download(progress:(fraction:number)=>void,signal:AbortSignal):Promise<void>;
  importModel(file:LocalFile,progress:(fraction:number)=>void,signal?:AbortSignal):Promise<void>;
  removeModel():Promise<void>;
  prepareOffline():Promise<string>;
}
