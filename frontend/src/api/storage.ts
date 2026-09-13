// Token persistence: hardware-backed encrypted storage on iOS and Android
// (Keychain / Keystore via expo-secure-store), AsyncStorage on web where
// SecureStore does not exist. Each token is stored under its own key
// because SecureStore caps a single value at 2 KB and a JWT pair can
// exceed that.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const native = Platform.OS !== "web";

export async function getItem(key: string): Promise<string | null> {
  return native ? SecureStore.getItemAsync(key) : AsyncStorage.getItem(key);
}

export async function setItem(key: string, value: string | null): Promise<void> {
  if (value === null) {
    if (native) await SecureStore.deleteItemAsync(key); else await AsyncStorage.removeItem(key);
    return;
  }
  if (native) await SecureStore.setItemAsync(key, value); else await AsyncStorage.setItem(key, value);
}

/** Clean up a value written by an earlier build that used one plain-text key. */
export async function migrateLegacy(oldKey: string): Promise<string | null> {
  const raw = await AsyncStorage.getItem(oldKey);
  if (raw !== null) await AsyncStorage.removeItem(oldKey);
  return raw;
}
