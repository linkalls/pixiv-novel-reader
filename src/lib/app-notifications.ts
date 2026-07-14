import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const ENABLED_KEY = 'new-content-notifications-enabled';
const CHANNEL_ID = 'novel-updates';

let configured = false;

export async function configureAppNotifications(): Promise<void> {
  if (!configured) {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    configured = true;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: '小説の新着',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 180, 100, 180],
      lightColor: '#0096FA',
    });
  }
}

export async function isNewContentNotificationEnabled(): Promise<boolean> {
  return (
    (await SecureStore.getItemAsync(ENABLED_KEY).catch(() => null)) === '1'
  );
}

export async function setNewContentNotificationEnabled(
  enabled: boolean,
): Promise<boolean> {
  if (!enabled) {
    await SecureStore.setItemAsync(ENABLED_KEY, '0');
    return false;
  }

  await configureAppNotifications();
  const current = await Notifications.getPermissionsAsync();
  const permission =
    current.granted || current.status === 'granted'
      ? current
      : await Notifications.requestPermissionsAsync();
  const granted = permission.granted || permission.status === 'granted';
  await SecureStore.setItemAsync(ENABLED_KEY, granted ? '1' : '0');
  return granted;
}

export async function notifyNewContent(input: {
  title: string;
  body: string;
  data?: Record<string, string | number | boolean>;
}): Promise<void> {
  if (!(await isNewContentNotificationEnabled())) return;
  await configureAppNotifications();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: input.title,
      body: input.body,
      data: input.data ?? {},
      sound: false,
    },
    trigger: null,
  });
}
