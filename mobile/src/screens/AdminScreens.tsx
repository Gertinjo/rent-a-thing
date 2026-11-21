import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { admin, AdminItem, AdminMessage, AdminStats, AdminUser, AICheck, api, API_URL, mediaUrl } from '../api';
import { Avatar, Button, Empty, IconName, ListGroup, ListRow, NavHeader, Segmented } from '../components/ui';
import type { ScreenProps } from '../navigation';
import { Alert } from '../platform';
import { categoryLabel, fmtDate, makeStyles, money, type, useTheme } from '../theme';

// Phone admin: deliberately small — quick numbers, the approval queue and the support inbox.
// Everything else (users, listings, bookings, reviews, audit log, settings) lives in the web admin at /admin.

// ===========================================================================
// Shared bits
// ===========================================================================

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso.endsWith('Z') ? iso : iso + 'Z').getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return fmtDate(iso.slice(0, 10));
}

const TOPIC: Record<string, { label: string; icon: IconName; color: string }> = {
  general: { label: 'Question', icon: 'help-circle', color: '#0A84FF' },
  booking: { label: 'Booking', icon: 'calendar', color: '#FF9500' },
  safety: { label: 'Safety', icon: 'shield', color: '#FF3B30' },
  bug: { label: 'Bug', icon: 'bug', color: '#AF52DE' },
  feedback: { label: 'Idea', icon: 'bulb', color: '#34C759' },
};

/** Fetch a list, refetch on focus and whenever `deps` change. */
function useList<T>(fetcher: () => Promise<T[]>, deps: unknown[]) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetcher());
    } catch (e: any) {
      Alert.alert('Couldn’t load', e.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
  return { rows, setRows, loading, load };
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ borderRadius: 7, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: color + '22' }}>
      <Text style={{ color, fontSize: 11, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const { c } = useTheme();
  const s = useStyles();
  return (
    <View style={s.search}>
      <Ionicons name="search" size={17} color={c.text2} />
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={c.text2} selectionColor={c.accent} style={s.searchInput} />
      {!!value && (
        <Pressable onPress={() => onChange('')} hitSlop={10}>
          <Ionicons name="close-circle" size={17} color={c.text3} />
        </Pressable>
      )}
    </View>
  );
}

/** List page: header, optional search/filter controls, refreshable list. */
function AdminList<T>({
  title,
  onBack,
  controls,
  rows,
  loading,
  onRefresh,
  renderItem,
  keyOf,
  empty,
}: {
  title: string;
  onBack: () => void;
  controls?: React.ReactNode;
  rows: T[];
  loading: boolean;
  onRefresh: () => void;
  renderItem: (row: T) => React.ReactElement;
  keyOf: (row: T) => string | number;
  empty: { icon: IconName; title: string; text?: string };
}) {
  const { c } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <View style={s.screen}>
      <NavHeader title={title} onBack={onBack} />
      <FlatList
        data={rows}
        keyExtractor={(r) => String(keyOf(r))}
        ListHeaderComponent={controls ? <View style={{ gap: 12, paddingHorizontal: 16, paddingBottom: 12 }}>{controls}</View> : undefined}
        renderItem={({ item }) => renderItem(item)}
        ItemSeparatorComponent={() => <View style={s.sep} />}
        contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={c.text2} />}
        ListEmptyComponent={loading ? <ActivityIndicator style={{ marginTop: 40 }} color={c.text2} /> : <Empty {...empty} />}
      />
    </View>
  );
}

/** Bottom sheet used for every detail view. */
function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={s.sheetBg} onPress={onClose} />
        <View style={[s.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={s.grabber} />
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
            <Text style={[s.sheetTitle, { flex: 1 }]} numberOfLines={1}>
              {title}
            </Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close">
              <Ionicons name="close-circle" size={28} color={s.closeIcon.color} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ReasonInput({ value, onChange, placeholder = 'Reason (saved in the audit log)' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const { c } = useTheme();
  const s = useStyles();
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={c.text3}
      selectionColor={c.accent}
      maxLength={300}
      style={s.reason}
    />
  );
}

function KV({ k, v }: { k: string; v: string }) {
  const s = useStyles();
  return (
    <View style={s.kv}>
      <Text style={s.kvK}>{k}</Text>
      <Text style={s.kvV} numberOfLines={2}>
        {v}
      </Text>
    </View>
  );
}

/** The AI pre-check result shown on a listing waiting for approval. */
function AICheckPanel({ check, canRun, running, onRun }: { check: AICheck | null; canRun: boolean; running: boolean; onRun: () => void }) {
  const { c } = useTheme();
  if (!check && !canRun) return null;
  const tone =
    check?.verdict === 'ok'
      ? { color: c.success, label: 'Looks fine', icon: 'checkmark-circle' as IconName }
      : check?.verdict === 'reject'
        ? { color: c.danger, label: 'Likely reject', icon: 'close-circle' as IconName }
        : check?.verdict === 'check'
          ? { color: c.warning, label: 'Check this', icon: 'alert-circle' as IconName }
          : { color: c.text2, label: 'AI check', icon: 'sparkles' as IconName };
  return (
    <View style={{ backgroundColor: tone.color + '18', borderRadius: 14, padding: 12, gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Ionicons name={tone.icon} size={16} color={tone.color} />
        <Text style={{ color: tone.color, fontWeight: '700', fontSize: 14, flex: 1 }}>AI pre-check · {tone.label}</Text>
        {canRun && (
          <Pressable onPress={onRun} disabled={running} hitSlop={8}>
            {running ? <ActivityIndicator size="small" color={c.text2} /> : <Text style={{ color: c.accent, fontWeight: '600', fontSize: 13 }}>{check ? 'Re-run' : 'Run'}</Text>}
          </Pressable>
        )}
      </View>
      {check?.error ? (
        <Text style={{ color: c.text2, fontSize: 13 }}>Couldn’t run: {check.error}</Text>
      ) : check ? (
        <>
          {!!check.summary && <Text style={{ color: c.text, fontSize: 14, lineHeight: 19 }}>{check.summary}</Text>}
          {check.issues?.map((iss, i) => (
            <Text key={i} style={{ color: c.text2, fontSize: 13, lineHeight: 18 }}>
              • {iss.text}
            </Text>
          ))}
        </>
      ) : (
        <Text style={{ color: c.text2, fontSize: 13 }}>Not checked yet.</Text>
      )}
    </View>
  );
}

// ===========================================================================
// Home
// ===========================================================================

export function AdminHomeScreen({ navigation }: ScreenProps<'Admin'>) {
  const { c } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const [st, setSt] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(false);
  const webAdmin = `${API_URL}/admin`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSt(await admin.stats());
    } catch (e: any) {
      Alert.alert('Couldn’t load', e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const waiting = st ? st.pending_users + st.pending_listings : 0;
  const tiles: { label: string; value: string; sub: string; icon: IconName; color: string; go?: () => void }[] = st
    ? [
        { label: 'To approve', value: String(waiting), sub: `${plural(st.pending_listings, 'listing')} · ${plural(st.pending_users, 'user')}`, icon: 'checkmark-circle', color: waiting ? c.accent : '#8E8E93', go: () => navigation.navigate('AdminApprovals') },
        { label: 'Messages', value: String(st.open_messages), sub: st.open_messages ? 'Need a reply' : 'All caught up', icon: 'mail', color: st.open_messages ? '#FF3B30' : '#8E8E93', go: () => navigation.navigate('AdminInbox') },
        { label: 'Live listings', value: String(st.listings_active), sub: `${st.listings_with_360} with 360°`, icon: 'cube', color: '#FF9500' },
        { label: 'Bookings', value: String(st.bookings_total), sub: `${st.bookings.pending} awaiting reply`, icon: 'calendar', color: '#5E5CE6' },
      ]
    : [];

  return (
    <View style={s.screen}>
      <NavHeader title="Admin" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 24, paddingBottom: insets.bottom + 40 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.text2} />}
      >
        <View style={{ gap: 2, paddingHorizontal: 4 }}>
          <Text style={{ ...type.footnote, color: c.text2, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 }}>
            {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </Text>
          <Text style={{ ...type.largeTitle, color: c.text }}>{waiting ? `${waiting} to review` : 'All clear'}</Text>
        </View>

        {!st ? (
          <ActivityIndicator color={c.text2} />
        ) : (
          <View style={s.kpis}>
            {tiles.map((k) => (
              <Pressable key={k.label} style={s.kpi} onPress={k.go} disabled={!k.go}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name={k.icon} size={15} color={k.color} />
                  <Text style={s.kpiLabel}>{k.label}</Text>
                </View>
                <Text style={s.kpiValue}>{k.value}</Text>
                <Text style={s.kpiSub}>{k.sub}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <ListGroup>
          <ListRow
            icon="checkmark-circle"
            iconColor="#34C759"
            label="Approvals"
            onPress={() => navigation.navigate('AdminApprovals')}
            right={waiting ? <View style={s.badge}><Text style={s.badgeText}>{waiting}</Text></View> : undefined}
          />
          <ListRow
            icon="mail"
            iconColor="#0A84FF"
            label="Support inbox"
            onPress={() => navigation.navigate('AdminInbox')}
            right={st?.open_messages ? <View style={s.badge}><Text style={s.badgeText}>{st.open_messages}</Text></View> : undefined}
          />
        </ListGroup>

        <View style={s.webCard}>
          <Ionicons name="desktop-outline" size={26} color={c.accent} />
          <Text style={{ ...type.headline, color: c.text }}>Full admin console on the web</Text>
          <Text style={{ ...type.subhead, color: c.text2, lineHeight: 20 }}>
            Users, listings, bookings, reviews, the audit log and settings are easier on a big screen. Open this on your computer:
          </Text>
          <Text selectable style={s.url}>{webAdmin}</Text>
          <Button title="Open web admin" icon="open-outline" variant="secondary" size="small" onPress={() => Linking.openURL(webAdmin)} />
        </View>
      </ScrollView>
    </View>
  );
}

// ===========================================================================
// Approvals
// ===========================================================================

type Pending = { kind: 'item'; row: AdminItem } | { kind: 'user'; row: AdminUser };

export function AdminApprovalsScreen({ navigation }: ScreenProps<'AdminApprovals'>) {
  const { c } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<'listings' | 'users'>('listings');
  const [items, setItems] = useState<AdminItem[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Pending | null>(null);
  const [reason, setReason] = useState('');
  const [aiOn, setAiOn] = useState(false);
  const [aiRunning, setAiRunning] = useState<number | null>(null);

  useEffect(() => {
    api.aiStatus().then((r) => setAiOn(r.enabled)).catch(() => {});
  }, []);

  const runAI = async (i: AdminItem) => {
    setAiRunning(i.id);
    try {
      const updated = await admin.runAICheck(i.id);
      setItems((x) => x.map((r) => (r.id === updated.id ? updated : r)));
    } catch (e: any) {
      Alert.alert('AI check failed', e.message);
    } finally {
      setAiRunning(null);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [i, u] = await Promise.all([admin.items({ status: 'pending' }), admin.users({ filter: 'pending' })]);
      setItems(i);
      setUsers(u);
    } catch (e: any) {
      Alert.alert('Couldn’t load', e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const decide = async (p: Pending, approve: boolean, why = '') => {
    const key = `${p.kind}${p.row.id}`;
    setBusy(key);
    try {
      if (p.kind === 'item') {
        await admin.updateItem(p.row.id, { review_status: approve ? 'approved' : 'rejected', reason: why });
        setItems((x) => x.filter((r) => r.id !== p.row.id));
      } else {
        await admin.updateUser(p.row.id, { approval_status: approve ? 'approved' : 'rejected', reason: why });
        setUsers((x) => x.filter((r) => r.id !== p.row.id));
      }
      setRejecting(null);
      setReason('');
    } catch (e: any) {
      Alert.alert('Couldn’t save', e.message);
    } finally {
      setBusy(null);
    }
  };

  const actions = (p: Pending) => (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      <Button title="Approve" icon="checkmark" size="small" onPress={() => decide(p, true)} loading={busy === `${p.kind}${p.row.id}`} style={{ flex: 1 }} />
      <Button
        title="Reject"
        size="small"
        variant="secondary"
        onPress={() => (setRejecting(p), setReason(p.kind === 'item' ? (p.row.ai_check?.message_to_owner ?? '') : ''))}
        style={{ flex: 1 }}
      />
    </View>
  );

  return (
    <View style={s.screen}>
      <NavHeader title="Approvals" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 14, paddingBottom: insets.bottom + 40 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.text2} />}
      >
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'listings', label: 'Listings', badge: items.length },
            { value: 'users', label: 'People', badge: users.length },
          ]}
        />
        {tab === 'listings' &&
          (items.length === 0 && !loading ? (
            <Empty icon="cube-outline" title="No listings waiting" text="New listings show up here before they go live." />
          ) : (
            items.map((i) => (
              <View key={i.id} style={s.card}>
                {i.cover_url ? (
                  <Image source={{ uri: mediaUrl(i.cover_url) }} style={s.cardImg} />
                ) : (
                  <View style={[s.cardImg, { alignItems: 'center', justifyContent: 'center', gap: 6 }]}>
                    <Ionicons name="image-outline" size={30} color={c.text3} />
                    <Text style={s.rowMeta}>No photos yet</Text>
                  </View>
                )}
                <View style={{ padding: 14, gap: 6 }}>
                  <Text style={s.rowMeta}>
                    {categoryLabel[i.category] ?? i.category} · {money(i.price_per_day)}/day{i.spin_frames ? ' · 360°' : ''}
                  </Text>
                  <Text style={s.rowTitle}>{i.title}</Text>
                  <Text style={s.rowSub}>
                    by {i.owner_name}
                    {i.owner_approval !== 'approved' ? ' (new user)' : ''}
                  </Text>
                  {!!i.location_label && (
                    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                      <Ionicons name="location-outline" size={15} color={c.text2} />
                      <Text style={s.rowSub} numberOfLines={1}>{i.location_label}</Text>
                    </View>
                  )}
                  {!!i.description && <Text style={s.rowSub} numberOfLines={3}>{i.description}</Text>}
                  <AICheckPanel check={i.ai_check} canRun={aiOn} running={aiRunning === i.id} onRun={() => runAI(i)} />
                  <View style={{ height: 4 }} />
                  {actions({ kind: 'item', row: i })}
                </View>
              </View>
            ))
          ))}
        {tab === 'users' &&
          (users.length === 0 && !loading ? (
            <Empty icon="people-outline" title="No one waiting" text="New sign-ups can browse but can’t book until you approve them." />
          ) : (
            users.map((u) => (
              <View key={u.id} style={[s.card, { padding: 14, gap: 10 }]}>
                <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                  <Avatar name={u.name} url={u.avatar_url} size={44} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.rowTitle}>{u.name}</Text>
                    <Text style={s.rowSub} numberOfLines={1}>{u.email}</Text>
                  </View>
                  <Text style={s.rowMeta}>{timeAgo(u.created_at)}</Text>
                </View>
                <Text style={s.rowSub}>
                  {u.neighborhood || 'No neighbourhood'} · {plural(u.listings_count, 'listing')}
                </Text>
                {!!u.bio && <Text style={{ ...type.callout, color: c.text }}>“{u.bio}”</Text>}
                {actions({ kind: 'user', row: u })}
              </View>
            ))
          ))}
      </ScrollView>

      <Sheet visible={!!rejecting} onClose={() => setRejecting(null)} title={rejecting?.kind === 'item' ? 'Reject listing' : 'Reject account'}>
        {rejecting && (
          <>
            <Text style={s.rowSub}>
              {rejecting.kind === 'item' ? `“${rejecting.row.title}” by ${rejecting.row.owner_name}` : `${rejecting.row.name} · ${rejecting.row.email}`}
            </Text>
            <Text style={{ ...type.subhead, color: c.text }}>Tell them what to change — they’ll see this.</Text>
            <ReasonInput
              value={reason}
              onChange={setReason}
              placeholder={rejecting.kind === 'item' ? 'e.g. Please add real photos and a pick-up location' : 'e.g. Please use your real name'}
            />
            <Button
              title="Reject"
              variant="danger"
              onPress={() => decide(rejecting, false, reason.trim())}
              disabled={!reason.trim()}
              loading={busy === `${rejecting.kind}${rejecting.row.id}`}
            />
          </>
        )}
      </Sheet>
    </View>
  );
}

// ===========================================================================
// Support inbox
// ===========================================================================

export function AdminInboxScreen({ navigation }: ScreenProps<'AdminInbox'>) {
  const { c } = useTheme();
  const s = useStyles();
  const [status, setStatus] = useState<'open' | 'resolved' | 'all'>('open');
  const { rows, setRows, loading, load } = useList(() => admin.messages(status), [status]);
  const [sel, setSel] = useState<AdminMessage | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (patch: { status?: 'open' | 'resolved' }) => {
    if (!sel) return;
    setBusy(true);
    try {
      const m = await admin.updateMessage(sel.id, { ...patch, admin_note: note });
      setRows((r) => (status !== 'all' && m.status !== status ? r.filter((x) => x.id !== m.id) : r.map((x) => (x.id === m.id ? m : x))));
      if (patch.status) setSel(null);
      else setSel(m);
    } catch (e: any) {
      Alert.alert('Couldn’t save', e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <AdminList
        title="Support inbox"
        onBack={() => navigation.goBack()}
        rows={rows}
        loading={loading}
        onRefresh={load}
        keyOf={(m) => m.id}
        empty={{ icon: 'mail-open-outline', title: status === 'open' ? 'Inbox zero' : 'Nothing here', text: status === 'open' ? 'No open messages. Nice work.' : undefined }}
        controls={
          <Segmented
            value={status}
            onChange={setStatus}
            options={[
              { value: 'open', label: 'Open' },
              { value: 'resolved', label: 'Resolved' },
              { value: 'all', label: 'All' },
            ]}
          />
        }
        renderItem={(m) => {
          const t = TOPIC[m.topic] ?? TOPIC.general;
          return (
            <Pressable onPress={() => (setSel(m), setNote(m.admin_note))} style={({ pressed }) => [s.row, { alignItems: 'flex-start' }, pressed && { backgroundColor: c.fill }]}>
              <View style={[s.topicIcon, { backgroundColor: t.color }]}>
                <Ionicons name={t.icon} size={16} color="#fff" />
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[s.rowTitle, { flex: 1 }]} numberOfLines={1}>
                    {m.name || m.email}
                  </Text>
                  <Text style={s.rowMeta}>{timeAgo(m.created_at)}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <Pill label={t.label} color={t.color} />
                  {m.status === 'resolved' && <Pill label="Resolved" color={c.success} />}
                </View>
                <Text style={s.rowSub} numberOfLines={2}>
                  {m.message}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />
      <Sheet visible={!!sel} onClose={() => setSel(null)} title={sel ? `${TOPIC[sel.topic]?.label ?? 'Message'} · ${sel.name || 'Guest'}` : ''}>
        {sel && (
          <>
            <View style={s.kvCard}>
              <KV k="From" v={sel.name || 'Guest (not logged in)'} />
              <KV k="Email" v={sel.email || '—'} />
              <KV k="Received" v={new Date(sel.created_at + 'Z').toLocaleString()} />
              {sel.booking_id ? <KV k="Booking" v={`#${sel.booking_id}`} /> : null}
              {sel.resolved_at ? <KV k="Resolved" v={timeAgo(sel.resolved_at)} /> : null}
            </View>
            <Text style={[s.quote, { fontStyle: 'normal' }]}>{sel.message}</Text>
            {!!sel.email && (
              <Button
                title="Reply by email"
                variant="secondary"
                icon="arrow-undo"
                onPress={() => Linking.openURL(`mailto:${sel.email}?subject=${encodeURIComponent('Re: your message to Rent a Thing')}`)}
              />
            )}
            <View style={{ gap: 6 }}>
              <Text style={s.groupTitle}>Internal note</Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Only admins see this"
                placeholderTextColor={c.text3}
                selectionColor={c.accent}
                multiline
                style={[s.reason, { minHeight: 80, textAlignVertical: 'top' }]}
              />
            </View>
            {sel.status === 'open' ? (
              <Button title="Mark as resolved" icon="checkmark-done" onPress={() => save({ status: 'resolved' })} loading={busy} />
            ) : (
              <Button title="Reopen" icon="mail-unread" onPress={() => save({ status: 'open' })} loading={busy} />
            )}
            <Button title="Save note" variant="plain" onPress={() => save({})} disabled={busy || note === sel.admin_note} />
          </>
        )}
      </Sheet>
    </>
  );
}

const useStyles = makeStyles((c, scheme) => ({
  webCard: { backgroundColor: c.surface, borderRadius: 18, padding: 16, gap: 8 },
  url: { fontSize: 15, fontWeight: '600', color: c.accent },
  card: { backgroundColor: c.surface, borderRadius: 20, overflow: 'hidden' },
  cardImg: { width: '100%', height: 180, backgroundColor: c.imageBg },
  screen: { flex: 1, backgroundColor: c.grouped },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.fill, borderRadius: 12, paddingHorizontal: 12, height: 40 },
  searchInput: { flex: 1, fontSize: 16, color: c.text, height: 40 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: c.surface },
  sep: { height: 1, backgroundColor: c.separator, marginLeft: 16 },
  rowTitle: { ...type.headline, fontSize: 16, color: c.text, flexShrink: 1 },
  rowSub: { ...type.subhead, color: c.text2 },
  rowMeta: { fontSize: 12, color: c.text3 },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  kpi: { width: '48.5%', backgroundColor: c.surface, borderRadius: 18, padding: 14, gap: 4 },
  kpiLabel: { fontSize: 13, fontWeight: '600', color: c.text2 },
  kpiValue: { fontSize: 28, fontWeight: '700', color: c.text, letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
  kpiSub: { fontSize: 12, color: c.text2 },
  groupTitle: { ...type.footnote, color: c.text2, textTransform: 'uppercase', letterSpacing: 0.3, marginLeft: 16 },
  badge: { backgroundColor: c.danger, borderRadius: 10, minWidth: 20, height: 20, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  sheetBg: { flex: 1, backgroundColor: c.overlay },
  sheet: { maxHeight: '88%', backgroundColor: c.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 8 },
  grabber: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: c.text3, marginBottom: 12 },
  sheetTitle: { ...type.title2, color: c.text },
  closeIcon: { color: c.text3 },
  kvCard: { backgroundColor: c.fill, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 4 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 9 },
  kvK: { fontSize: 15, color: c.text2 },
  kvV: { fontSize: 15, color: c.text, fontWeight: '500', flexShrink: 1, textAlign: 'right' },
  quote: { ...type.body, color: c.text, fontStyle: 'italic' },
  reason: { backgroundColor: c.fill, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: c.text },
  topicIcon: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
}));
