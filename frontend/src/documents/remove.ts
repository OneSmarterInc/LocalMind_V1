import { ApiError } from '@/api/client';
import { manage } from '@/api/endpoints';
import { confirmAsync } from '@/ui';

/** Called after the user confirms removal. Protected history must be retained. */
export async function removeBook(id: string): Promise<boolean> {
  try {
    await manage.deleteDocument(id);
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
    await manage.transition(id, 'archive');
    return true;
  }
}
