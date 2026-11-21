import { Ionicons } from '@expo/vector-icons';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { io, Socket } from 'socket.io-client';

import { API_URL, api, AppNotification, ChatMessage, ClubMessage, getToken, Unread } from './api';
import { useAuth } from './auth';
import { Glass } from './components/ui';
import { navigationRef } from './navigation';
import { type, useTheme } from './theme';

type Handler = (data: any) => void;

interface Realtime {
  connected: boolean;
  unread: Unread;
  /** Listen to a server event ('message' | 'typing' | 'read' | 'notification'); returns an unsubscribe. */
  on: (event: string, handler: Handler) => () => void;
  sendMessage: (bookingId: number, body: string) => Promise<ChatMessage>;
  typing: (bookingId: number) => void;
  markRead: (bookingId: number) => void;
  /** The chat currently on screen (no pop-up banner for it). */
  setActiveChat: (bookingId: number | null) => void;
  refreshUnread: () => void;
  /** Rent Club group chat */
  clubSend: (body: string) => Promise<ClubMessage>;
  clubJoin: () => void;
  clubRead: () => void;
  /** true while the club chat is on screen (no badge bump for new messages) */
  setClubOpen: (open: boolean) => void;
}

const Ctx = createContext<Realtime>(null as unknown as Realtime);
export const useRealtime = () => useContext(Ctx);

/**
 * One Socket.IO connection per logged-in user (path /ws/socket.io, JWT in the handshake).
 * Falls back to plain HTTP for sending when the socket isn't connected.
 */
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const listeners = useRef(new Map<string, Set<Handler>>());
  const activeChat = useRef<number | null>(null);
  const clubOpen = useRef(false);
  const [connected, setConnected] = useState(false);
  const [unread, setUnread] = useState<Unread>({ messages: 0, notifications: 0, club: 0 });
  const [toast, setToast] = useState<AppNotification | null>(null);

  const dispatch = (event: string, data: unknown) => listeners.current.get(event)?.forEach((h) => h(data));

  useEffect(() => {
    const token = getToken();
    if (!user || !token) return;
    const socket = io(API_URL, {
      path: '/ws/socket.io',
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
    });
    socketRef.current = socket;
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('unread', (u: Unread) =>
      setUnread((prev) => (prev.messages === u.messages && prev.notifications === u.notifications && prev.club === u.club ? prev : u)),
    );
    socket.on('club_message', (d: { message: ClubMessage }) => {
      dispatch('club_message', d.message);
      if (d.message.sender.id !== user.id && !clubOpen.current) setUnread((prev) => ({ ...prev, club: (prev.club ?? 0) + 1 }));
    });
    for (const ev of ['message', 'typing', 'read']) socket.on(ev, (d) => dispatch(ev, d));
    socket.on('notification', ({ notification }: { notification: AppNotification }) => {
      dispatch('notification', notification);
      const sameChat = notification.kind === 'message' && notification.booking_id === activeChat.current;
      if (!sameChat) setToast(notification);
    });
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [user?.id]);

  const on = useCallback((event: string, handler: Handler) => {
    if (!listeners.current.has(event)) listeners.current.set(event, new Set());
    listeners.current.get(event)!.add(handler);
    return () => listeners.current.get(event)?.delete(handler);
  }, []);

  const sendMessage = useCallback(async (bookingId: number, body: string): Promise<ChatMessage> => {
    const socket = socketRef.current;
    if (socket?.connected) {
      const ack: { ok: boolean; message?: ChatMessage; error?: string } = await socket.timeout(10000).emitWithAck('send_message', { booking_id: bookingId, body });
      if (!ack.ok) throw new Error(ack.error || 'Couldn’t send');
      return ack.message!;
    }
    return api.sendMessage(bookingId, body); // HTTP fallback (also triggers the live events server-side)
  }, []);

  const typing = useCallback((bookingId: number) => socketRef.current?.emit('typing', { booking_id: bookingId }), []);

  const markRead = useCallback((bookingId: number) => {
    const socket = socketRef.current;
    if (socket?.connected) socket.emit('read', { booking_id: bookingId });
    else api.markRead(bookingId).then((r) => setUnread({ messages: r.messages, notifications: r.notifications })).catch(() => {});
  }, []);

  const refreshUnread = useCallback(() => {
    api.unread().then(setUnread).catch(() => {});
  }, []);

  const setActiveChat = useCallback((id: number | null) => {
    activeChat.current = id;
  }, []);

  const clubSend = useCallback(async (body: string): Promise<ClubMessage> => {
    const socket = socketRef.current;
    if (socket?.connected) {
      const ack: { ok: boolean; message?: ClubMessage; error?: string } = await socket.timeout(10000).emitWithAck('club_send', { body });
      if (!ack.ok) throw new Error(ack.error || 'Couldn’t send');
      return ack.message!;
    }
    return api.clubSend(body);
  }, []);
  const clubJoin = useCallback(() => {
    socketRef.current?.emit('club_join', {});
  }, []);
  const clubRead = useCallback(() => {
    setUnread((prev) => (prev.club ? { ...prev, club: 0 } : prev));
    const socket = socketRef.current;
    if (socket?.connected) socket.emit('club_read', {});
    else api.clubRead().catch(() => {});
  }, []);
  const setClubOpen = useCallback((open: boolean) => {
    clubOpen.current = open;
  }, []);

  const value = useMemo(
    () => ({ connected, unread, on, sendMessage, typing, markRead, setActiveChat, refreshUnread, clubSend, clubJoin, clubRead, setClubOpen }),
    [connected, unread, on, sendMessage, typing, markRead, setActiveChat, refreshUnread, clubSend, clubJoin, clubRead, setClubOpen],
  );
  const hideToast = useCallback(() => setToast(null), []);
  return (
    <Ctx.Provider value={value}>
      {children}
      <LiveToast notification={toast} onDone={hideToast} />
    </Ctx.Provider>
  );
}

const KIND_ICON: Record<string, string> = {
  message: 'chatbubble-ellipses',
  booking_request: 'calendar',
  booking_accepted: 'checkmark-circle',
  booking_declined: 'close-circle',
  booking_cancelled: 'close-circle',
  booking_completed: 'flag',
  review: 'star',
  club_joined: 'ribbon',
  payment_received: 'card',
  payment_refunded: 'return-up-back',
  id_verified: 'shield-checkmark',
  id_rejected: 'alert-circle',
};

/** Glass banner that slides in from the top for ~4 seconds. Tap to open the chat / booking. */
function LiveToast({ notification, onDone }: { notification: AppNotification | null; onDone: () => void }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const y = useRef(new Animated.Value(-160)).current;
  const [shown, setShown] = useState<AppNotification | null>(null);

  useEffect(() => {
    if (!notification) return;
    setShown(notification);
    y.setValue(-160);
    Animated.spring(y, { toValue: 0, useNativeDriver: true, speed: 14, bounciness: 6 }).start();
    const t = setTimeout(() => Animated.timing(y, { toValue: -160, duration: 250, useNativeDriver: true }).start(() => onDone()), 4200);
    return () => clearTimeout(t);
  }, [notification, y, onDone]);

  if (!shown) return null;
  const open = () => {
    Animated.timing(y, { toValue: -160, duration: 180, useNativeDriver: true }).start(() => onDone());
    if (!navigationRef.isReady()) return;
    if (shown.kind === 'club_joined') navigationRef.navigate('Club');
    else if (shown.kind.startsWith('id_')) navigationRef.navigate('VerifyId');
    else if (shown.booking_id) navigationRef.navigate('Chat', { bookingId: shown.booking_id });
    else navigationRef.navigate('Notifications');
  };

  return (
    <Animated.View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + 8, left: 12, right: 12, transform: [{ translateY: y }], zIndex: 1000 }}>
      <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`${shown.title}. ${shown.body}`}>
        <Glass radius={22} intensity={60}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }}>
            <View style={{ width: 40, height: 40, borderRadius: 14, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name={(KIND_ICON[shown.kind] ?? 'notifications') as any} size={20} color={c.onAccent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ ...type.headline, fontSize: 15, color: c.text }} numberOfLines={1}>
                {shown.title}
              </Text>
              {!!shown.body && (
                <Text style={{ ...type.subhead, color: c.text2 }} numberOfLines={2}>
                  {shown.body}
                </Text>
              )}
            </View>
            <Ionicons name="chevron-forward" size={18} color={c.text3} />
          </View>
        </Glass>
      </Pressable>
    </Animated.View>
  );
}
