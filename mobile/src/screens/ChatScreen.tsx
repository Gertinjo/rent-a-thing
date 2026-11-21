import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, ChatMessage, ChatThread, mediaUrl } from '../api';
import { useAuth } from '../auth';
import { Avatar, GlassIconButton } from '../components/ui';
import type { ScreenProps } from '../navigation';
import { Alert } from '../platform';
import { useRealtime } from '../realtime';
import { fmtDate, fmtRange, makeStyles, statusStyle, type, useTheme } from '../theme';

const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const dayKey = (iso: string) => new Date(iso).toDateString();
const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(Date.now() - 86400000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return fmtDate(iso.slice(0, 10));
};

const QUICK = {
  renter: ['Hi! Is it still available on these dates?', 'When can I pick it up?', 'Does it come with everything in the photos?'],
  owner: ['Hi! Thanks for your request.', 'Pick-up works any evening after 6pm.', 'I’ll share the exact address once it’s confirmed.'],
};

type Row = { kind: 'msg'; m: ChatMessage } | { kind: 'day'; key: string; label: string };

export default function ChatScreen({ route, navigation }: ScreenProps<'Chat'>) {
  const { bookingId } = route.params;
  const { user } = useAuth();
  const { c } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const rt = useRealtime();
  const { on, markRead, setActiveChat } = rt;
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [otherTyping, setOtherTyping] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(0);

  const load = useCallback(async () => {
    try {
      const [threads, msgs] = await Promise.all([api.chats(), api.messages(bookingId)]);
      setThread(threads.find((t) => t.booking_id === bookingId) ?? null);
      setMessages(msgs);
      markRead(bookingId);
    } catch (e: any) {
      Alert.alert('Couldn’t open the chat', e.message);
    } finally {
      setLoading(false);
    }
  }, [bookingId, markRead]);

  useEffect(() => {
    load();
  }, [load]);

  // This chat is on screen: no banner for it, and incoming messages are marked read.
  useFocusEffect(
    useCallback(() => {
      setActiveChat(bookingId);
      return () => setActiveChat(null);
    }, [bookingId, setActiveChat]),
  );

  useEffect(() => {
    const offMsg = on('message', ({ booking_id, message }: { booking_id: number; message: ChatMessage }) => {
      if (booking_id !== bookingId) return;
      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
      if (message.sender_id !== user?.id) {
        setOtherTyping(false);
        markRead(bookingId);
      }
    });
    const offTyping = on('typing', ({ booking_id }: { booking_id: number }) => {
      if (booking_id !== bookingId) return;
      setOtherTyping(true);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setOtherTyping(false), 3500);
    });
    const offRead = on('read', ({ booking_id }: { booking_id: number }) => {
      if (booking_id !== bookingId) return;
      const now = new Date().toISOString();
      setMessages((prev) => prev.map((m) => (m.sender_id === user?.id && !m.read_at ? { ...m, read_at: now } : m)));
    });
    return () => {
      offMsg();
      offTyping();
      offRead();
    };
  }, [bookingId, on, markRead, user?.id]);

  const closed = thread?.status === 'declined' || thread?.status === 'cancelled';

  const send = async (body = text) => {
    const clean = body.trim();
    if (!clean || sending) return;
    setSending(true);
    try {
      const m = await rt.sendMessage(bookingId, clean);
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      setText('');
    } catch (e: any) {
      Alert.alert('Message not sent', e.message);
    } finally {
      setSending(false);
    }
  };

  const onType = (v: string) => {
    setText(v);
    if (Date.now() - lastTypingSent.current > 2000) {
      lastTypingSent.current = Date.now();
      rt.typing(bookingId);
    }
  };

  // newest first for the inverted list, with day separators
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    messages.forEach((m, i) => {
      if (i === 0 || dayKey(messages[i - 1].created_at) !== dayKey(m.created_at)) out.push({ kind: 'day', key: `d${m.id}`, label: dayLabel(m.created_at) });
      out.push({ kind: 'msg', m });
    });
    return out.reverse();
  }, [messages]);
  const lastMine = [...messages].reverse().find((m) => m.sender_id === user?.id);
  const st = thread ? statusStyle(thread.status, c) : null;
  const first = thread?.other.name.split(' ')[0] ?? '';

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* ---------- header ---------- */}
      <View style={[s.header, { paddingTop: insets.top + 6 }]}>
        <GlassIconButton icon="chevron-back" label="Back" onPress={() => navigation.goBack()} />
        {thread && (
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Avatar name={thread.other.name} url={thread.other.avatar_url} size={38} />
            <View style={{ flex: 1 }}>
              <Text style={s.name} numberOfLines={1}>
                {thread.other.name}
              </Text>
              <Text style={[s.sub, otherTyping && { color: c.accent }]} numberOfLines={1}>
                {otherTyping ? 'typing…' : rt.connected ? (thread.role === 'owner' ? 'Wants to borrow your item' : 'Owner') : 'Connecting…'}
              </Text>
            </View>
          </View>
        )}
      </View>

      {/* ---------- booking strip ---------- */}
      {thread && (
        <Pressable style={s.strip} onPress={() => navigation.navigate('ItemDetail', { id: thread.item.id })}>
          <Image source={{ uri: mediaUrl(thread.item.cover_url) }} style={s.stripImg} />
          <View style={{ flex: 1 }}>
            <Text style={s.stripTitle} numberOfLines={1}>
              {thread.item.title}
            </Text>
            <Text style={s.sub}>{fmtRange(thread.start_date, thread.end_date)}</Text>
          </View>
          {st && (
            <View style={[s.statusPill, { backgroundColor: st.color + '1F' }]}>
              <Text style={{ color: st.color, fontWeight: '800', fontSize: 12 }}>{st.label}</Text>
            </View>
          )}
        </Pressable>
      )}

      {/* ---------- messages ---------- */}
      {loading ? (
        <ActivityIndicator style={{ flex: 1 }} color={c.text2} />
      ) : (
        <FlatList
          inverted
          data={rows}
          keyExtractor={(r) => (r.kind === 'msg' ? `m${r.m.id}` : r.key)}
          contentContainerStyle={{ padding: 14, gap: 6, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          ListFooterComponent={
            <View style={s.safety}>
              <Ionicons name="shield-checkmark-outline" size={16} color={c.text2} />
              <Text style={s.safetyText}>Keep payments and personal details in Rent a Thing. We’ll never ask for your password.</Text>
            </View>
          }
          ListEmptyComponent={
            <View style={{ alignItems: 'center', gap: 8, paddingVertical: 30 }}>
              <Ionicons name="chatbubbles-outline" size={40} color={c.text3} />
              <Text style={[s.sub, { textAlign: 'center' }]}>Say hi to {first} — agree on pick-up time and anything you need to know.</Text>
            </View>
          }
          renderItem={({ item: r }) => {
            if (r.kind === 'day') return <Text style={s.day}>{r.label}</Text>;
            const mine = r.m.sender_id === user?.id;
            return (
              <View style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
                <View style={[s.bubble, mine ? s.mine : s.theirs]}>
                  <Text style={[s.msg, mine && { color: c.onAccent }]}>{r.m.body}</Text>
                  <Text style={[s.time, mine && { color: c.onAccent, opacity: 0.75 }]}>{time(r.m.created_at)}</Text>
                </View>
                {mine && lastMine?.id === r.m.id && (
                  <Text style={s.seen}>{r.m.read_at ? 'Seen' : 'Sent'}</Text>
                )}
              </View>
            );
          }}
        />
      )}

      {/* ---------- composer ---------- */}
      {closed ? (
        <View style={[s.closed, { paddingBottom: insets.bottom + 12 }]}>
          <Text style={s.sub}>This booking was {thread?.status}, so the chat is closed.</Text>
        </View>
      ) : (
        <View style={{ paddingBottom: insets.bottom + 8, backgroundColor: c.bg }}>
          {messages.length === 0 && thread && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.quickRow} keyboardShouldPersistTaps="handled">
              {QUICK[thread.role].map((q) => (
                <Pressable key={q} onPress={() => send(q)} style={s.quick}>
                  <Text style={s.quickText}>{q}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
          <View style={s.composer}>
            <TextInput
              value={text}
              onChangeText={onType}
              placeholder={`Message ${first}`}
              placeholderTextColor={c.text3}
              selectionColor={c.accent}
              multiline
              maxLength={2000}
              style={s.input}
              onSubmitEditing={() => send()}
              blurOnSubmit={false}
            />
            <Pressable
              onPress={() => send()}
              disabled={!text.trim() || sending}
              style={[s.sendBtn, (!text.trim() || sending) && { opacity: 0.4 }]}
              accessibilityLabel="Send message"
            >
              {sending ? <ActivityIndicator color={c.onAccent} size="small" /> : <Ionicons name="arrow-up" size={20} color={c.onAccent} />}
            </Pressable>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((c, scheme) => ({
  screen: { flex: 1, backgroundColor: c.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 10 },
  name: { ...type.headline, color: c.text },
  sub: { ...type.footnote, color: c.text2 },
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 14,
    padding: 8,
    borderRadius: 18,
    backgroundColor: c.surface,
    borderWidth: scheme === 'dark' ? 0 : 1,
    borderColor: c.separator,
  },
  stripImg: { width: 44, height: 44, borderRadius: 12, backgroundColor: c.imageBg },
  stripTitle: { fontSize: 15, fontWeight: '700', color: c.text },
  statusPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  day: { alignSelf: 'center', fontSize: 12, fontWeight: '700', color: c.text2, marginVertical: 10 },
  bubble: { maxWidth: '80%', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, gap: 2 },
  mine: { backgroundColor: c.accent, borderBottomRightRadius: 6 },
  theirs: { backgroundColor: c.surface, borderBottomLeftRadius: 6, borderWidth: scheme === 'dark' ? 0 : 1, borderColor: c.separator },
  msg: { fontSize: 16, lineHeight: 21, color: c.text },
  time: { fontSize: 11, color: c.text3, alignSelf: 'flex-end' },
  seen: { fontSize: 11, color: c.text2, marginTop: 2, marginRight: 4 },
  safety: { flexDirection: 'row', gap: 8, alignItems: 'center', alignSelf: 'center', maxWidth: 320, backgroundColor: c.fill, borderRadius: 14, padding: 10, marginBottom: 10 },
  safetyText: { flex: 1, fontSize: 12, color: c.text2, lineHeight: 16 },
  quickRow: { gap: 8, paddingHorizontal: 12, paddingTop: 8 },
  quick: { borderRadius: 999, borderWidth: 1.5, borderColor: c.accent, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: c.accentSoft },
  quickText: { color: c.accent, fontWeight: '700', fontSize: 14 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 8 },
  input: {
    flex: 1,
    minHeight: 46,
    maxHeight: 130,
    borderRadius: 23,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 16,
    color: c.text,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.separator,
  },
  sendBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' },
  closed: { alignItems: 'center', paddingTop: 12, borderTopWidth: 1, borderTopColor: c.separator },
}));
