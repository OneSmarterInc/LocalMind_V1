// Type-checking entry point. Metro picks backgroundWork.native.ts in the phone
// app and backgroundWork.web.ts in the browser, as for ./device.
export { backgroundWork, setNotificationExplainer } from './backgroundWork.native';
