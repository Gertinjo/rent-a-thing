import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Image, Pressable, RefreshControl, Text, View } from 'react-native';

import { api, AppNotification, ChatThread, mediaUrl } from '../api';
import { Avatar, Empty, NavHeader } from '../components/ui';
import type { ScreenProps } from '../navigation';
import { useRealtime } from '../realtime';
import { makeStyles, statusStyle, useTheme } from '../theme';

export const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

const KIND_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  message: 'chatbubble-ellipses',
  booking_request: 'calendar',
  booking_accepted: 'checkmark-circle',
  booking_declined: 'close-circle',
  booking_cancelled: 'close-circle',
  booking_completed: 'flag',
  review: 'star',
  club_joined: 'ribbon',
  id_verified: 'shield-checkmark',
  id_rejected: 'alert-circle',
};

/* ------------------------------------------------------------------ Messages */

export function MessagesScreen({ navigation }: ScreenProps<'Messages'>) {
  const { c } = useTheme();
  const s = useStyles();
  const rt = useRealtime();
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setThreads(await api.chats());
    } catch {
      /* offline: keep what we have */
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => void load(), [load]));
  const { on } = rt;
  useEffect(() => on('message', () => load()), [on, load]);

  return (
    <View style={s.screen}>
      <NavHeader title="Messages" onBack={() => navigation.goBack()} />
      <FlatList
        data={threads}
        keyExtractor={(t) => String(t.booking_id)}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.text2} />}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 10 }}
        ListEmptyComponent={
          loading ? undefined : (
            <Empty icon="chatbubbles-outline" title="No conversations yet" text="When you request a booking, or someone asks for one of your things, you can chat here." />
          )
        }
        renderItem={({ item: t }) => {
          const st = statusStyle(t.status, c);
          const last = t.last_message;
          const preview = last ? `${last.sender_id === t.other.id ? '' : 'You: '}${last.body}` : 'No messages yet. Say hi!';
          return (
            <Pressable onPress={() => navigation.navigate('Chat', { bookingId: t.booking_id })}>
              {({ pressed }) => (
                <View style={[s.row, pressed && { opacity: 0.8 }]}>
                  <View>
                    <Avatar name={t.other.name} url={t.other.avatar_url} size={50} />
                    <Image source={{ uri: mediaUrl(t.item.cover_url) }} style={s.itemThumb} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={s.name} numberOfLines={1}>
                        {t.other.name}
                      </Text>
                      <Text style={s.when}>{ago(t.activity)}</Text>
                    </View>
                    <Text style={s.item} numberOfLines={1}>
                      <Text style={{ color: st.color, fontWeight: '700' }}>{st.label}</Text> · {t.item.title}
                    </Text>
                    <Text style={[s.preview, t.unread > 0 && { color: c.text, fontWeight: '600' }]} numberOfLines={1}>
                      {preview}
                    </Text>
                  </View>
                  {t.unread > 0 && (
                    <View style={s.badge}>
                      <Text style={s.badgeText}>{t.unread > 9 ? '9+' : t.unread}</Text>
                    </View>
                  )}
                </View>
              )}
            </Pressable>
          );
        }}
      />
    </View>
  );
}

/* ------------------------------------------------------------- Notifications */

export function NotificationsScreen({ navigation }: ScreenProps<'Notifications'>) {
  const { c } = useTheme();
  const s = useStyles();
  const { on, refreshUnread } = useRealtime();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.notifications();
      setItems(r.items);
      if (r.items.some((n) => !n.read)) {
        await api.readNotifications();
        refreshUnread();
      }
    } catch {
      /* keep what we have */
    } finally {
      setLoading(false);
    }
  }, [refreshUnread]);

  useFocusEffect(useCallback(() => void load(), [load]));
  useEffect(() => on('notification', (n: AppNotification) => setItems((prev) => [n, ...prev.filter((x) => x.id !== n.id)])), [on]);

  const open = (n: AppNotification) => {
    if (n.kind === 'club_joined') navigation.navigate('Club');
    else if (n.kind.startsWith('id_')) navigation.navigate('VerifyId');
    else if (n.booking_id && n.kind === 'message') navigation.navigate('Chat', { bookingId: n.booking_id });
    else if (n.booking_id) navigation.navigate('Tabs', { screen: 'Bookings' } as never);
    else if (n.item_id) navigation.navigate('ItemDetail', { id: n.item_id });
  };

  return (
    <View style={s.screen}>
      <NavHeader title="Notifications" onBack={() => navigation.goBack()} />
      <FlatList
        data={items}
        keyExtractor={(n) => String(n.id)}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.text2} />}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, gap: 8 }}
        ListEmptyComponent={loading ? undefined : <Empty icon="notifications-outline" title="You’re all caught up" text="Booking requests, replies and messages will show up here." />}
        renderItem={({ item: n }) => (
          <Pressable onPress={() => open(n)}>
            {({ pressed }) => (
              <View style={[s.row, pressed && { opacity: 0.8 }, !n.read && { borderColor: c.accent }]}>
                <View style={[s.icon, { backgroundColor: n.read ? c.fill : c.accentSoft }]}>
                  <Ionicons name={KIND_ICON[n.kind] ?? 'notifications'} size={20} color={n.read ? c.text2 : c.accent} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <Text style={s.name} numberOfLines={1}>
                      {n.title}
                    </Text>
                    <Text style={s.when}>{ago(n.created_at)}</Text>
                  </View>
                  {!!n.body && (
                    <Text style={s.preview} numberOfLines={2}>
                      {n.body}
                    </Text>
                  )}
                </View>
              </View>
            )}
          </Pressable>
        )}
      />
    </View>
  );
}

const useStyles = makeStyles((c, scheme) => ({
  screen: { flex: 1, backgroundColor: c.bg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 20,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: scheme === 'dark' ? 'transparent' : c.separator,
  },
  itemThumb: { position: 'absolute', right: -4, bottom: -4, width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: c.surface, backgroundColor: c.imageBg },
  name: { flex: 1, fontSize: 16, fontWeight: '700', color: c.text },
  when: { fontSize: 13, color: c.text3 },
  item: { fontSize: 13, color: c.text2 },
  preview: { fontSize: 14, color: c.text2, lineHeight: 19 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: c.onAccent, fontSize: 12, fontWeight: '800' },
  icon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
}));
