import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { Image, NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, Text, View } from 'react-native';

import { FeaturedDiscount, mediaUrl, PromoSlide } from '../api';
import { useFeaturedDiscount } from './DiscountCodeField';
import { makeStyles, money, useTheme } from '../theme';

const SLIDE_H = 196;
const AUTO_MS = 5500;

/** The backend sends naive UTC datetimes ("2026-11-29T10:00:00"); treat them as UTC. */
export function parseUtc(s: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z');
}

export function daysLeft(until: string): number {
  return Math.max(0, Math.ceil((parseUtc(until).getTime() - Date.now()) / 86_400_000));
}

/** Black Friday = the day after the 4th Thursday of November. The slide runs from 1 November until Cyber Monday. */
export function blackFriday(now = new Date()): { label: string; live: boolean } | null {
  const y = now.getFullYear();
  const nov1 = new Date(y, 10, 1);
  const bfDay = 1 + ((4 - nov1.getDay() + 7) % 7) + 21 + 1;
  const bf = new Date(y, 10, bfDay);
  const cyberMonday = new Date(y, 10, bfDay + 3, 23, 59, 59);
  if (now < nov1 || now > cyberMonday) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((bf.getTime() - today.getTime()) / 86_400_000);
  if (days > 1) return { label: `Starts in ${days} days`, live: false };
  if (days === 1) return { label: 'Starts tomorrow', live: false };
  return { label: 'On now · until Cyber Monday', live: true };
}

type Slide =
  | { kind: 'blackfriday'; label: string; live: boolean }
  | { kind: 'sponsored'; promo: PromoSlide }
  | { kind: 'promote' }
  | { kind: 'earn' };

/**
 * Home-screen slideshow: seasonal campaign (Black Friday), listings people promote,
 * and two house ads (promote your thing / list a thing). Auto-advances; swipe to browse.
 */
export default function PromoCarousel({
  promos,
  onOpenItem,
  onDeals,
  onPromote,
  onList,
}: {
  promos: PromoSlide[];
  onOpenItem: (id: number) => void;
  onDeals: () => void;
  onPromote: () => void;
  onList: () => void;
}) {
  const s = useStyles();
  const { c } = useTheme();
  const [w, setW] = useState(0);
  const [idx, setIdx] = useState(0);
  const ref = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const pausedUntil = useRef(0);

  const bf = blackFriday();
  const slides: Slide[] = [
    ...(bf ? [{ kind: 'blackfriday' as const, ...bf }] : []),
    ...promos.map((p) => ({ kind: 'sponsored' as const, promo: p })),
    { kind: 'promote' },
    { kind: 'earn' },
  ];
  const n = slides.length;

  useEffect(() => {
    if (!w || n < 2) return;
    const t = setInterval(() => {
      if (Date.now() < pausedUntil.current) return;
      setIdx((i) => {
        const next = (i + 1) % n;
        ref.current?.scrollTo({ x: next * w, animated: true });
        return next;
      });
    }, AUTO_MS);
    return () => clearInterval(t);
  }, [w, n]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!w) return;
    const i = Math.round(e.nativeEvent.contentOffset.x / w);
    if (i !== idx && i >= 0 && i < n) setIdx(i);
  };
  const hold = () => {
    pausedUntil.current = Date.now() + 9000;
  };
  const goTo = (i: number) => {
    hold();
    setIdx(i);
    ref.current?.scrollTo({ x: i * w, animated: true });
  };

  return (
    <View style={s.wrap} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <ScrollView
        ref={ref}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={32}
        onScrollBeginDrag={hold}
        onTouchStart={hold}
        style={{ height: SLIDE_H }}
      >
        {w > 0 &&
          slides.map((sl) => (
            <View key={sl.kind === 'sponsored' ? `p${sl.promo.id}` : sl.kind} style={{ width: w, paddingHorizontal: 20 }}>
              {sl.kind === 'blackfriday' ? (
                <BlackFridaySlide label={sl.label} live={sl.live} onPress={onDeals} />
              ) : sl.kind === 'sponsored' ? (
                <SponsoredSlide promo={sl.promo} onPress={() => onOpenItem(sl.promo.id)} />
              ) : sl.kind === 'promote' ? (
                <Pressable onPress={onPromote} style={({ pressed }) => [s.slide, s.promoteSlide, pressed && s.pressed]} accessibilityRole="button">
                  <View style={{ flex: 1, gap: 5 }}>
                    <Text style={[s.kicker, { color: c.accent }]}>FOR OWNERS & BUSINESSES</Text>
                    <Text style={[s.title, { color: c.text }]}>Get seen first.</Text>
                    <Text style={[s.body, { color: c.text2 }]} numberOfLines={2}>
                      Put your listing or shop in this slideshow for up to 14 days.
                    </Text>
                    <View style={[s.cta, { backgroundColor: c.accent }]}>
                      <Text style={[s.ctaText, { color: c.onAccent }]}>Promote a listing</Text>
                      <Ionicons name="arrow-forward" size={15} color={c.onAccent} />
                    </View>
                  </View>
                  <View style={[s.badge, { backgroundColor: c.accentSoft }]}>
                    <Ionicons name="megaphone-outline" size={32} color={c.accent} />
                  </View>
                </Pressable>
              ) : (
                <Pressable onPress={onList} style={({ pressed }) => [s.slide, { backgroundColor: c.accent }, pressed && s.pressed]} accessibilityRole="button">
                  <View style={{ flex: 1, gap: 5 }}>
                    <Text style={[s.kicker, { color: c.onAccent, opacity: 0.8 }]}>EARN WITH RENTIFY</Text>
                    <Text style={[s.title, { color: c.onAccent }]}>Your shelf could pay rent.</Text>
                    <Text style={[s.body, { color: c.onAccent, opacity: 0.92 }]} numberOfLines={2}>
                      Lend the tools, cameras and gear you rarely use to people nearby.
                    </Text>
                    <View style={[s.cta, { backgroundColor: '#fff' }]}>
                      <Text style={[s.ctaText, { color: c.accent }]}>List a thing</Text>
                      <Ionicons name="arrow-forward" size={15} color={c.accent} />
                    </View>
                  </View>
                  <View style={[s.badge, { backgroundColor: 'rgba(255,255,255,0.22)' }]}>
                    <Ionicons name="cash-outline" size={32} color="#fff" />
                  </View>
                </Pressable>
              )}
            </View>
          ))}
      </ScrollView>
      {n > 1 && (
        <View style={s.dots}>
          {slides.map((_, i) => (
            <Pressable key={i} onPress={() => goTo(i)} hitSlop={6} accessibilityLabel={`Show slide ${i + 1}`}>
              <View style={[s.dot, { backgroundColor: i === idx ? c.text : c.text3 }, i === idx && { width: 18 }]} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

/** "Use BLACKFRIDAY for 20% off (max €10)" for the featured code, or null if there isn't one. */
export function codeLine(d: FeaturedDiscount | null): string | null {
  if (!d) return null;
  const pct = `${Math.round(d.percent_off)}% off`;
  const cap = d.max_off ? ` (up to €${d.max_off % 1 ? d.max_off.toFixed(2) : d.max_off})` : '';
  return d.live ? `Use code ${d.code} for ${pct} your rental${cap}.` : `Code ${d.code}: ${pct} from ${new Date(d.starts_on + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}${cap}.`;
}

function BlackFridaySlide({ label, live, onPress }: { label: string; live: boolean; onPress: () => void }) {
  const s = useStyles();
  const code = codeLine(useFeaturedDiscount());
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.slide, s.bf, pressed && s.pressed]} accessibilityRole="button">
      <Text style={s.bfGhost} numberOfLines={1}>
        %
      </Text>
      <View style={{ flex: 1, gap: 5 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={s.bfKicker}>BLACK FRIDAY</Text>
          <View style={[s.bfPill, live && { backgroundColor: '#FF453A' }]}>
            <Text style={s.bfPillText}>{label}</Text>
          </View>
        </View>
        <Text style={[s.title, { color: '#fff', fontSize: 24 }]}>Don’t buy it. Rent it.</Text>
        <Text style={[s.body, { color: 'rgba(255,255,255,0.72)' }]} numberOfLines={2}>
          {code ?? 'Skip the impulse buy. Borrow it from a neighbour for a few euros a day.'}
        </Text>
        <View style={[s.cta, { backgroundColor: '#fff' }]}>
          <Text style={[s.ctaText, { color: '#0E0B08' }]}>Deals under €15</Text>
          <Ionicons name="arrow-forward" size={15} color="#0E0B08" />
        </View>
      </View>
    </Pressable>
  );
}

/** A promoted listing as a full-bleed photo card. Also used as the live preview when promoting. */
export function SponsoredSlide({ promo, onPress }: { promo: Pick<PromoSlide, 'title' | 'tagline' | 'price_per_day' | 'owner_name' | 'cover_url'>; onPress?: () => void }) {
  const s = useStyles();
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [s.slide, s.sponsored, { backgroundColor: c.imageBg }, pressed && s.pressed]} accessibilityRole="button">
      {promo.cover_url ? <Image source={{ uri: mediaUrl(promo.cover_url) }} style={s.fill} resizeMode="cover" /> : null}
      <View style={[s.fill, { backgroundColor: 'rgba(20,14,8,0.28)' }]} />
      <View style={[s.shade, { height: '62%' }]} />
      <View style={[s.shade, { height: '38%' }]} />
      <View style={s.sponsorTag}>
        <Text style={s.sponsorTagText}>Sponsored</Text>
      </View>
      <View style={{ gap: 3, flex: 1 }}>
        <Text style={[s.title, { color: '#fff' }]} numberOfLines={2}>
          {promo.tagline || promo.title}
        </Text>
        <Text style={s.sponsorMeta} numberOfLines={1}>
          {promo.tagline ? `${promo.title} · ` : ''}
          {money(promo.price_per_day)}/day · {promo.owner_name}
        </Text>
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((c, scheme) => ({
  wrap: { marginTop: 26, gap: 10 },
  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  slide: { height: SLIDE_H, borderRadius: 26, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14, overflow: 'hidden' },
  pressed: { opacity: 0.92, transform: [{ scale: 0.985 }] },
  kicker: { fontSize: 11.5, fontWeight: '800', letterSpacing: 1.2 },
  title: { fontSize: 21, fontWeight: '900', letterSpacing: -0.4 },
  body: { fontSize: 14, lineHeight: 19 },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, marginTop: 6 },
  ctaText: { fontWeight: '800', fontSize: 14 },
  badge: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  promoteSlide: { backgroundColor: c.surface, borderWidth: 1, borderColor: c.separator },
  bf: { backgroundColor: '#0E0B08', borderWidth: scheme === 'dark' ? 1 : 0, borderColor: 'rgba(255,255,255,0.14)' },
  bfGhost: { position: 'absolute', right: -6, top: -38, fontSize: 210, fontWeight: '900', color: 'rgba(255,255,255,0.07)' },
  bfKicker: { color: '#fff', fontSize: 13, fontWeight: '900', letterSpacing: 2.4 },
  bfPill: { backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  bfPillText: { color: '#fff', fontSize: 11.5, fontWeight: '800' },
  sponsored: { alignItems: 'flex-end', padding: 16 },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
  shade: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(14,10,6,0.32)' },
  sponsorTag: { position: 'absolute', top: 14, left: 14, backgroundColor: 'rgba(255,255,255,0.88)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  sponsorTagText: { color: '#1B140D', fontSize: 11.5, fontWeight: '800' },
  sponsorMeta: { color: 'rgba(255,255,255,0.88)', fontSize: 13.5, fontWeight: '600' },
}));

export { SLIDE_H };
