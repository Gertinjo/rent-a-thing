import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { mediaUrl } from '../api';
import { makeStyles, type, useTheme } from '../theme';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

// ---------------------------------------------------------------------------
// Glass — frosted, translucent surface with a soft specular edge (iOS "liquid glass").
// ---------------------------------------------------------------------------

export function Glass({
  children,
  style,
  radius = 28,
  intensity = 45,
  shadow = true,
}: {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  intensity?: number;
  shadow?: boolean;
}) {
  const { c, scheme } = useTheme();
  const tint =
    Platform.OS === 'ios' ? (scheme === 'dark' ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight') : scheme;
  return (
    <View
      style={[
        { borderRadius: radius },
        shadow && {
          shadowColor: '#000',
          shadowOpacity: scheme === 'dark' ? 0.5 : 0.12,
          shadowRadius: 24,
          shadowOffset: { width: 0, height: 8 },
          elevation: 8,
        },
        style,
      ]}
    >
      <View style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]} pointerEvents="none">
        <BlurView intensity={intensity} tint={tint as any} style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: c.glassTint }]} />
        {/* specular rim: bright top edge, faint everywhere else */}
        <View
          style={[
            StyleSheet.absoluteFill,
            { borderRadius: radius, borderWidth: 1, borderColor: c.glassBorder, borderBottomColor: 'transparent' },
          ]}
        />
      </View>
      {children}
    </View>
  );
}

/** Round glass button for floating controls (back, close, share…). */
export function GlassIconButton({
  icon,
  onPress,
  size = 40,
  label,
}: {
  icon: IconName;
  onPress: () => void;
  size?: number;
  label?: string;
}) {
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={label}>
      {({ pressed }) => (
        <Glass radius={size / 2} style={{ width: size, height: size, transform: [{ scale: pressed ? 0.92 : 1 }] }}>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={icon} size={size * 0.5} color={c.text} />
          </View>
        </Glass>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  icon,
  style,
  size = 'large',
}: {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'plain' | 'destructive' | 'danger' | 'glass';
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  size?: 'large' | 'small';
}) {
  const { c } = useTheme();
  const v = {
    primary: { bg: c.accent, fg: c.onAccent },
    secondary: { bg: c.fill, fg: c.text },
    plain: { bg: 'transparent', fg: c.accent },
    destructive: { bg: 'transparent', fg: c.danger },
    danger: { bg: c.danger, fg: '#FFFFFF' },
    glass: { bg: 'transparent', fg: c.text },
  }[variant];
  const off = disabled || loading;
  const h = size === 'large' ? 52 : 36;
  const content = loading ? (
    <ActivityIndicator color={v.fg} />
  ) : (
    <>
      {icon && <Ionicons name={icon} size={size === 'large' ? 19 : 16} color={v.fg} />}
      <Text style={{ color: v.fg, fontSize: size === 'large' ? 17 : 15, fontWeight: '600', letterSpacing: -0.2 }}>
        {title}
      </Text>
    </>
  );
  return (
    <Pressable onPress={onPress} disabled={off} style={style} accessibilityRole="button">
      {({ pressed }) =>
        variant === 'glass' ? (
          <Glass radius={h / 2} style={{ height: h, opacity: off ? 0.5 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }}>
            <View style={[btn.inner, { height: h, paddingHorizontal: size === 'large' ? 22 : 14 }]}>{content}</View>
          </Glass>
        ) : (
          <View
            style={[
              btn.inner,
              {
                height: h,
                borderRadius: h / 2,
                paddingHorizontal: size === 'large' ? 22 : 14,
                backgroundColor: v.bg,
                opacity: off ? 0.45 : pressed ? 0.75 : 1,
                transform: [{ scale: pressed ? 0.98 : 1 }],
              },
            ]}
          >
            {content}
          </View>
        )
      }
    </Pressable>
  );
}
const btn = StyleSheet.create({
  inner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
});

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export function Field({ label, hint, style, ...rest }: TextInputProps & { label?: string; hint?: string }) {
  const s = useFieldStyles();
  const { c } = useTheme();
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      {label && <Text style={s.label}>{label}</Text>}
      <TextInput
        placeholderTextColor={c.text3}
        selectionColor={c.accent}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={[s.input, focus && { borderColor: c.accent }, style]}
        {...rest}
      />
      {hint && <Text style={s.hint}>{hint}</Text>}
    </View>
  );
}
const useFieldStyles = makeStyles((c) => ({
  label: { ...type.footnote, color: c.text2, fontWeight: '600', marginLeft: 4 },
  input: {
    backgroundColor: c.fill,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'transparent',
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 17,
    color: c.text,
  },
  hint: { ...type.footnote, color: c.text2, marginLeft: 4 },
}));

// ---------------------------------------------------------------------------
// Segmented control (glass, with a sliding thumb)
// ---------------------------------------------------------------------------

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: { value: T; label: string; badge?: number }[];
  value: T;
  onChange: (v: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  const [w, setW] = useState(0);
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  const x = useRef(new Animated.Value(idx)).current;
  useEffect(() => {
    Animated.spring(x, { toValue: idx, useNativeDriver: true, bounciness: 6, speed: 16 }).start();
  }, [idx, x]);
  const seg = (w - 8) / options.length;
  return (
    <View
      style={[{ backgroundColor: c.fill, borderRadius: 999, padding: 4, flexDirection: 'row' }, style]}
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
    >
      {w > 0 && (
        <Animated.View
          style={{
            position: 'absolute',
            top: 4,
            bottom: 4,
            left: 4,
            width: seg,
            borderRadius: 999,
            backgroundColor: c.surface,
            shadowColor: '#000',
            shadowOpacity: 0.12,
            shadowRadius: 6,
            shadowOffset: { width: 0, height: 2 },
            elevation: 2,
            transform: [{ translateX: Animated.multiply(x, seg) }],
          }}
        />
      )}
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => onChange(o.value)} style={{ flex: 1, paddingVertical: 8, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ ...type.subhead, fontWeight: '600', color: o.value === value ? c.text : c.text2 }}>{o.label}</Text>
            {!!o.badge && (
              <View style={{ backgroundColor: c.accent, borderRadius: 9, minWidth: 18, height: 18, paddingHorizontal: 5, justifyContent: 'center' }}>
                <Text style={{ color: c.onAccent, fontSize: 11, fontWeight: '700', textAlign: 'center' }}>{o.badge}</Text>
              </View>
            )}
          </View>
        </Pressable>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Ratings, avatars, status
// ---------------------------------------------------------------------------

export function Stars({ value, size = 13, onChange, gap }: { value: number; size?: number; onChange?: (n: number) => void; gap?: number }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: gap ?? (onChange ? 10 : 1) }}>
      {[1, 2, 3, 4, 5].map((n) => {
        const name: IconName = value >= n ? 'star' : value >= n - 0.5 ? 'star-half' : 'star-outline';
        const icon = <Ionicons key={n} name={name} size={size} color={value >= n - 0.5 ? c.star : c.text3} />;
        return onChange ? (
          <Pressable key={n} onPress={() => onChange(n)} hitSlop={6} accessibilityLabel={`${n} stars`}>
            {icon}
          </Pressable>
        ) : (
          icon
        );
      })}
    </View>
  );
}

export function Rating({ avg, count, size = 13 }: { avg: number | null; count: number; size?: number }) {
  const { c } = useTheme();
  if (!count || avg == null) return <Text style={{ color: c.text2, fontSize: size, fontWeight: '500' }}>New</Text>;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      <Ionicons name="star" size={size - 1} color={c.text} />
      <Text style={{ fontWeight: '600', fontSize: size, color: c.text }}>{avg.toFixed(1)}</Text>
      <Text style={{ color: c.text2, fontSize: size }}>({count})</Text>
    </View>
  );
}

export function Avatar({ name, url, size = 40 }: { name: string; url?: string | null; size?: number }) {
  const { c } = useTheme();
  const initials = name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  if (url) {
    return <Image source={{ uri: mediaUrl(url) }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.fill }} />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.avatarBg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: c.text, fontWeight: '700', fontSize: size * 0.36 }}>{initials}</Text>
    </View>
  );
}

export function StatusDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ color, fontSize: 13, fontWeight: '600' }}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Grouped lists (iOS Settings style)
// ---------------------------------------------------------------------------

export function ListGroup({ title, footer, children }: { title?: string; footer?: string; children: React.ReactNode }) {
  const s = useListStyles();
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={{ gap: 7 }}>
      {title && <Text style={s.groupTitle}>{title}</Text>}
      <View style={s.group}>
        {rows.map((row, i) => (
          <View key={i}>
            {row}
            {i < rows.length - 1 && <View style={s.sep} />}
          </View>
        ))}
      </View>
      {footer && <Text style={s.footer}>{footer}</Text>}
    </View>
  );
}

export function ListRow({
  icon,
  iconColor,
  label,
  value,
  onPress,
  destructive,
  chevron = !!onPress,
  right,
}: {
  icon?: IconName;
  iconColor?: string;
  label: string;
  value?: string;
  onPress?: () => void;
  destructive?: boolean;
  chevron?: boolean;
  right?: React.ReactNode;
}) {
  const s = useListStyles();
  const { c } = useTheme();
  return (
    <Pressable onPress={onPress} disabled={!onPress}>
      {({ pressed }) => (
        <View style={[s.row, pressed && { backgroundColor: c.fill }]}>
          {icon && (
            <View style={[s.iconBox, { backgroundColor: iconColor ?? c.accent }]}>
              <Ionicons name={icon} size={17} color="#fff" />
            </View>
          )}
          <Text style={[s.rowLabel, destructive && { color: c.danger }]} numberOfLines={1}>
            {label}
          </Text>
          {value != null && (
            <Text style={s.rowValue} numberOfLines={1}>
              {value}
            </Text>
          )}
          {right}
          {chevron && <Ionicons name="chevron-forward" size={17} color={c.text3} />}
        </View>
      )}
    </Pressable>
  );
}

const useListStyles = makeStyles((c, scheme) => ({
  groupTitle: { ...type.footnote, color: c.text2, textTransform: 'uppercase', letterSpacing: 0.3, marginLeft: 16 },
  group: { backgroundColor: scheme === 'dark' ? c.surface : c.bg, borderRadius: 16, overflow: 'hidden' },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: c.separator, marginLeft: 56 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, minHeight: 50, paddingVertical: 10 },
  iconBox: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { ...type.body, color: c.text, flex: 1 },
  rowValue: { ...type.body, color: c.text2, maxWidth: '45%' },
  footer: { ...type.footnote, color: c.text2, marginHorizontal: 16, lineHeight: 18 },
}));

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

/** Big iOS-style title at the top of a tab. */
export function LargeHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  return (
    <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 20, paddingBottom: 10, flexDirection: 'row', alignItems: 'flex-end', gap: 12 }}>
      <View style={{ flex: 1 }}>
        {subtitle && <Text style={{ ...type.subhead, color: c.text2, fontWeight: '500', marginBottom: 2 }}>{subtitle}</Text>}
        <Text style={{ ...type.largeTitle, color: c.text }} numberOfLines={1}>
          {title}
        </Text>
      </View>
      {right}
    </View>
  );
}

/** Compact header for pushed screens: glass back button, centred title, optional right control. */
export function NavHeader({
  title,
  onBack,
  right,
  floating,
  backIcon = 'chevron-back',
}: {
  title?: string;
  onBack?: () => void;
  right?: React.ReactNode;
  floating?: boolean;
  backIcon?: IconName;
}) {
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  return (
    <View
      style={[
        { paddingTop: insets.top + 6, paddingHorizontal: 14, paddingBottom: 8, flexDirection: 'row', alignItems: 'center' },
        floating && { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
      ]}
      pointerEvents="box-none"
    >
      <View style={{ width: 44 }}>{onBack && <GlassIconButton icon={backIcon} onPress={onBack} label="Back" />}</View>
      <Text style={{ flex: 1, textAlign: 'center', ...type.headline, color: c.text }} numberOfLines={1}>
        {floating ? '' : title}
      </Text>
      <View style={{ minWidth: 44, alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function Empty({ icon, title, text, action }: { icon: IconName; title: string; text?: string; action?: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 56, paddingHorizontal: 32, gap: 8 }}>
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}>
        <Ionicons name={icon} size={28} color={c.text2} />
      </View>
      <Text style={{ ...type.headline, color: c.text, textAlign: 'center' }}>{title}</Text>
      {text && <Text style={{ ...type.subhead, color: c.text2, textAlign: 'center', lineHeight: 20 }}>{text}</Text>}
      {action && <View style={{ marginTop: 10 }}>{action}</View>}
    </View>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ ...type.title2, color: c.text }}>{children}</Text>
      {right}
    </View>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const { c } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.separator, marginLeft: inset }} />;
}

/** Space so scroll content clears the floating glass tab bar. */
export function useTabBarSpace() {
  const insets = useSafeAreaInsets();
  return insets.bottom + 110;
}
