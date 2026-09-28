import * as FS from "expo-file-system/legacy";
import { Platform } from "react-native";

/**
 * Saves a file where the person chooses (Downloads, Drive, a folder on the
 * phone) using Android's folder picker. Returns false when they cancel.
 * Used for exports that are too large for the share sheet.
 */
export async function saveFileToDevice(filename: string, mimeType: string, content: string, encoding: "utf8" | "base64" = "utf8"): Promise<boolean> {
  if (Platform.OS !== "android") throw new Error("Saving a file is available on Android.");
  const saf = FS.StorageAccessFramework;
  const permission = await saf.requestDirectoryPermissionsAsync();
  if (!permission.granted) return false;
  const base = filename.replace(/\.[^.]+$/, "");
  const uri = await saf.createFileAsync(permission.directoryUri, base, mimeType);
  await FS.writeAsStringAsync(uri, content, { encoding: encoding === "base64" ? FS.EncodingType.Base64 : FS.EncodingType.UTF8 });
  return true;
}
