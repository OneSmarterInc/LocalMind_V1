import React, { useRef } from "react";
import { ScrollView, View, useWindowDimensions } from "react-native";
import { colors } from "@/ui";

/** The message list of an "Ask a doubt" thread.
 *
 * The turns used to be laid out straight into the page, so every answer pushed
 * the question box further down and a student had to scroll to the bottom of a
 * growing page to type the next one. The thread now scrolls inside its own
 * pane, capped at part of the window height, with whatever the caller renders
 * after it — the input and its buttons — staying put underneath.
 *
 * ``onContentSizeChange`` is what keeps the newest turn visible: it fires after
 * layout, when the new message's height is actually known, which a scroll from
 * an effect on the message array would not be.
 */
export default function ChatThread({ children, empty }: { children: React.ReactNode; empty?: React.ReactNode }) {
  const scroller = useRef<ScrollView>(null);
  const { height } = useWindowDimensions();
  // Tall enough to hold a couple of exchanges, never so tall that the input is
  // pushed off a laptop screen or a phone.
  const maxHeight = Math.max(200, Math.min(440, Math.round(height * 0.45)));
  const count = React.Children.count(children);
  if (!count) return <>{empty}</>;
  return (
    <View style={{ maxHeight, borderRadius: 10, backgroundColor: colors.bg, borderWidth: 1, borderColor: "#E4EAE2" }}>
      <ScrollView ref={scroller} style={{ maxHeight }} contentContainerStyle={{ padding: 10, gap: 10 }}
                  onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
                  showsVerticalScrollIndicator>
        {children}
      </ScrollView>
    </View>
  );
}
