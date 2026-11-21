import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, Booking, PaymentConfig } from '../api';
import { isWeb } from '../platform';
import { makeStyles, money, type, useTheme } from '../theme';
import { Button } from './ui';

/** Formats "4242424242424242" as "4242 4242 4242 4242" while typing. */
const groupCard = (v: string) => v.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
const groupExp = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
};

/**
 * Card payment for a confirmed booking. DEMO ONLY:
 * - Stripe mode (server has an sk_test_ key): opens Stripe Checkout in test mode.
 * - Simulated mode (no key): a built-in card form that accepts Stripe's test card numbers.
 */
export default function PaymentSheet({ booking, onClose, onPaid }: { booking: Booking | null; onClose: () => void; onPaid: (b: Booking) => void }) {
  const { c } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const [cfg, setCfg] = useState<PaymentConfig | null>(null);
  const [number, setNumber] = useState('');
  const [exp, setExp] = useState('');
  const [cvc, setCvc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!booking) return;
    setNumber('');
    setExp('');
    setCvc('');
    setError('');
    api.paymentConfig().then(setCfg).catch(() => setCfg(null));
  }, [booking]);

  if (!booking) return null;

  const payStripe = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api.startPayment(booking.id);
      if (r.mode === 'stripe' && r.url) {
        // Stripe hosts the card page; it sends the browser back to /?payment=success... (see usePaymentReturn)
        if (isWeb) window.location.href = r.url;
        else await Linking.openURL(r.url);
      } else setCfg((x) => (x ? { ...x, mode: 'simulated' } : x));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const payDemo = async () => {
    setBusy(true);
    setError('');
    try {
      onPaid(await api.demoPayment(booking.id, { number, exp, cvc }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const fill = (n: string) => {
    setNumber(n);
    setExp('12/34');
    setCvc('123');
    setError('');
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <View style={[s.sheet, { paddingBottom: insets.bottom + 20 }]}>
        <View style={s.grabber} />
        <View style={s.demo}>
          <Ionicons name="flask" size={14} color={c.warning} />
          <Text style={s.demoText}>DEMO PAYMENT · no real money is charged</Text>
        </View>
        <Text style={s.title}>Pay {money(booking.total_price)}</Text>
        <Text style={s.sub} numberOfLines={1}>
          {booking.item.title} · {booking.days} day{booking.days > 1 ? 's' : ''}
        </Text>

        {!cfg ? (
          <ActivityIndicator color={c.text2} style={{ marginVertical: 30 }} />
        ) : cfg.mode === 'stripe' ? (
          <View style={{ gap: 12 }}>
            <View style={s.stripeBox}>
              <Ionicons name="lock-closed" size={18} color={c.text2} />
              <Text style={[s.sub, { flex: 1 }]}>You’ll go to Stripe’s secure checkout (test mode), then come straight back here.</Text>
            </View>
            <Text style={s.hint}>Test card: 4242 4242 4242 4242 · any future date · any CVC</Text>
            <Button title="Continue to Stripe" icon="card" onPress={payStripe} loading={busy} />
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            <View style={s.cardField}>
              <Ionicons name="card-outline" size={20} color={c.text2} />
              <TextInput
                value={number}
                onChangeText={(v) => setNumber(groupCard(v))}
                placeholder="Card number"
                placeholderTextColor={c.text3}
                keyboardType="number-pad"
                autoComplete="off"
                style={s.input}
                accessibilityLabel="Card number"
              />
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TextInput
                value={exp}
                onChangeText={(v) => setExp(groupExp(v))}
                placeholder="MM/YY"
                placeholderTextColor={c.text3}
                keyboardType="number-pad"
                style={[s.cardField, s.input, { flex: 1 }]}
                accessibilityLabel="Expiry date"
              />
              <TextInput
                value={cvc}
                onChangeText={(v) => setCvc(v.replace(/\D/g, '').slice(0, 4))}
                placeholder="CVC"
                placeholderTextColor={c.text3}
                keyboardType="number-pad"
                secureTextEntry
                style={[s.cardField, s.input, { flex: 1 }]}
                accessibilityLabel="CVC"
              />
            </View>
            <Text style={s.hint}>Tap a test card:</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {cfg.test_cards.map((t) => (
                <Pressable key={t.number} onPress={() => fill(t.number)} style={s.chip}>
                  <Text style={s.chipText}>
                    ••{t.number.slice(-4)} · {t.result}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Button title={`Pay ${money(booking.total_price)}`} icon="lock-closed" onPress={payDemo} loading={busy} disabled={number.replace(/\s/g, '').length < 15 || exp.length < 5 || cvc.length < 3} />
          </View>
        )}
        {!!error && (
          <View style={s.error}>
            <Ionicons name="alert-circle" size={18} color={c.danger} />
            <Text style={{ color: c.danger, flex: 1, fontWeight: '600' }}>{error}</Text>
          </View>
        )}
        <Text style={[s.hint, { textAlign: 'center' }]}>Cancel before the start date and you’re refunded automatically.</Text>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  backdrop: { flex: 1, backgroundColor: c.overlay },
  sheet: { backgroundColor: c.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, gap: 12 },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: c.separator, marginBottom: 4 },
  demo: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: c.warning + '1F' },
  demoText: { color: c.warning, fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  title: { ...type.title2, color: c.text },
  sub: { fontSize: 14, color: c.text2 },
  stripeBox: { flexDirection: 'row', gap: 10, alignItems: 'center', padding: 12, borderRadius: 14, backgroundColor: c.fill },
  cardField: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 50, paddingHorizontal: 14, borderRadius: 14, backgroundColor: c.surface, borderWidth: 1, borderColor: c.separator },
  input: { flex: 1, fontSize: 17, color: c.text, letterSpacing: 1 },
  hint: { fontSize: 12, color: c.text2 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: c.separator, backgroundColor: c.surface },
  chipText: { fontSize: 12, fontWeight: '700', color: c.text },
  error: { flexDirection: 'row', gap: 8, alignItems: 'center', padding: 12, borderRadius: 14, backgroundColor: c.danger + '14' },
}));
