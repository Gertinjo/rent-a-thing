import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { View } from 'react-native';

import { useTheme } from '../theme';

/** The Rentify logo: a rounded accent square with a white cube. The app icons and favicons are made from the same shape. */
export default function LogoMark({ size = 34 }: { size?: number }) {
  const { c } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, borderRadius: size * (11 / 34), backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center' }}
    >
      <Ionicons name="cube" size={Math.round(size * 0.53)} color={c.onAccent} />
    </View>
  );
}
