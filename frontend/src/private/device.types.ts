import type { Section, SourceVisual } from './core';
import type { ModelSpec } from './modelSpec';
export type LocalFile = { name: string; uri: string; size?: number; file?: File };
export type Parsed = { hash: string; sections: Section[]; warnings: string[]; visuals?: SourceVisual[] };
export type Completion = {system:string;prompt:string;schema:object;maxTokens:number;temperature:number;signal:AbortSignal;progress?:(message:string)=>void};
/** Where the model file lives. browser = the browser's private file storage
 * (on this disk, inside the browser profile); folder = a folder the user
 * chose (Chrome/Edge desktop); app = the installed app's own documents folder. */
export type ModelStorage = {location:'browser'|'folder'|'app';folderName?:string;path?:string;needsPermission?:boolean;
  canChooseFolder:boolean;persistent?:boolean;usedBytes?:number;quotaBytes?:number};
export type ModelStatus = {location?:ModelStorage['location'];needsPermission?:boolean;installed:boolean;name?:string;loaded?:boolean;bytes?:number;hash?:string;threads?:number;accelerator?:'gpu'|'cpu'|'unconfirmed';gpuLayers?:number;accelerationNote?:string};
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
  /** modelId picks one of models(); runtimes without models() have one download. */
  download(progress:(fraction:number)=>void,signal:AbortSignal,modelId?:string):Promise<void>;
  /** Native only: the downloadable models and the one recommended for this device. */
  models?():Promise<{models:ModelSpec[];recommended:string;memoryBytes?:number}>;
  importModel(file:LocalFile,progress:(fraction:number)=>void,signal?:AbortSignal):Promise<void>;
  removeModel():Promise<void>;
  prepareOffline():Promise<string>;
  /** Optional: storage details and choices. Absent on runtimes without them. */
  storage?():Promise<ModelStorage>;
  /** Web only, needs a user click: pick a folder and move the installed model into it. */
  chooseModelFolder?(progress:(fraction:number)=>void,signal?:AbortSignal):Promise<ModelStorage>;
  /** Web only, needs a user click: re-grant access to the chosen folder. */
  grantModelFolder?():Promise<boolean>;
  /** Web only: move the model back into the browser's private storage. */
  useBrowserStorage?(progress:(fraction:number)=>void,signal?:AbortSignal):Promise<ModelStorage>;
}
