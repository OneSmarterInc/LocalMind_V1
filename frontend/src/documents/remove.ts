import {LocalAuthoring} from '@/authoring/local';
import {Library} from '@/private/library';
import {generationJobs} from '@/private/jobs';
import {jobScope} from '@/private/useGenerationJobs';
import { ApiError } from '@/api/client';
import { manage } from '@/api/endpoints';
import { confirmAsync } from '@/ui';

/** Called after the user confirms removal. Protected history must be retained. */
export async function removeBook(id: string, owner: string): Promise<boolean> {
  const service = new LocalAuthoring(owner);
  await stopBookWork(id, owner);
  try {
    await manage.deleteDocument(id);
    await service.markRemoved(id);
    return true;
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'STUDY_HISTORY_IN_USE') throw error;
    const archive = await confirmAsync(
      'Archive this book instead?',
      'This book has saved study versions that must retain their source history. Archiving hides the book from students and the default book list while keeping that history. You can find it using the Archived status filter.',
      'Archive book',
      'Cancel',
    );
    if (!archive) return false;
    await archiveBook(id, owner);
    return true;
  }
}

async function stopBookWork(id:string,owner:string){
 const service=new LocalAuthoring(owner);
 const ids=(await service.drafts()).filter(d=>d.snapshot.document_id===id).map(d=>d.snapshot.module_id);
 await generationJobs.cancelDocument(jobScope(new Library(owner).prefix),id,ids);
}
export async function archiveBook(id:string,owner:string){
 await stopBookWork(id,owner);
 await manage.transition(id,'archive');
 await new LocalAuthoring(owner).markRemoved(id);
}
