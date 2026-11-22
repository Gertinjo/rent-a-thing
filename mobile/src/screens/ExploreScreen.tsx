import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, CATEGORIES, ItemBrief, mediaUrl, PromoSlide } from '../api';
import { useAuth } from '../auth';
import AccountBanner from '../components/AccountBanner';
import LogoMark from '../components/LogoMark';
import PromoCarousel from '../components/PromoCarousel';
import PromoPopup from '../components/PromoPopup';
import { Empty, useTabBarSpace } from '../components/ui';
import type { RootStackParamList } from '../navigation';
import { useRealtime } from '../realtime';
import { useHomeCity } from '../appConfig';
import { CLUB_GOLD } from '../components/Badges';
import { addDays, categoryIcon, categoryLabel, categoryTile, fmtDate, isoDay, makeStyles, money, type, useTheme } from '../theme';

/** Round icon in the header with a red count badge (messages, notifications). */
function HeaderIcon({ icon, count, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; count: number; label: string; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={6} accessibilityLabel={count ? `${label}, ${count} unread` : label}>
      {({ pressed }) => (
        <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: c.surface, borderWidth: 1, borderColor: c.separator, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 }}>
          <Ionicons name={icon} size={21} color={c.text} />
          {count > 0 && (
            <View style={{ position: 'absolute', top: -3, right: -3, minWidth: 19, height: 19, borderRadius: 10, paddingHorizontal: 5, backgroundColor: c.danger, borderWidth: 2, borderColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{count > 9 ? '9+' : count}</Text>
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
}

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

// Area in the home city ("Ulpiana"); the town for things outside it ("Peja"), which says more there.
const area = (i: ItemBrief) => {
  const parts = (i.location_label || i.neighborhood || 'Nearby').split(',').map((p) => p.trim());
  return i.in_home_city === false ? parts[parts.length - 1] : parts[0];
};
type Quick = 'weekend' | 'cheap' | 'top';
const QUICK: { key: Quick; label: string; icon: string }[] = [
  { key: 'weekend', label: 'This weekend', icon: 'calendar-outline' },
  { key: 'cheap', label: 'Under €15', icon: 'pricetag-outline' },
  { key: 'top', label: 'Top rated', icon: 'star-outline' },
];

export default function ExploreScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const tabNav = useNavigation<any>();
  const rt = useRealtime();
  const homeCity = useHomeCity();
  const { user } = useAuth();
  const clubMember = !!user?.club_member;
  const { c, scheme } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const bottom = useTabBarSpace();
  const wk = useMemo(weekend, []);

  const [items, setItems] = useState<ItemBrief[]>([]);
  const [weekendItems, setWeekendItems] = useState<ItemBrief[]>([]);
  const [promos, setPromos] = useState<PromoSlide[]>([]);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string | undefined>();
  const [quick, setQuick] = useState<Quick | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const filters = { q: q || undefined, category, ...(quick === 'weekend' ? { available_from: wk.from, available_to: wk.to } : {}) };
      const [all, free, promoted] = await Promise.all([
        api.items(filters),
        api.items({ available_from: wk.from, available_to: wk.to }),
        api.promoted().catch(() => [] as PromoSlide[]), // the slideshow never blocks the feed
      ]);
      setItems(all);
      setWeekendItems(free);
      setPromos(promoted);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [q, category, quick, wk]);

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
  const photosFirst = (list: ItemBrief[]) => [...list.filter((i) => i.cover_url), ...list.filter((i) => !i.cover_url)];
  let visible = photosFirst(items.filter(notMine));
  if (quick === 'cheap') visible = visible.filter((i) => i.price_per_day < 15);
  if (quick === 'top') visible = visible.filter((i) => (i.rating_avg ?? 0) >= 4.5).sort((a, b) => (b.rating_avg ?? 0) - (a.rating_avg ?? 0));
  const filtering = !!q || !!category || !!quick;
  const inCity = (i: ItemBrief) => i.in_home_city !== false;
  // Prishtina first, everything else after it.
  const cityFirst = (list: ItemBrief[]) => [...list.filter(inCity), ...list.filter((i) => !inCity(i))];
  visible = cityFirst(visible);
  const local = visible.filter(inCity);
  const elsewhere = visible.filter((i) => !inCity(i));
  const freeThisWeekend = cityFirst(photosFirst(weekendItems.filter(notMine))).slice(0, 10);
  const open = (id: number) => nav.navigate('ItemDetail', { id });
  const first = user?.name?.split(' ')[0] ?? '';

  return (
    <>
    <PromoPopup
      user={user}
      paused={filtering}
      actions={{
        onDeals: () => setQuick('cheap'),
        onWeekend: () => setQuick('weekend'),
        onPromote: () => tabNav.navigate('My things'),
        onList: () => nav.navigate('ListingEditor', {}),
        onClub: () => nav.navigate('Club'),
      }}
    />
    <ScrollView
      style={s.screen}
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: bottom }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.text2} />}
      keyboardShouldPersistTaps="handled"
    >
      {/* ---------- header ---------- */}
      <View style={s.topRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 }}>
          <LogoMark />
          <Text style={[s.wordmark, { flexShrink: 1 }]} numberOfLines={1}>
            Rentify
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <HeaderIcon icon="chatbubble-ellipses-outline" count={rt.unread.messages} label="Messages" onPress={() => nav.navigate('Messages')} />
          <HeaderIcon icon="notifications-outline" count={rt.unread.notifications} label="Notifications" onPress={() => nav.navigate('Notifications')} />
        </View>
      </View>
      <Text style={s.hello}>
        Hi {first}, what can your neighbours lend you today?
      </Text>
      {clubMember && (
        <Pressable onPress={() => nav.navigate('Club')} style={s.clubBanner} accessibilityRole="button">
          <Ionicons name="ribbon" size={16} color={CLUB_GOLD} />
          <Text style={s.clubBannerText}>Rent Club member · open the members’ chat</Text>
          <Ionicons name="chevron-forward" size={14} color={CLUB_GOLD} />
        </Pressable>
      )}

      {/* ---------- search + quick filters ---------- */}
      <View style={s.searchCard}>
        <Ionicons name="search" size={20} color={c.accent} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search tools, tents, cameras…"
          placeholderTextColor={c.text3}
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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.quickRow}>
        {QUICK.map((f) => {
          const on = quick === f.key;
          return (
            <Pressable key={f.key} onPress={() => setQuick(on ? null : f.key)} style={[s.quick, on && { backgroundColor: c.text, borderColor: c.text }]}>
              <Ionicons name={f.icon as any} size={15} color={on ? c.bg : c.text} />
              <Text style={[s.quickText, on && { color: c.bg }]}>{f.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <AccountBanner style={{ marginHorizontal: 20, marginTop: 6 }} />

      {/* ---------- colourful category tiles ---------- */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.cats}>
        {CATEGORIES.map((cat) => {
          const on = category === cat;
          const tile = categoryTile(cat, scheme);
          return (
            <Pressable key={cat} onPress={() => setCategory(on ? undefined : cat)} style={s.cat} accessibilityState={{ selected: on }}>
              {({ pressed }) => (
                <>
                  <View
                    style={[
                      s.catTile,
                      { backgroundColor: tile.bg, transform: [{ scale: pressed ? 0.94 : 1 }] },
                      on && { borderColor: tile.fg, borderWidth: 2.5 },
                    ]}
                  >
                    <Ionicons name={categoryIcon[cat] as any} size={28} color={tile.fg} />
                  </View>
                  <Text style={[s.catText, on && { color: c.text, fontWeight: '800' }]} numberOfLines={1}>
                    {categoryLabel[cat].split(' ')[0]}
                  </Text>
                </>
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      {error ? (
        <Empty icon="cloud-offline-outline" title="Can’t reach the server" text={error} />
      ) : (
        <>
          {!filtering && (
            <>
              {/* ---------- slideshow: Black Friday, promoted listings, house ads ---------- */}
              <PromoCarousel
                promos={promos}
                onOpenItem={open}
                onDeals={() => setQuick('cheap')}
                onPromote={() => tabNav.navigate('My things')}
                onList={() => nav.navigate('ListingEditor', {})}
              />

              {/* ---------- free this weekend ---------- */}
              {freeThisWeekend.length > 0 && (
                <View style={s.section}>
                  <SectionHeader title="Free this weekend" subtitle={`${fmtDate(wk.from)}${wk.to !== wk.from ? ` – ${fmtDate(wk.to)}` : ''}`} />
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 14, paddingBottom: 6 }}>
                    {freeThisWeekend.map((i) => (
                      <ShelfCard key={i.id} item={i} onPress={() => open(i.id)} />
                    ))}
                  </ScrollView>
                </View>
              )}
            </>
          )}

          {/* ---------- feed: the home city first ---------- */}
          <View style={s.section}>
            <SectionHeader
              title={filtering ? `${visible.length} ${visible.length === 1 ? 'thing' : 'things'} found` : `In ${homeCity}`}
              subtitle={
                filtering
                  ? `${local.length} in ${homeCity}${elsewhere.length ? ` · ${elsewhere.length} elsewhere` : ''}`
                  : `${local.length} ${local.length === 1 ? 'thing' : 'things'} to borrow in ${homeCity}`
              }
            />
            {loading && visible.length === 0 ? (
              <ActivityIndicator color={c.text2} style={{ marginTop: 24 }} />
            ) : visible.length === 0 ? (
              <Empty icon="search-outline" title="Nothing found" text="Try another word or category — or list your own thing." />
            ) : (
              <View style={{ paddingHorizontal: 20, gap: 18 }}>
                {local.length === 0 && (
                  <Text style={s.meta}>Nothing in {homeCity} yet{filtering ? ' for this search' : ''}. Be the first to list something!</Text>
                )}
                {local.map((i) => (
                  <FeedCard key={i.id} item={i} onPress={() => open(i.id)} />
                ))}
              </View>
            )}
          </View>

          {/* ---------- outside the home city, with a warning ---------- */}
          {elsewhere.length > 0 && (
            <View style={s.section}>
              <SectionHeader title={`Outside ${homeCity}`} subtitle={`${elsewhere.length} ${elsewhere.length === 1 ? 'thing' : 'things'} further away`} />
              <View style={[s.outsideNote, { marginHorizontal: 20, marginBottom: 14 }]}>
                <Ionicons name="warning" size={16} color={c.warning} />
                <Text style={s.outsideNoteText}>These aren’t in {homeCity}. Check the pick-up place before you book.</Text>
              </View>
              <View style={{ paddingHorizontal: 20, gap: 18 }}>
                {elsewhere.map((i) => (
                  <FeedCard key={i.id} item={i} onPress={() => open(i.id)} />
                ))}
              </View>
            </View>
          )}
        </>
      )}
    </ScrollView>
    </>
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
      <Ionicons name={categoryIcon[item.category] as any} size={34} color={c.text3} />
    </View>
  );
}

function CategoryPill({ cat }: { cat: string }) {
  const { scheme } = useTheme();
  const tile = categoryTile(cat, 'light'); // always light pill on top of a photo
  void scheme;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: tile.bg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 }}>
      <Ionicons name={categoryIcon[cat] as any} size={13} color={tile.fg} />
      <Text style={{ color: tile.fg, fontSize: 12, fontWeight: '800' }}>{categoryLabel[cat]}</Text>
    </View>
  );
}

/** Big white card: photo on top, details underneath. */
function FeedCard({ item, onPress }: { item: ItemBrief; onPress: () => void }) {
  const s = useStyles();
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress}>
      {({ pressed }) => (
        <View style={[s.feedCard, { transform: [{ scale: pressed ? 0.985 : 1 }] }]}>
          <View>
            <Photo item={item} style={s.feedImg} />
            <View style={{ position: 'absolute', top: 12, left: 12 }}>
              <CategoryPill cat={item.category} />
            </View>
            {item.in_home_city === false && <OutsideChip />}
            {item.has_360 && (
              <View style={s.badge360}>
                <Ionicons name="sync" size={12} color="#fff" />
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>360°</Text>
              </View>
            )}
          </View>
          <View style={{ padding: 14, paddingTop: 12, gap: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <Text style={s.feedTitle} numberOfLines={2}>
                {item.title}
              </Text>
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <View style={s.pricePill}>
                  <Text style={s.priceText}>{money(item.price_per_day)}</Text>
                  <Text style={s.priceDay}>/day</Text>
                </View>
              </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {item.rating_count > 0 ? (
                <>
                  <Ionicons name="star" size={14} color={c.star} />
                  <Text style={s.metaStrong}>{item.rating_avg?.toFixed(1)}</Text>
                  <Text style={s.meta}>({item.rating_count})</Text>
                </>
              ) : (
                <Text style={[s.metaStrong, { color: c.accent }]}>New</Text>
              )}
              <Text style={s.meta}>·</Text>
              <Ionicons name="location-outline" size={14} color={c.text2} />
              <Text style={s.meta} numberOfLines={1}>
                {area(item)} · {item.owner_name.split(' ')[0]}
              </Text>
            </View>
          </View>
        </View>
      )}
    </Pressable>
  );
}

/** Small warning: this item is not in the home city (Prishtina). */
function OutsideChip({ inline }: { inline?: boolean }) {
  const { c } = useTheme();
  const homeCity = useHomeCity();
  return (
    <View
      accessibilityLabel={`Not in ${homeCity}`}
      style={[
        { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: '#FFF4DB', alignSelf: 'flex-start' },
        !inline && { position: 'absolute', left: 12, bottom: 12 },
      ]}
    >
      <Ionicons name="warning" size={12} color={c.warning} />
      <Text style={{ color: '#8A5A00', fontSize: 11, fontWeight: '800' }}>Not in {homeCity}</Text>
    </View>
  );
}

/** Medium card for the horizontal shelf. */
function ShelfCard({ item, onPress }: { item: ItemBrief; onPress: () => void }) {
  const s = useStyles();
  return (
    <Pressable onPress={onPress}>
      {({ pressed }) => (
        <View style={[s.shelfCard, { opacity: pressed ? 0.9 : 1 }]}>
          <Photo item={item} style={s.shelfImg} />
          <View style={{ padding: 10, gap: 3 }}>
            <Text style={s.shelfTitle} numberOfLines={1}>
              {item.title}
            </Text>
            {item.in_home_city === false && <OutsideChip inline />}
            <Text style={s.shelfPrice}>
              {money(item.price_per_day)}
              <Text style={s.priceDay}> /day</Text>
            </Text>
          </View>
        </View>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------

const useStyles = makeStyles((c, scheme) => {
  const cardShadow = {
    shadowColor: '#5A3A1A',
    shadowOpacity: scheme === 'dark' ? 0 : 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  };
  return {
    screen: { flex: 1, backgroundColor: c.bg },
    topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
    wordmark: { fontSize: 22, fontWeight: '900', color: c.text, letterSpacing: -0.6 },
    hello: { ...type.callout, color: c.text2, paddingHorizontal: 20, marginTop: 10 },
    searchCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginHorizontal: 20,
      marginTop: 16,
      paddingHorizontal: 16,
      height: 56,
      borderRadius: 20,
      backgroundColor: c.surface,
      borderWidth: scheme === 'dark' ? 0 : 1,
      borderColor: c.separator,
      ...cardShadow,
    },
    searchInput: { flex: 1, fontSize: 16, color: c.text, height: 56 },
    quickRow: { gap: 8, paddingHorizontal: 20, paddingVertical: 12 },
    quick: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 13, height: 36, borderRadius: 999, borderWidth: 1.5, borderColor: c.separator, backgroundColor: c.surface },
    quickText: { fontSize: 14, fontWeight: '700', color: c.text },
    cats: { gap: 10, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 4 },
    cat: { width: 76, alignItems: 'center', gap: 7 },
    catTile: { width: 72, height: 72, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 2.5, borderColor: 'transparent' },
    catText: { fontSize: 12.5, fontWeight: '600', color: c.text2 },
    section: { marginTop: 30, gap: 14 },
    sectionHead: { paddingHorizontal: 20, gap: 2 },
    sectionTitle: { fontSize: 23, fontWeight: '900', color: c.text, letterSpacing: -0.5 },
    sectionSub: { ...type.subhead, color: c.text2 },
    feedCard: { backgroundColor: c.surface, borderRadius: 28, overflow: 'hidden', borderWidth: scheme === 'dark' ? 0 : 1, borderColor: c.separator, ...cardShadow },
    feedImg: { width: '100%', aspectRatio: 4 / 3, backgroundColor: c.imageBg },
    badge360: { position: 'absolute', top: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(43,33,24,0.7)', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
    feedTitle: { flex: 1, fontSize: 18, fontWeight: '800', color: c.text, letterSpacing: -0.3 },
    pricePill: { flexDirection: 'row', alignItems: 'baseline', gap: 2, backgroundColor: c.accentSoft, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 },
    priceText: { fontSize: 16, fontWeight: '900', color: c.accent },
    priceDay: { fontSize: 12, fontWeight: '600', color: c.text2 },
    meta: { fontSize: 13.5, color: c.text2, flexShrink: 1 },
    metaStrong: { fontSize: 13.5, fontWeight: '800', color: c.text },
    shelfCard: { width: 164, backgroundColor: c.surface, borderRadius: 22, overflow: 'hidden', borderWidth: scheme === 'dark' ? 0 : 1, borderColor: c.separator, ...cardShadow },
    shelfImg: { width: 164, height: 130, backgroundColor: c.imageBg },
    shelfTitle: { fontSize: 14, fontWeight: '800', color: c.text },
    shelfPrice: { fontSize: 15, fontWeight: '900', color: c.text },
    clubBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      alignSelf: 'flex-start',
      marginHorizontal: 20,
      marginTop: 10,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: CLUB_GOLD + '1F',
      borderWidth: 1,
      borderColor: CLUB_GOLD + '55',
    },
    clubBannerText: { color: CLUB_GOLD, fontWeight: '800', fontSize: 13 },
    outsideNote: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 14, backgroundColor: c.warning + '18' },
    outsideNoteText: { flex: 1, fontSize: 13, color: c.text2, fontWeight: '600' },
  };
});
