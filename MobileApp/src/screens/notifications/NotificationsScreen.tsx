import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, RefreshControl, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeProvider';
import * as notificationsApi from '../../api/notifications';
import { AppNotification, NotificationType } from '../../types/notification';

const typeColor = (theme: ReturnType<typeof useTheme>, type: NotificationType) => {
  switch (type) {
    case 'ALARM':
      return theme.colors.danger;
    case 'WARNING':
      return theme.colors.warning;
    case 'MAINTENANCE':
      return theme.colors.accent;
    default:
      return theme.colors.textMuted;
  }
};

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function NotificationsScreen() {
  const theme = useTheme();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await notificationsApi.getNotifications();
      setItems(Array.isArray(data) ? data : []);
    } catch {
      setError('Unable to load notifications. Pull down to retry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const handlePress = async (item: AppNotification) => {
    if (item.is_read) return;
    setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, is_read: true } : n)));
    try {
      await notificationsApi.markRead(item.id);
    } catch {
      // Revert on failure.
      setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, is_read: false } : n)));
    }
  };

  const handleMarkAllRead = async () => {
    const previous = items;
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    try {
      await notificationsApi.markAllRead();
    } catch {
      setItems(previous);
    }
  };

  const unreadCount = items.filter((n) => !n.is_read).length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }} edges={['top', 'left', 'right']}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: theme.spacing.lg,
          paddingTop: theme.spacing.md,
          paddingBottom: theme.spacing.sm,
        }}
      >
        <Text style={{ fontSize: theme.type.title, fontWeight: theme.weight.bold as any, color: theme.colors.textPrimary }}>
          Notifications
        </Text>
        {unreadCount > 0 && (
          <Pressable onPress={handleMarkAllRead} hitSlop={8}>
            <Text style={{ color: theme.colors.accent, fontSize: theme.type.body, fontWeight: theme.weight.semibold as any }}>
              Mark all read
            </Text>
          </Pressable>
        )}
      </View>

      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: theme.spacing.lg, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.accent} />}
        ItemSeparatorComponent={() => <View style={{ height: theme.spacing.sm }} />}
        ListEmptyComponent={
          !loading ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: theme.spacing.xxxl }}>
              <Ionicons name="notifications-off-outline" size={32} color={theme.colors.textMuted} />
              <Text style={{ color: theme.colors.textSecondary, marginTop: theme.spacing.md, textAlign: 'center' }}>
                {error ?? 'No notifications yet'}
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => handlePress(item)}
            style={{
              flexDirection: 'row',
              backgroundColor: theme.colors.surface,
              borderRadius: theme.radius.lg,
              borderWidth: 1,
              borderColor: theme.colors.border,
              padding: theme.spacing.md,
              gap: theme.spacing.md,
            }}
          >
            <View
              style={{
                width: 4,
                borderRadius: 2,
                backgroundColor: typeColor(theme, item.type),
              }}
            />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text
                  style={{
                    fontSize: theme.type.body,
                    fontWeight: (item.is_read ? theme.weight.medium : theme.weight.bold) as any,
                    color: theme.colors.textPrimary,
                    flex: 1,
                  }}
                  numberOfLines={1}
                >
                  {item.title}
                </Text>
                {!item.is_read && (
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: theme.colors.accent,
                      marginLeft: theme.spacing.sm,
                      marginTop: 4,
                    }}
                  />
                )}
              </View>
              <Text style={{ fontSize: theme.type.caption, color: theme.colors.textSecondary, marginTop: 2 }} numberOfLines={2}>
                {item.message}
              </Text>
              <Text style={{ fontSize: theme.type.caption, color: theme.colors.textMuted, marginTop: theme.spacing.xs }}>
                {timeAgo(item.created_at)}
              </Text>
            </View>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}
