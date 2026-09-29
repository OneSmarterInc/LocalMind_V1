import * as FS from "expo-file-system/legacy";
import { Platform, Share } from "react-native";

/**
 * Saves an export where the person chooses. Returns false when they cancel.
 * Android: the system folder picker (Downloads, Drive, a folder on the phone).
 * iOS: the file is written to the app's cache and handed to the share sheet,
 * which offers Save to Files, AirDrop, Mail and other apps.
 * Used for exports that are too large to share as plain text.
 */
export async function saveFileToDevice(filename: string, mimeType: string, content: string, encoding: "utf8" | "base64" = "utf8"): Promise<boolean> {
  const fsEncoding = encoding === "base64" ? FS.EncodingType.Base64 : FS.EncodingType.UTF8;
  if (Platform.OS === "android") {
    const saf = FS.StorageAccessFramework;
    const permission = await saf.requestDirectoryPermissionsAsync();
    if (!permission.granted) return false;
    const base = filename.replace(/\.[^.]+$/, "");
    const uri = await saf.createFileAsync(permission.directoryUri, base, mimeType);
    await FS.writeAsStringAsync(uri, content, { encoding: fsEncoding });
    return true;
  }
  if (Platform.OS === "ios") {
    if (!FS.cacheDirectory) throw new Error("This device has no cache folder for the export.");
    const safe = filename.replace(/[\\/:*?"<>|]+/g, "-");
    const uri = `${FS.cacheDirectory}${safe}`;
    await FS.writeAsStringAsync(uri, content, { encoding: fsEncoding });
    // Left in the cache (not deleted here): a receiving app such as Mail may still
    // be reading it after the sheet closes, and iOS clears the cache on its own.
    const result = await Share.share({ url: uri, title: safe });
    return result.action === Share.sharedAction;
  }
  throw new Error("Saving a file is available in the Android and iOS apps.");
}
