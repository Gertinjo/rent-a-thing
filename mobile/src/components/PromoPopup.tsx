import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Modal, Pressable, Text, View } from 'react-native';

import type { Me } from '../api';
import { isWeb, storage } from '../platform';
import { makeStyles, useTheme } from '../theme';
import { useFeaturedDiscount } from './DiscountCodeField';
import { blackFriday, codeLine } from './PromoCarousel';
import { Button } from './ui';

/**
 * Occasional pop-up on Explore that promotes something in the app (Black Friday, promoting a listing,
 * Rent Club, this weekend, listing a thing).
 *
 * How often ("not too often, but normal"):
 * - never during someone's first visit,
 * - at most once every 20 hours,
 * - only after 8 seconds on Explore, and not while they're searching or filtering,
 * - the next one in the rotation each time, so the same pop-up doesn't repeat back to back.
 * On the web, add ?popup=1 to the URL to see one right away (for testing).
 */

const KEY = 'rentify.promoPopup';
const GAP_MS = 20 * 60 * 60 * 1000;
const DELAY_MS = 8000;
const CLUB_MIN_RENTALS = 5;

type Kind = 'blackfriday' | 'promote' | 'club' | 'weekend' | 'list';
type Saved = { last: number; next: number; visits: number };
let countedThisVisit = false; // one "visit" per app start, not per Explore focus

export type PromoActions = { onDeals: () => void; onWeekend: () => void; onPromote: () => void; onList: () => void; onClub: () => void };

async function load(): Promise<Saved> {
  try {
    const raw = await storage.get(KEY);
    if (raw) return { last: 0, next: 0, visits: 0, ...JSON.parse(raw) };
  } catch {
    /* private mode or bad JSON: start fresh */
  }
  return { last: 0, next: 0, visits: 0 };
}
const save = (s: Saved) => storage.set(KEY, JSON.stringify(s)).catch(() => {});

function forced(): boolean {
  if (!isWeb || typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('popup') === '1';
}

export default function PromoPopup({ user, paused, actions }: { user: Me | null; paused: boolean; actions: PromoActions }) {
  const s = useStyles();
  const { c } = useTheme();
  const [kind, setKind] = useState<Kind | null>(null);
  const scale = useRef(new Animated.Value(0.92)).current;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const bf = blackFriday();
  const featured = useFeaturedDiscount();
  const rentals = user?.rental_count ?? 0;
  // Always-available pop-ups, in turn. Black Friday is added on top while it's on.
  const rotation: Kind[] = [
    'promote',
    ...(user && !user.club_member ? (['club'] as const) : []),
    'weekend',
    'list',
  ];

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      const saved = await load();
      if (!countedThisVisit) {
        countedThisVisit = true;
        saved.visits += 1;
        await save(saved);
      }
      const force = forced();
      if (!force && (saved.visits < 2 || Date.now() - saved.last < GAP_MS)) return;
      timer = setTimeout(async () => {
        if (!alive || pausedRef.current) return;
        // Black Friday jumps the queue while it's on; otherwise take turns.
        const pick = bf && saved.next % 2 === 0 ? 'blackfriday' : rotation[Math.floor(bf ? saved.next / 2 : saved.next) % rotation.length];
        await save({ ...saved, last: Date.now(), next: saved.next + 1 });
        if (alive) setKind(pick);
      }, force ? 600 : DELAY_MS);
    })();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
    // Runs once per Explore mount; the 20-hour gap does the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (kind) Animated.spring(scale, { toValue: 1, useNativeDriver: true, bounciness: 8, speed: 14 }).start();
    else scale.setValue(0.92);
  }, [kind, scale]);

  if (!kind) return null;
  const close = () => setKind(null);
  const go = (fn: () => void) => () => {
    close();
    setTimeout(fn, 150);
  };

  const left = Math.max(0, CLUB_MIN_RENTALS - rentals);
  const content: Record<Kind, { icon: keyof typeof Ionicons.glyphMap; kicker: string; title: string; text: string; cta: string; onPress: () => void; dark?: boolean }> = {
    blackfriday: {
      icon: 'pricetags',
      kicker: `BLACK FRIDAY · ${bf?.label.toUpperCase() ?? ''}`,
      title: 'Don’t buy it. Rent it.',
      text: `That gadget you’d use twice? Borrow it from a neighbour instead.${featured ? ` ${codeLine(featured)}` : ''}`,
      cta: 'See deals under €15',
      onPress: actions.onDeals,
      dark: true,
    },
    promote: {
      icon: 'megaphone',
      kicker: 'FOR OWNERS & BUSINESSES',
      title: 'Get your listing seen first',
      text: 'Put your thing or your shop at the top of Home, in the slideshow everyone sees. From €15 for 3 days.',
      cta: 'Promote a listing',
      onPress: actions.onPromote,
    },
    club: {
      icon: 'ribbon',
      kicker: 'RENT CLUB',
      title: left ? `${left} more ${left === 1 ? 'rental' : 'rentals'} to join` : 'You’re almost in',
      text: `Rent ${CLUB_MIN_RENTALS} times and you join Rent Club: a gold badge and the members’ chat with Rentify’s most active neighbours.`,
      cta: 'What’s Rent Club?',
      onPress: actions.onClub,
    },
    weekend: {
      icon: 'calendar',
      kicker: 'THIS WEEKEND',
      title: 'Plans this weekend?',
      text: 'Tents, bikes, cameras and tools nearby are still free for Saturday and Sunday. Book before they’re gone.',
      cta: 'See what’s free',
      onPress: actions.onWeekend,
    },
    list: {
      icon: 'cash',
      kicker: 'EARN WITH RENTIFY',
      title: 'Your shelf could pay rent',
      text: 'List the things you rarely use. It takes two minutes, and neighbours pay to borrow them.',
      cta: 'List a thing',
      onPress: actions.onList,
    },
  };
  const p = content[kind];
  const dark = !!p.dark;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <View style={s.center}>
        <Pressable style={s.backdrop} onPress={close} accessibilityLabel="Close" />
        <Animated.View style={[s.card, dark && s.cardDark, { transform: [{ scale }] }]} accessibilityViewIsModal>
          <View style={[s.art, { backgroundColor: dark ? '#1E1812' : c.accentSoft }]}>
            {dark && <Text style={s.ghost}>%</Text>}
            {kind === 'blackfriday' && featured && (
              <View style={s.ticket}>
                <Text style={s.ticketText}>{featured.code}</Text>
              </View>
            )}
            {kind === 'club' && (
              <View style={s.progress}>
                {Array.from({ length: CLUB_MIN_RENTALS }).map((_, i) => (
                  <View key={i} style={[s.step, { backgroundColor: i < rentals ? c.accent : c.separator }]} />
                ))}
              </View>
            )}
            <View style={[s.iconCircle, { backgroundColor: dark ? '#fff' : c.accent }]}>
              <Ionicons name={p.icon} size={34} color={dark ? '#0E0B08' : c.onAccent} />
            </View>
          </View>
          <Pressable onPress={close} hitSlop={10} style={[s.x, { backgroundColor: dark ? 'rgba(255,255,255,0.14)' : c.fill }]} accessibilityLabel="Close">
            <Ionicons name="close" size={18} color={dark ? '#fff' : c.text2} />
          </Pressable>
          <View style={s.body}>
            <Text style={[s.kicker, { color: dark ? 'rgba(255,255,255,0.7)' : c.accent }]}>{p.kicker}</Text>
            <Text style={[s.title, { color: dark ? '#fff' : c.text }]}>{p.title}</Text>
            <Text style={[s.text, { color: dark ? 'rgba(255,255,255,0.75)' : c.text2 }]}>{p.text}</Text>
            <View style={{ gap: 4, marginTop: 10 }}>
              {dark ? (
                <Pressable onPress={go(p.onPress)} style={({ pressed }) => [s.darkBtn, pressed && { opacity: 0.85 }]} accessibilityRole="button">
                  <Text style={s.darkBtnText}>{p.cta}</Text>
                </Pressable>
              ) : (
                <Button title={p.cta} onPress={go(p.onPress)} />
              )}
              <Pressable onPress={close} style={s.later} accessibilityRole="button">
                <Text style={[s.laterText, { color: dark ? 'rgba(255,255,255,0.7)' : c.text2 }]}>Not now</Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: c.overlay },
  card: { width: '100%', maxWidth: 360, borderRadius: 30, backgroundColor: c.bg, overflow: 'hidden' },
  cardDark: { backgroundColor: '#0E0B08' },
  art: { height: 160, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  ghost: { position: 'absolute', right: -10, top: -60, fontSize: 240, fontWeight: '900', color: 'rgba(255,255,255,0.06)' },
  iconCircle: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  progress: { position: 'absolute', bottom: 16, flexDirection: 'row', gap: 6 },
  step: { width: 26, height: 6, borderRadius: 3 },
  ticket: { marginTop: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.55)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 4 },
  ticketText: { color: '#fff', fontSize: 14, fontWeight: '900', letterSpacing: 2 },
  x: { position: 'absolute', top: 12, right: 12, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 22, paddingTop: 18, gap: 6 },
  kicker: { fontSize: 11.5, fontWeight: '800', letterSpacing: 1.2 },
  title: { fontSize: 24, fontWeight: '900', letterSpacing: -0.5 },
  text: { fontSize: 15, lineHeight: 21 },
  darkBtn: { height: 52, borderRadius: 26, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  darkBtnText: { color: '#0E0B08', fontSize: 17, fontWeight: '700' },
  later: { height: 40, alignItems: 'center', justifyContent: 'center' },
  laterText: { fontSize: 15, fontWeight: '600' },
}));
