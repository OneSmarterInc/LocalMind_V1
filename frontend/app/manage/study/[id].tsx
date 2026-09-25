import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback } from "react";
import { Loading, Screen } from "@/ui";

/**
 * Previous bookmarks now lead to simple book sharing, not a block editor.
 * Redirect only while focused: this is a retained tab screen, and an unconditional
 * <Redirect> fired again on every later re-render, stealing navigation from the
 * page the person had moved on to.
 */
export default function OldStudyPublishing() {
  const router = useRouter();
  useFocusEffect(useCallback(() => {
    router.replace("/manage/private-library");
  }, [router]));
  return <Screen><Loading /></Screen>;
}
