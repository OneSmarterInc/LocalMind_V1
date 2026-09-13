import { Redirect } from 'expo-router';
/** Previous bookmarks now lead to simple book sharing, not a block editor. */
export default function OldStudyPublishing() { return <Redirect href="/manage/private-library" />; }
