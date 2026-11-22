import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, Item } from '../api';
import { Alert } from '../platform';
import { makeStyles, money, type, useTheme } from '../theme';
import { CardPayment, DemoPaymentBadge } from './PaymentSheet';
import { daysLeft, SponsoredSlide } from './PromoCarousel';
import { Button, Field, Segmented } from './ui';

type Plan = { days: number; price: number };
/** Same as GET /items/promotion-plans, so the sheet shows prices before (or without) that request. */
let cachedPlans: Plan[] = [
  { days: 3, price: 15 },
  { days: 7, price: 29 },
  { days: 14, price: 49 },
];
const planLabel = (d: number) => (d === 7 ? '1 week' : d === 14 ? '2 weeks' : `${d} days`);

/**
 * Bottom sheet to promote a listing in the home slideshow. Step 1: headline, duration (priced) and a
 * live preview. Step 2: card payment (Stripe test mode, or the demo form). An admin then reviews it;
 * approved -> live in the slideshow, rejected -> refunded with a reason.
 */
export default function PromoteSheet({ item, onClose, onChanged }: { item: Item | null; onClose: () => void; onChanged: (i: Item) => void }) {
  const s = useStyles();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [plans, setPlans] = useState<Plan[]>(cachedPlans);
  const [tagline, setTagline] = useState('');
  const [days, setDays] = useState('7');
  const [step, setStep] = useState<'setup' | 'pay'>('setup');
  const [busy, setBusy] = useState(false);
  // The unpaid order for the current choice, reused after a declined demo card.
  const order = useRef<{ key: string; id: number } | null>(null);
  const left = item?.promo_until ? daysLeft(item.promo_until) : 0;
  const running = left > 0;
  const plan = plans.find((p) => String(p.days) === days) ?? plans[0];

  useEffect(() => {
    if (!item) return;
    setTagline(item.promo_tagline ?? '');
    setDays('7');
    setStep('setup');
    order.current = null;
    api
      .promotionPlans()
      .then((r) => {
        cachedPlans = r.plans;
        setPlans(r.plans);
      })
      .catch(() => {}); // keep the bundled prices; the server decides the real amount anyway
  }, [item]);

  if (!item) return null;

  const createOrder = async () => {
    const key = `${plan.days}|${tagline.trim()}`;
    if (order.current?.key === key) return { promotion_id: order.current.id, mode: 'simulated' as const, url: undefined };
    const r = await api.promote(item.id, { tagline: tagline.trim(), days: plan.days });
    order.current = { key, id: r.promotion_id };
    return r;
  };

  const paid = (updated: Item) => {
    onChanged(updated);
    onClose();
    Alert.alert('Payment done', `Our team will check your promotion for ${updated.title}, usually within a day. If it isn’t approved, you get a full refund.`);
  };
  const inReview = item.promo_review === 'pending';
  const rejectedNote = item.promo_review === 'rejected' ? item.promo_review_note : '';

  const simple = async (fn: () => Promise<Item>, done: string) => {
    setBusy(true);
    try {
      onChanged(await fn());
      onClose();
      Alert.alert(done);
    } catch (e: any) {
      Alert.alert('Couldn’t update the promotion', e.message);
    } finally {
      setBusy(false);
    }
  };

  const stop = () =>
    Alert.alert('Stop the promotion?', 'It leaves the slideshow now. Days already paid for aren’t refunded.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Stop', style: 'destructive', onPress: () => simple(() => api.stopPromotion(item.id), 'Promotion stopped') },
    ]);


  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[s.sheet, { paddingBottom: insets.bottom + 16, maxHeight: height * 0.9 }]}>
          <View style={s.grabber} />
          {step === 'setup' ? (
            <ScrollView contentContainerStyle={{ gap: 14 }} keyboardShouldPersistTaps="handled">
              <View style={{ gap: 2 }}>
                <Text style={s.title}>Promote on Home</Text>
                <Text style={s.sub}>
                  {running
                    ? `Live in the slideshow · ${left} ${left === 1 ? 'day' : 'days'} left`
                    : 'Show this listing in the slideshow at the top of Explore.'}
                </Text>
              </View>

              {inReview && (
                <View style={[s.banner, { backgroundColor: c.warning + '1A' }]}>
                  <Ionicons name="time-outline" size={18} color={c.warning} />
                  <Text style={[s.bannerText, { color: c.text }]}>Paid and waiting for our team to approve it. We’ll notify you; if it’s not approved, you’re refunded.</Text>
                </View>
              )}
              {!!rejectedNote && !inReview && (
                <View style={[s.banner, { backgroundColor: c.danger + '14' }]}>
                  <Ionicons name="alert-circle-outline" size={18} color={c.danger} />
                  <Text style={[s.bannerText, { color: c.text }]}>
                    Your last promotion wasn’t approved: {rejectedNote} You were refunded.
                  </Text>
                </View>
              )}

              <SponsoredSlide promo={{ title: item.title, tagline: tagline.trim(), price_per_day: item.price_per_day, owner_name: item.owner.name, cover_url: item.cover_url }} />

              <Field
                label="Headline (optional)"
                value={tagline}
                onChangeText={setTagline}
                maxLength={80}
                placeholder="e.g. Black Friday: 30% off all weekend"
                hint={`Your offer, or your shop’s name. ${80 - tagline.length} characters left.`}
              />

              <View style={{ gap: 6 }}>
                <Text style={s.label}>{running ? 'Add more time' : 'Run for'}</Text>
                <Segmented
                  value={days}
                  onChange={setDays}
                  options={plans.map((p) => ({ value: String(p.days), label: `${planLabel(p.days)} · ${money(p.price)}` }))}
                />
              </View>

              <Text style={s.note}>
Every promotion is checked by our team before it goes live, usually within a day. Not approved means a full refund. {running ? 'Paid days are added to the time left. ' : ''}Up to 3 at a time.
              </Text>

              <Button title={`Continue · ${money(plan.price)}`} icon="card-outline" disabled={inReview} onPress={() => setStep('pay')} />
              {running ? <Button title="Stop promotion" variant="destructive" disabled={busy} onPress={stop} /> : <Button title="Cancel" variant="plain" onPress={onClose} />}
            </ScrollView>
          ) : (
            <ScrollView contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
              <Pressable onPress={() => setStep('setup')} hitSlop={8} style={s.back} accessibilityRole="button">
                <Ionicons name="chevron-back" size={18} color={c.accent} />
                <Text style={s.backText}>Back</Text>
              </Pressable>
              <DemoPaymentBadge />
              <View style={{ gap: 2 }}>
                <Text style={s.title}>Pay {money(plan.price)}</Text>
                <Text style={s.sub} numberOfLines={1}>
                  Home slideshow · {planLabel(plan.days)} · {item.title}
                </Text>
              </View>
              <CardPayment
                amount={plan.price}
                resetKey={`${item.id}-${step}`}
                onStripe={async () => {
                  order.current = null; // every Stripe Checkout gets its own order
                  const r = await api.promote(item.id, { tagline: tagline.trim(), days: plan.days });
                  return r.mode === 'stripe' ? r.url : undefined;
                }}
                onDemo={async (card) => {
                  const r = await createOrder();
                  paid(await api.demoPayPromotion(item.id, r.promotion_id, card));
                }}
              />
              <Text style={[s.note, { textAlign: 'center' }]}>After payment our team checks the photo and headline, then it goes live. Not approved means a full refund.</Text>
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  backdrop: { flex: 1, backgroundColor: c.overlay },
  sheet: { backgroundColor: c.bg, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 20, paddingTop: 10, gap: 12 },
  grabber: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: c.text3 },
  title: { ...type.title2, color: c.text },
  sub: { ...type.subhead, color: c.text2 },
  label: { ...type.footnote, color: c.text2, fontWeight: '600', marginLeft: 4 },
  note: { ...type.footnote, color: c.text2, lineHeight: 18 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' },
  backText: { color: c.accent, fontWeight: '600', fontSize: 16 },
  banner: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: 14 },
  bannerText: { ...type.subhead, flex: 1, lineHeight: 19 },
}));
