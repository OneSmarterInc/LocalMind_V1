import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import React, { useEffect, useState } from "react";
import { Modal, Platform, Pressable, Text, View } from "react-native";
import { colors } from "./theme";

type Request = { value: Date; dateOnly: boolean; onPick: (d: Date) => void };
let show: ((r: Request) => void) | null = null;

/**
 * Opens the phone's own date (and time) picker. Android: the system dialogs, date then time.
 * iOS: an inline picker in a sheet with Done. Returns true when a picker was opened.
 */
export function openNativeDatePicker(req: Request): boolean {
  if (Platform.OS === "android") {
    DateTimePickerAndroid.open({
      value: req.value, mode: "date",
      onChange: (e: DateTimePickerEvent, date?: Date) => {
        if (e.type !== "set" || !date) return;
        if (req.dateOnly) { req.onPick(date); return; }
        DateTimePickerAndroid.open({
          value: date, mode: "time",
          onChange: (e2: DateTimePickerEvent, time?: Date) => {
            if (e2.type !== "set" || !time) return;
            const d = new Date(date); d.setHours(time.getHours(), time.getMinutes(), 0, 0); req.onPick(d);
          },
        });
      },
    });
    return true;
  }
  if (show) { show(req); return true; }
  return false;
}

/** Mounted once near the app root on iOS so the picker sheet can open from anywhere. */
export function NativeDatePickerHost() {
  const [req, setReq] = useState<Request | null>(null);
  const [value, setValue] = useState(new Date());
  useEffect(() => { show = (r) => { setValue(r.value); setReq(r); }; return () => { show = null; }; }, []);
  if (Platform.OS !== "ios") return null;
  return (
    <Modal visible={!!req} transparent animationType="slide" onRequestClose={() => setReq(null)}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(22,40,30,0.35)" }} onPress={() => setReq(null)} accessibilityLabel="Close date picker" />
      <View style={{ backgroundColor: "#FFFFFF", paddingBottom: 30, paddingTop: 10, borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
        <View style={{ flexDirection: "row", justifyContent: "flex-end", paddingHorizontal: 16 }}>
          <Pressable onPress={() => { req?.onPick(value); setReq(null); }} accessibilityRole="button" hitSlop={8}>
            <Text style={{ fontSize: 16, fontWeight: "600", color: colors.primary }}>Done</Text>
          </Pressable>
        </View>
        {req ? <DateTimePicker value={value} mode={req.dateOnly ? "date" : "datetime"} display="inline" onChange={(_e, d) => { if (d) setValue(d); }} /> : null}
      </View>
    </Modal>
  );
}
