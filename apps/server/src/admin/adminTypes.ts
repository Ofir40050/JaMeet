export interface AdminRuntimeContext {
  getOnlineUserIds?: () => Set<string>;
  isUserOnline?: (userId: string) => boolean;
  getActiveRoomsCount?: () => number;
  getUptimeSeconds?: () => number;
}
