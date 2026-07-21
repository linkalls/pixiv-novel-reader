import * as BackgroundTask from 'expo-background-task';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';

import { processOfflineDownloadQueue } from './offline-download-queue';
import { syncOfflineSeriesSubscriptions } from './offline-series-subscriptions';
import { connectPixiv, disconnectPixiv } from './pixiv';

const BACKGROUND_SYNC_TASK = 'pixiv-novel-reader-background-sync';
const REFRESH_TOKEN_KEY = 'pixiv-refresh-token';
const MINIMUM_INTERVAL_MINUTES = 15;

TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  try {
    const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
    if (!refreshToken) {
      return BackgroundTask.BackgroundTaskResult.Success;
    }

    await connectPixiv(refreshToken);
    await syncOfflineSeriesSubscriptions();
    await processOfflineDownloadQueue();
    disconnectPixiv();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    disconnectPixiv();
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackgroundSync(): Promise<void> {
  const status = await BackgroundTask.getStatusAsync();
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;

  const isRegistered = await TaskManager.isTaskRegisteredAsync(
    BACKGROUND_SYNC_TASK,
  );
  if (isRegistered) return;

  await BackgroundTask.registerTaskAsync(BACKGROUND_SYNC_TASK, {
    minimumInterval: MINIMUM_INTERVAL_MINUTES,
  });
}

export async function unregisterBackgroundSync(): Promise<void> {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(
    BACKGROUND_SYNC_TASK,
  );
  if (isRegistered) {
    await BackgroundTask.unregisterTaskAsync(BACKGROUND_SYNC_TASK);
  }
}
