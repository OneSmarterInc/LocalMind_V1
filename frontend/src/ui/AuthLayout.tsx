import React from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BookArt, Eyebrow, colors } from "./index";
import { Brand } from "./Shell";

/** The two-column sign-in layout: a calm story panel and the form. */
export function AuthLayout({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flex: 1, flexDirection: wide ? "row" : "column" }}>
        {wide ? (
          <View style={{ width: "50%", backgroundColor: "#E8EEE2", paddingVertical: 45, paddingHorizontal: "4.5%", justifyContent: "space-between", overflow: "hidden" }}>
            <Brand />
            <View>
              <Eyebrow>A CLEARER WAY TO LEARN</Eyebrow>
              <Text style={{ fontSize: 46, lineHeight: 52, letterSpacing: -1.8, fontWeight: "600", color: colors.ink, maxWidth: 460, marginTop: 22 }}>Your learning.{"\n"}Your teaching.{"\n"}One simple place.</Text>
              <Text style={{ fontSize: 15, lineHeight: 27, color: colors.text, maxWidth: 390, marginTop: 23 }}>From the first chapter to the next achievement. Everything you need, thoughtfully organized.</Text>
              <View style={{ marginTop: 28 }}><BookArt /></View>
            </View>
            <Text style={{ fontSize: 11, color: "#62775E" }}>LocalMind · A little more knowledge, every day.</Text>
          </View>
        ) : null}
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={wide ? { width: "50%" } : { flex: 1 }}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingVertical: 40, paddingHorizontal: wide ? "11%" : 22 }} keyboardShouldPersistTaps="handled">
            <View style={{ width: "100%", maxWidth: 480, alignSelf: "center", gap: 14 }}>
              {!wide ? <View style={{ marginBottom: 18 }}><Brand /></View> : null}
              {children}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </SafeAreaView>
  );
}
