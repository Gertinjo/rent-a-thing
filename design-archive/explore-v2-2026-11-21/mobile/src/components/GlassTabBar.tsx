import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../theme';
import { Glass, IconName } from './ui';

export const TAB_ICONS: Record<string, [IconName, IconName]> = {
  Explore: ['compass-outline', 'compass'],
  Bookings: ['calendar-clear-outline', 'calendar-clear'],
  'My things': ['cube-outline', 'cube'],
  Profile: ['person-circle-outline', 'person-circle'],
};

/**
 * Floating "liquid glass" tab bar: a frosted capsule hovering over the content, with a
 * lighter glass lens that glides under the selected tab.
 */
export default function GlassTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { c, scheme } = useTheme();
  const [width, setWidth] = useState(0);
  const pos = useRef(new Animated.Value(state.index)).current;
  const press = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.spring(pos, { toValue: state.index, useNativeDriver: true, speed: 14, bounciness: 9 }).start();
    // a little "squish" of the lens as it lands, like liquid
    Animated.sequence([
      Animated.timing(press, { toValue: 1.12, duration: 110, useNativeDriver: true }),
      Animated.spring(press, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 12 }),
    ]).start();
  }, [state.index, pos, press]);

  const n = state.routes.length;
  const pad = 6;
  const seg = width > 0 ? (width - pad * 2) / n : 0;

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: Math.max(insets.bottom, 12) + 6 }]}>
      <Glass radius={34} intensity={55} style={styles.bar}>
        <View style={styles.row} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          {seg > 0 && (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.lens,
                {
                  width: seg,
                  left: pad,
                  backgroundColor: scheme === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.75)',
                  borderColor: scheme === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.04)',
                  transform: [{ translateX: Animated.multiply(pos, seg) }, { scaleX: press }],
                },
              ]}
            />
          )}
          {state.routes.map((route, i) => {
            const focused = state.index === i;
            const { options } = descriptors[route.key];
            const label = (options.tabBarLabel as string) ?? options.title ?? route.name;
            const [off, on] = TAB_ICONS[route.name] ?? ['ellipse-outline', 'ellipse'];
            const badge = options.tabBarBadge;
            const color = focused ? c.accent : c.text;
            return (
              <Pressable
                key={route.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={label}
                onPress={() => {
                  const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                  if (!focused && !e.defaultPrevented) navigation.navigate(route.name, route.params);
                }}
                style={styles.item}
              >
                <View>
                  <Ionicons name={focused ? on : off} size={24} color={color} />
                  {badge != null && (
                    <View style={[styles.badge, { backgroundColor: c.danger, borderColor: c.surface }]}>
                      <Text style={styles.badgeText}>{badge}</Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.label, { color, fontWeight: focused ? '700' : '500' }]} numberOfLines={1}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Glass>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  bar: { width: '92%', maxWidth: 420 },
  row: { flexDirection: 'row', padding: 6, height: 68 },
  lens: { position: 'absolute', top: 6, bottom: 6, borderRadius: 28, borderWidth: StyleSheet.hairlineWidth },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  label: { fontSize: 10.5, letterSpacing: 0.1 },
  badge: {
    position: 'absolute',
    top: -4,
    right: -10,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
});
