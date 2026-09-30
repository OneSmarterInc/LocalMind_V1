import React, { useRef, useState } from "react";
import { Platform, Pressable, ScrollView, Text, View, ViewStyle, useWindowDimensions } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
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
/** Room kept under the last message for the "Latest" button, which floats
 *  over the bottom of the thread. Without it the button covered the end of
 *  the newest answer and its "From the book" line. */
const LATEST_ROOM = 44;

export default function ChatThread({ children, empty }: { children: React.ReactNode; empty?: React.ReactNode }) {
  const scroller = useRef<ScrollView>(null);
  const { height, width } = useWindowDimensions();
  // Tall enough to hold a couple of exchanges, never so tall that the input is
  // pushed off a laptop screen or a phone. On a phone 45% held about one
  // answer, so a student scrolled the page and the thread in turn to read it;
  // a narrow screen now gives the thread more of its height.
  const maxHeight = width < 600
    ? Math.max(240, Math.min(560, Math.round(height * 0.58)))
    : Math.max(200, Math.min(440, Math.round(height * 0.45)));
  const count = React.Children.count(children);
  // Follow new turns only while the reader is at the bottom; someone who
  // scrolled up to reread an answer is not yanked away, and gets a button back.
  const atEnd = useRef(true);
  const lastCount = useRef(count);
  const [away, setAway] = useState(false);
  // Until when the thread is scrolling ITSELF to the newest message. The
  // scroll events of that animation report positions short of the end, and
  // the one at the end can be dropped by the event throttle, so judging by
  // them left "Latest" showing while the reader was already at the bottom.
  // It is a deadline rather than a flag because a mouse wheel on the laptop
  // sends no drag events that could switch a flag off again.
  const following = useRef(0);
  if (!count) return <>{empty}</>;
  const toEnd = (animated = true) => { following.current = Date.now() + 800; scroller.current?.scrollToEnd({ animated }); atEnd.current = true; setAway(false); };
  // Where the reader really is, once scrolling has come to rest.
  const settle = (e: { nativeEvent: { contentOffset: { y: number }; layoutMeasurement: { height: number }; contentSize: { height: number } } }) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    const end = contentOffset.y + layoutMeasurement.height >= contentSize.height - 24;
    following.current = 0; atEnd.current = end; setAway(!end);
  };
  // A visible scrollbar: Android keeps it on screen (it normally fades out),
  // and the web build reserves a track so the thread visibly scrolls.
  const webScroll = (Platform.OS === "web" ? { overflowY: "scroll", scrollbarWidth: "thin", scrollbarColor: "#9DB39A transparent" } : {}) as ViewStyle;
  return (
    <View style={{ maxHeight, borderRadius: 10, backgroundColor: colors.bg, borderWidth: 1, borderColor: "#E4EAE2", overflow: "hidden" }}>
      <ScrollView ref={scroller} style={[{ maxHeight }, webScroll]} nestedScrollEnabled contentContainerStyle={{ padding: 10, paddingRight: 14, paddingBottom: LATEST_ROOM, gap: 10 }}
                  persistentScrollbar showsVerticalScrollIndicator indicatorStyle="black" scrollEventThrottle={64}
                  accessibilityLabel="Conversation"
                  onScroll={(e) => {
                    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
                    const end = contentOffset.y + layoutMeasurement.height >= contentSize.height - 24;
                    if (Date.now() < following.current) { if (end) following.current = 0; return; }
                    atEnd.current = end;
                    if (end === away) setAway(!end);
                  }}
                  onScrollBeginDrag={() => { following.current = 0; }}
                  onScrollEndDrag={settle}
                  onMomentumScrollEnd={settle}
                  onContentSizeChange={() => {
                    const grew = count > lastCount.current; lastCount.current = count;
                    if (grew || atEnd.current) toEnd(true); else setAway(true);
                  }}>
        {children}
      </ScrollView>
      {away ? (
        <Pressable onPress={() => toEnd(true)} accessibilityRole="button" accessibilityLabel="Jump to the latest message" hitSlop={8}
          style={{ position: "absolute", right: 12, bottom: 10, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 11, paddingVertical: 6,
            borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: "#D5DED2" }}>
          <Ionicons name="arrow-down" size={14} color={colors.primary} />
          <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }}>Latest</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
