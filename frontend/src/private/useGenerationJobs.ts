import {useSyncExternalStore} from 'react';
import {currentSession} from '@/api/client';
import {generationJobs} from './jobs';
export const jobScope=(prefix:string)=>`${prefix}session:${currentSession()}`;
export function useGenerationJobs(prefix:string){const jobs=useSyncExternalStore(generationJobs.subscribe,generationJobs.snapshot,generationJobs.snapshot);const scope=jobScope(prefix);return jobs.filter(j=>j.scope===scope);}
