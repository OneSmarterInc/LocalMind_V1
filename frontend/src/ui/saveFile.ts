/** Web never calls this: the web build downloads files through the browser. */
export async function saveFileToDevice(_filename: string, _mimeType: string, _content: string, _encoding: "utf8" | "base64" = "utf8"): Promise<boolean> {
  throw new Error("Saving a file this way is only available in the Android app.");
}
