import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { lenderTerms } from '../content';
import { makeStyles, type, useTheme } from '../theme';
import { Button } from './ui';

/**
 * Pop-up shown when someone adds a product: the lender terms (incl. the service fee) and an
 * "I agree" checkbox. The listing is only created after they agree.
 */
export default function LenderTermsModal({
  visible,
  feePercent,
  onAgree,
  onCancel,
  onReadFull,
}: {
  visible: boolean;
  feePercent: number;
  onAgree: () => void;
  onCancel: () => void;
  onReadFull: () => void;
}) {
  const { c } = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (visible) setChecked(false); // ask again every time a product is added
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={s.backdrop} onPress={onCancel} />
      <View style={[s.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={s.grabber} />
        <Text style={s.title}>Before you list</Text>
        <Text style={s.sub}>Please read and accept the lender terms.</Text>
        <ScrollView style={{ maxHeight: 380 }} contentContainerStyle={{ gap: 14, paddingVertical: 6 }}>
          {lenderTerms(feePercent).map((t, i) => (
            <View key={t.title} style={[s.row, i === 0 && s.feeRow]}>
              <View style={[s.icon, i === 0 && { backgroundColor: c.accent }]}>
                <Ionicons name={t.icon as any} size={18} color={i === 0 ? c.onAccent : c.text} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.rowTitle}>{t.title}</Text>
                <Text style={s.rowText}>{t.text}</Text>
              </View>
            </View>
          ))}
          <Pressable onPress={onReadFull} hitSlop={8}>
            <Text style={s.link}>Read the full Terms of Service</Text>
          </Pressable>
        </ScrollView>

        <Pressable style={s.check} onPress={() => setChecked((x) => !x)} accessibilityRole="checkbox" accessibilityState={{ checked }}>
          <View style={[s.box, checked && { backgroundColor: c.accent, borderColor: c.accent }]}>
            {checked && <Ionicons name="checkmark" size={16} color={c.onAccent} />}
          </View>
          <Text style={s.checkText}>I have read and agree to the lender terms and the Terms of Service.</Text>
        </Pressable>
        <Button title="Agree and continue" onPress={onAgree} disabled={!checked} />
        <Button title="Cancel" variant="plain" onPress={onCancel} />
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  backdrop: { flex: 1, backgroundColor: c.overlay },
  sheet: { backgroundColor: c.bg, borderTopLeftRadius: 30, borderTopRightRadius: 30, paddingHorizontal: 20, paddingTop: 10, gap: 12 },
  grabber: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: c.text3 },
  title: { ...type.title2, color: c.text },
  sub: { ...type.subhead, color: c.text2, marginTop: -6 },
  row: { flexDirection: 'row', gap: 12 },
  feeRow: { backgroundColor: c.accentSoft, borderRadius: 16, padding: 12 },
  icon: { width: 34, height: 34, borderRadius: 10, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { ...type.headline, fontSize: 16, color: c.text },
  rowText: { ...type.subhead, color: c.text2, lineHeight: 19 },
  link: { color: c.accent, fontWeight: '600', fontSize: 15, marginTop: 2 },
  check: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: c.fill, borderRadius: 16, padding: 14 },
  box: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: c.text2, alignItems: 'center', justifyContent: 'center' },
  checkText: { ...type.subhead, color: c.text, flex: 1, lineHeight: 19 },
}));
