/**
 * Small cross-platform helpers so the same app runs on iOS, Android and in a phone browser.
 */
import * as SecureStore from 'expo-secure-store';
import { Alert as NativeAlert, AlertButton, Platform } from 'react-native';

export const isWeb = Platform.OS === 'web';

// ---------- alerts ----------
// React Native's Alert does nothing in a browser, so on web we fall back to the browser's own dialogs.
export const Alert = {
  alert(title: string, message?: string, buttons?: AlertButton[]) {
    if (!isWeb) return NativeAlert.alert(title, message, buttons);
    const text = message ? `${title}\n\n${message}` : title;
    const action = buttons?.find((b) => b.style !== 'cancel');
    if (buttons && buttons.length > 1 && action) {
      if (window.confirm(text)) action.onPress?.();
      else buttons.find((b) => b.style === 'cancel')?.onPress?.();
      return;
    }
    window.alert(text);
    action?.onPress?.();
  },
};

// ---------- key/value storage for the login token ----------
export const storage = {
  async get(key: string): Promise<string | null> {
    if (isWeb) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    }
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string) {
    if (isWeb) {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        /* private mode: stay logged in for this tab only */
      }
      return;
    }
    await SecureStore.setItemAsync(key, value);
  },
  async remove(key: string) {
    if (isWeb) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
      return;
    }
    await SecureStore.deleteItemAsync(key);
  },
};
