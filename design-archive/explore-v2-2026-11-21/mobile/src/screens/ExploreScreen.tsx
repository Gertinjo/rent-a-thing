import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, CATEGORIES, ItemBrief, mediaUrl } from '../api';
import { useAuth } from '../auth';
import AccountBanner from '../components/AccountBanner';
import { Avatar, Empty, Glass, useTabBarSpace } from '../components/ui';
import type { RootStackParamList } from '../navigation';
import { addDays, categoryIcon, categoryLabel, fmtDate, isoDay, makeStyles, money, type, useTheme } from '../theme';

/** Saturday and Sunday of this weekend (today counts if it's already the weekend). */
function weekend(): { from: string; to: string } {
  const d = new Date();
  const day = d.getDay(); // 0 = Sun, 6 = Sat
  const today = isoDay(d);
  if (day === 6) return { from: today, to: addDays(today, 1) };
  if (day === 0) return { from: today, to: today };
  const sat = addDays(today, 6 - day);
  return { from: sat, to: addDays(sat, 1) };
}

const area = (i: ItemBrief) => (i.location_label || i.neighborhood || 'Nearby').split(',')[0];

export default function ExploreScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const tabNav = useNavigation<any>();
  const { user } = useAuth();
  const { c } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const bottom = useTabBarSpace();
  const frameW = Math.min(width, 430);
  const heroW = frameW - 40;
  const wk = useMemo(weekend, []);

  const [items, setItems] = useState<ItemBrief[]>([]);
  const [weekendItems, setWeekendItems] = useState<ItemBrief[]>([]);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string | undefined>();
  const [onlyWeekend, setOnlyWeekend] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [heroIndex, setHeroIndex] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const filters = { q: q || undefined, category, ...(onlyWeekend ? { available_from: wk.from, available_to: wk.to } : {}) };
      const [all, free] = await Promise.all([api.items(filters), api.items({ available_from: wk.from, available_to: wk.to })]);
      setItems(all);
      setWeekendItems(free);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [q, category, onlyWeekend, wk]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);
  useFocusEffect(
    useCallback(() => {
      load();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const notMine = (i: ItemBrief) => i.owner_id !== user?.id;
  // Listings with a photo first (stable: keeps newest-first within each group).
  const photosFirst = (list: ItemBrief[]) => [...list.filter((i) => i.cover_url), ...list.filter((i) => !i.cover_url)];
  const visible = photosFirst(items.filter(notMine));
  const filtering = !!q || !!category || onlyWeekend;
  const popular = [...visible]
    .sort((a, b) => (b.rating_avg ?? 0) * Math.log2(2 + b.rating_count) - (a.rating_avg ?? 0) * Math.log2(2 + a.rating_count))
    .slice(0, 5);
  const freeThisWeekend = photosFirst(weekendItems.filter(notMine)).slice(0, 10);
  const open = (id: number) => nav.navigate('ItemDetail', { id });

  const onHeroScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) =>
    setHeroIndex(Math.round(e.nativeEvent.contentOffset.x / (heroW + 12)));

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: bottom }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.text2} />}
      keyboardShouldPersistTaps="handled"
    >
      {/* ---------- header ---------- */}
      <View style={s.topRow}>
        <View style={s.locationPill}>
          <Ionicons name="location" size={14} color={c.accent} />
          <Text style={s.locationText} numberOfLines={1}>
            {user?.neighborhood || 'Your neighbourhood'}
          </Text>
        </View>
        <Pressable onPress={() => tabNav.navigate('Profile')} accessibilityLabel="Your profile">
          <Avatar name={user?.name ?? '?'} url={user?.avatar_url} size={40} />
        </Pressable>
      </View>
      <Text style={s.headline}>
        What do you{'\n'}need to <Text style={{ color: c.accent }}>borrow</Text>?
      </Text>

      {/* ---------- search ---------- */}
      <View style={s.searchRow}>
        <View style={s.search}>
          <Ionicons name="search" size={20} color={c.text2} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search anything"
            placeholderTextColor={c.text2}
            selectionColor={c.accent}
            style={s.searchInput}
            returnKeyType="search"
          />
          {!!q && (
            <Pressable onPress={() => setQ('')} hitSlop={10} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={18} color={c.text3} />
            </Pressable>
          )}
        </View>
        <Pressable
          onPress={() => setOnlyWeekend((v) => !v)}
          style={[s.weekendBtn, onlyWeekend && { backgroundColor: c.accent }]}
          accessibilityRole="switch"
          accessibilityState={{ checked: onlyWeekend }}
          accessibilityLabel="Only things free this weekend"
        >
          <Ionicons name="calendar" size={18} color={onlyWeekend ? c.onAccent : c.text} />
          <Text style={[s.weekendText, onlyWeekend && { color: c.onAccent }]}>Weekend</Text>
        </Pressable>
      </View>

      <AccountBanner style={{ marginHorizontal: 20, marginTop: 14 }} />

      {/* ---------- categories ---------- */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.cats}>
        {[undefined, ...CATEGORIES].map((cat) => {
          const on = category === cat;
          return (
            <Pressable key={cat ?? 'all'} onPress={() => setCategory(cat)} style={s.cat} accessibilityState={{ selected: on }}>
              <View style={[s.catCircle, on && { backgroundColor: c.accent }]}>
                <Ionicons name={(cat ? categoryIcon[cat] : 'apps-outline') as any} size={24} color={on ? c.onAccent : c.text} />
              </View>
              <Text style={[s.catText, on && { color: c.text, fontWeight: '700' }]} numberOfLines={1}>
                {cat ? categoryLabel[cat].split(' ')[0] : 'All'}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {error ? (
        <Empty icon="cloud-offline-outline" title="Can’t reach the server" text={error} />
      ) : (
        <>
          {/* ---------- popular carousel ---------- */}
          {!filtering && popular.length > 0 && (
            <View style={s.section}>
              <SectionHeader title="Popular near you" />
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                snapToInterval={heroW + 12}
                decelerationRate="fast"
                onScroll={onHeroScroll}
                scrollEventThrottle={32}
                contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
              >
                {popular.map((i) => (
                  <HeroCard key={i.id} item={i} width={heroW} onPress={() => open(i.id)} />
                ))}
              </ScrollView>
              <View style={s.dots}>
                {popular.map((i, n) => (
                  <View key={i.id} style={[s.dot, n === heroIndex && { width: 18, backgroundColor: c.text }]} />
                ))}
              </View>
            </View>
          )}

          {/* ---------- free this weekend ---------- */}
          {!filtering && freeThisWeekend.length > 0 && (
            <View style={s.section}>
              <SectionHeader title="Free this weekend" subtitle={`${fmtDate(wk.from)}${wk.to !== wk.from ? ` – ${fmtDate(wk.to)}` : ''}`} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 14 }}>
                {freeThisWeekend.map((i) => (
                  <MiniCard key={i.id} item={i} onPress={() => open(i.id)} />
                ))}
              </ScrollView>
            </View>
          )}

          {/* ---------- everything / results ---------- */}
          <View style={s.section}>
            <SectionHeader
              title={filtering ? `${visible.length} ${visible.length === 1 ? 'result' : 'results'}` : 'Everything nearby'}
              subtitle={onlyWeekend ? `Free ${fmtDate(wk.from)} – ${fmtDate(wk.to)}` : undefined}
            />
            {loading && visible.length === 0 ? (
              <ActivityIndicator color={c.text2} style={{ marginTop: 24 }} />
            ) : visible.length === 0 ? (
              <Empty icon="search-outline" title="Nothing found" text="Try another word or category — or list your own thing." />
            ) : (
              <View style={s.list}>
                {visible.map((i, n) => (
                  <View key={i.id}>
                    {n > 0 && <View style={s.sep} />}
                    <RowCard item={i} onPress={() => open(i.id)} />
                  </View>
                ))}
              </View>
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const s = useStyles();
  return (
    <View style={s.sectionHead}>
      <Text style={s.sectionTitle}>{title}</Text>
      {subtitle && <Text style={s.sectionSub}>{subtitle}</Text>}
    </View>
  );
}

function Photo({ item, style }: { item: ItemBrief; style: object }) {
  const { c } = useTheme();
  return item.cover_url ? (
    <Image source={{ uri: mediaUrl(item.cover_url) }} style={style} resizeMode="cover" />
  ) : (
    <View style={[style, { alignItems: 'center', justifyContent: 'center' }]}>
      <Ionicons name={categoryIcon[item.category] as any} size={30} color={c.text3} />
    </View>
  );
}

/** Big photo card with the text laid over a dark fade at the bottom. */
function HeroCard({ item, width, onPress }: { item: ItemBrief; width: number; onPress: () => void }) {
  const s = useStyles();
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress}>
      {({ pressed }) => (
        <View style={[s.hero, { width, height: Math.round(width * 0.72), transform: [{ scale: pressed ? 0.985 : 1 }] }]}>
          <Photo item={item} style={s.fill} />
          {/* stacked translucent bands = a soft gradient without extra libraries */}
          <View pointerEvents="none" style={s.fadeWrap}>
            {[0.0, 0.12, 0.28, 0.45, 0.6].map((o, k) => (
              <View key={k} style={{ flex: 1, backgroundColor: `rgba(0,0,0,${o})` }} />
            ))}
          </View>
          <Glass radius={14} shadow={false} style={s.pricePill}>
            <Text style={[s.pricePillText, { color: c.text }]}>
              {money(item.price_per_day)}
              <Text style={{ fontWeight: '500', fontSize: 12 }}> /day</Text>
            </Text>
          </Glass>
          <View style={s.heroText}>
            <Text style={s.heroTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {item.rating_count > 0 && (
                <>
                  <Ionicons name="star" size={13} color="#FFD15C" />
                  <Text style={s.heroMeta}>{item.rating_avg?.toFixed(1)}</Text>
                  <Text style={s.heroMeta}>·</Text>
                </>
              )}
              <Text style={s.heroMeta} numberOfLines={1}>
                {area(item)} · {item.owner_name.split(' ')[0]}
              </Text>
            </View>
          </View>
        </View>
      )}
    </Pressable>
  );
}

/** Small square card for horizontal shelves. */
function MiniCard({ item, onPress }: { item: ItemBrief; onPress: () => void }) {
  const s = useStyles();
  return (
    <Pressable onPress={onPress} style={{ width: 148 }}>
      {({ pressed }) => (
        <View style={{ gap: 8, opacity: pressed ? 0.85 : 1 }}>
          <Photo item={item} style={s.mini} />
          <View style={{ gap: 2 }}>
            <Text style={s.miniTitle} numberOfLines={2}>
              {item.title}
            </Text>
            <Text style={s.miniPrice}>
              {money(item.price_per_day)}
              <Text style={s.per}> /day</Text>
            </Text>
          </View>
        </View>
      )}
    </Pressable>
  );
}

/** List row: photo on the left, details on the right. */
function RowCard({ item, onPress }: { item: ItemBrief; onPress: () => void }) {
  const s = useStyles();
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress}>
      {({ pressed }) => (
        <View style={[s.row, pressed && { backgroundColor: c.fill }]}>
          <Photo item={item} style={s.rowImg} />
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={s.rowCat}>{categoryLabel[item.category] ?? item.category}</Text>
            <Text style={s.rowTitle} numberOfLines={2}>
              {item.title}
            </Text>
            <Text style={s.rowMeta} numberOfLines={1}>
              {area(item)} · {item.owner_name.split(' ')[0]}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
              <Text style={s.rowPrice}>
                {money(item.price_per_day)}
                <Text style={s.per}> /day</Text>
              </Text>
              {item.rating_count > 0 ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <Ionicons name="star" size={12} color={c.star} />
                  <Text style={s.rowMeta}>
                    {item.rating_avg?.toFixed(1)} ({item.rating_count})
                  </Text>
                </View>
              ) : (
                <Text style={[s.rowMeta, { color: c.accent, fontWeight: '600' }]}>New</Text>
              )}
            </View>
          </View>
        </View>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------

const useStyles = makeStyles((c, scheme) => ({
  screen: { flex: 1, backgroundColor: c.bg },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  locationPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.fill, borderRadius: 999, paddingHorizontal: 12, height: 34, maxWidth: '70%' },
  locationText: { fontSize: 14, fontWeight: '600', color: c.text },
  headline: { fontSize: 32, lineHeight: 37, fontWeight: '800', letterSpacing: -0.8, color: c.text, paddingHorizontal: 20, marginTop: 18 },
  searchRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginTop: 18 },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: scheme === 'dark' ? c.surface : c.bg,
    borderRadius: 999,
    paddingHorizontal: 16,
    height: 52,
    borderWidth: 1,
    borderColor: c.separator,
    shadowColor: '#000',
    shadowOpacity: scheme === 'dark' ? 0 : 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  searchInput: { flex: 1, fontSize: 16, color: c.text, height: 52 },
  weekendBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 52, paddingHorizontal: 14, borderRadius: 999, backgroundColor: c.fill },
  weekendText: { fontSize: 14, fontWeight: '600', color: c.text },
  cats: { gap: 6, paddingHorizontal: 16, paddingTop: 22, paddingBottom: 4 },
  cat: { width: 70, alignItems: 'center', gap: 7 },
  catCircle: { width: 58, height: 58, borderRadius: 29, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' },
  catText: { fontSize: 12, fontWeight: '500', color: c.text2 },
  section: { marginTop: 30, gap: 14 },
  sectionHead: { paddingHorizontal: 20, gap: 2 },
  sectionTitle: { ...type.title2, color: c.text },
  sectionSub: { ...type.subhead, color: c.text2 },
  hero: { borderRadius: 28, overflow: 'hidden', backgroundColor: c.imageBg },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', backgroundColor: c.imageBg },
  fadeWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' },
  pricePill: { position: 'absolute', top: 12, right: 12 },
  pricePillText: { fontSize: 15, fontWeight: '800', paddingHorizontal: 11, paddingVertical: 6 },
  heroText: { position: 'absolute', left: 16, right: 16, bottom: 14, gap: 3 },
  heroTitle: { color: '#fff', fontSize: 21, fontWeight: '800', letterSpacing: -0.3 },
  heroMeta: { color: 'rgba(255,255,255,0.9)', fontSize: 13, fontWeight: '500' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.text3 },
  mini: { width: 148, height: 148, borderRadius: 22, backgroundColor: c.imageBg },
  miniTitle: { fontSize: 14, fontWeight: '600', color: c.text, lineHeight: 18 },
  miniPrice: { fontSize: 14, fontWeight: '800', color: c.text },
  per: { fontWeight: '400', color: c.text2 },
  list: { marginHorizontal: 20, borderRadius: 24, overflow: 'hidden', backgroundColor: scheme === 'dark' ? c.surface : c.surface2 },
  sep: { height: 1, backgroundColor: c.separator, marginLeft: 120 },
  row: { flexDirection: 'row', gap: 14, padding: 12, alignItems: 'center' },
  rowImg: { width: 94, height: 94, borderRadius: 18, backgroundColor: c.imageBg },
  rowCat: { fontSize: 11, fontWeight: '700', color: c.accent, textTransform: 'uppercase', letterSpacing: 0.6 },
  rowTitle: { fontSize: 16, fontWeight: '700', color: c.text, letterSpacing: -0.2 },
  rowMeta: { fontSize: 13, color: c.text2 },
  rowPrice: { fontSize: 16, fontWeight: '800', color: c.text },
}));
