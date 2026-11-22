import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { api, DiscountCheck, FeaturedDiscount } from '../api';
import { makeStyles, money, useTheme } from '../theme';

/** Last featured code from the server (e.g. BLACKFRIDAY), shared by the ads and this field. */
let featuredCache: FeaturedDiscount | null | undefined;
export async function loadFeaturedDiscount(): Promise<FeaturedDiscount | null> {
  if (featuredCache !== undefined) return featuredCache;
  try {
    featuredCache = await api.featuredDiscount();
  } catch {
    return null; // try again next time
  }
  return featuredCache;
}
export function useFeaturedDiscount(): FeaturedDiscount | null {
  const [d, setD] = useState<FeaturedDiscount | null>(featuredCache ?? null);
  useEffect(() => {
    let alive = true;
    loadFeaturedDiscount().then((x) => alive && setD(x));
    return () => {
      alive = false;
    };
  }, []);
  return d;
}

/**
 * "Have a discount code?" in the request sheet. Checks the code with the server for these dates
 * and shows the discount; the booking request then sends the applied code.
 */
export default function DiscountCodeField({
  itemId,
  start,
  end,
  applied,
  onApplied,
}: {
  itemId: number;
  start: string;
  end: string;
  applied: DiscountCheck | null;
  onApplied: (d: DiscountCheck | null) => void;
}) {
  const s = useStyles();
  const { c } = useTheme();
  const featured = useFeaturedDiscount();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = async (raw = code) => {
    if (!raw.trim()) return;
    setBusy(true);
    setError('');
    try {
      onApplied(await api.checkDiscount({ item_id: itemId, start_date: start, end_date: end, code: raw }));
      setOpen(false);
      setCode('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (applied) {
    return (
      <View style={s.sumRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
          <Ionicons name="pricetag" size={15} color={c.accent} />
          <Text style={[s.body, { color: c.accent, fontWeight: '700' }]} numberOfLines={1}>
            {applied.code} · {applied.percent_off % 1 ? applied.percent_off : Math.round(applied.percent_off)}% off
          </Text>
          <Pressable onPress={() => onApplied(null)} hitSlop={10} accessibilityLabel="Remove code">
            <Ionicons name="close-circle" size={18} color={c.text3} />
          </Pressable>
        </View>
        <Text style={[s.body, { color: c.accent, fontWeight: '700' }]}>−{money(applied.discount)}</Text>
      </View>
    );
  }

  const live = featured?.live ? featured : null;
  if (!open) {
    return (
      <Pressable onPress={() => setOpen(true)} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} accessibilityRole="button">
        <Ionicons name="pricetag-outline" size={15} color={c.accent} />
        <Text style={[s.body, { color: c.accent, fontWeight: '600' }]}>
          {live ? `${live.label || 'Deal'}: use ${live.code} for ${Math.round(live.percent_off)}% off` : 'Have a discount code?'}
        </Text>
      </Pressable>
    );
  }

  return (
    <View style={{ gap: 6 }}>
      <View style={s.row}>
        <TextInput
          value={code}
          onChangeText={(v) => {
            setCode(v.toUpperCase().replace(/\s/g, ''));
            setError('');
          }}
          placeholder={live ? live.code : 'Discount code'}
          placeholderTextColor={c.text3}
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus
          onSubmitEditing={() => apply()}
          style={s.input}
          accessibilityLabel="Discount code"
        />
        <Pressable onPress={() => apply()} disabled={busy || !code.trim()} style={[s.applyBtn, (!code.trim() || busy) && { opacity: 0.5 }]} accessibilityRole="button">
          {busy ? <ActivityIndicator color={c.onAccent} size="small" /> : <Text style={s.applyText}>Apply</Text>}
        </Pressable>
      </View>
      {live && !code && (
        <Pressable onPress={() => apply(live.code)} hitSlop={6}>
          <Text style={[s.small, { color: c.accent, fontWeight: '600' }]}>Use {live.code}</Text>
        </Pressable>
      )}
      {!!error && <Text style={[s.small, { color: c.danger, fontWeight: '600' }]}>{error}</Text>}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  body: { fontSize: 16, color: c.text },
  small: { fontSize: 13, color: c.text2 },
  row: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1,
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: c.separator,
    backgroundColor: c.surface,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 1,
    color: c.text,
  },
  applyBtn: { height: 44, paddingHorizontal: 18, borderRadius: 14, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' },
  applyText: { color: c.onAccent, fontWeight: '700', fontSize: 15 },
}));
