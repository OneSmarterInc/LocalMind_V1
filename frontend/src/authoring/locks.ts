/** Prevent a source-to-server mapping update from racing a local draft write. */
export const activeBookTransfers=new Set<string>();
