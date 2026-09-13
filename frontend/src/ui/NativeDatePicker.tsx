/** Web build: the date/time field uses the browser's own picker, so there is no native picker here. */
export function openNativeDatePicker(_opts: { value: Date; dateOnly: boolean; onPick: (d: Date) => void }): boolean {
  return false;
}
export function NativeDatePickerHost() {
  return null;
}
