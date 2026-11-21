import { Ionicons } from '@expo/vector-icons';
import { Gyroscope } from 'expo-sensors';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  GestureResponderEvent,
  Image,
  LayoutChangeEvent,
  PanResponder,
  PanResponderGestureState,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { mediaUrl } from '../api';
import { useTheme } from '../theme';
import { Glass, GlassIconButton } from './ui';

interface Props {
  /** Frame URLs in capture order around the object (one full circle). */
  frames: string[];
  height?: number;
  /** Spin slowly on its own until the user touches it. */
  autoRotate?: boolean;
  /** Let the user turn the phone to turn the object (gyroscope). */
  allowTilt?: boolean;
  onFullscreen?: () => void;
  dark?: boolean;
  /** Extra space at the bottom for overlapping content (e.g. a sheet). */
  bottomInset?: number;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/**
 * Turntable-style 360° viewer: drag left/right to walk around the thing.
 *
 * Every frame is mounted once and stacked; only the current one is visible. That way the
 * images are decoded up front and switching frames never flickers.
 */
export default function SpinViewer({ frames, height = 300, autoRotate = true, allowTilt, onFullscreen, dark, bottomInset = 0 }: Props) {
  const { c } = useTheme();
  const n = frames.length;
  const urls = useMemo(() => frames.map((f) => mediaUrl(f)!), [frames]);
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(0);
  const [width, setWidth] = useState(300);
  const [touched, setTouched] = useState(false);
  const [tilt, setTilt] = useState(false);
  const hint = useRef(new Animated.Value(1)).current;

  // Refs so the PanResponder (created once) always sees fresh values.
  const pos = useRef(0); // fractional frame position
  const startPos = useRef(0);
  const momentum = useRef<number | null>(null);
  const widthRef = useRef(width);
  widthRef.current = width;

  const ready = loaded >= n;

  const setPos = useCallback(
    (p: number) => {
      pos.current = p;
      setIndex(mod(Math.round(p), n));
    },
    [n],
  );

  const stopMomentum = () => {
    if (momentum.current != null) cancelAnimationFrame(momentum.current);
    momentum.current = null;
  };

  // One full drag across the viewer = one full turn of the object.
  const framesPerPx = () => n / Math.max(widthRef.current, 1);

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Only claim horizontal drags, so a vertical swipe still scrolls the page.
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 4 && Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          stopMomentum();
          setTouched(true);
          startPos.current = pos.current;
        },
        onPanResponderMove: (_e: GestureResponderEvent, g: PanResponderGestureState) => {
          setPos(startPos.current - g.dx * framesPerPx());
        },
        onPanResponderRelease: (_e, g) => {
          // Flick: keep spinning and slow down.
          let v = -g.vx * framesPerPx() * 16; // frames per ~16ms tick
          const step = () => {
            v *= 0.94;
            if (Math.abs(v) < 0.02) return stopMomentum();
            setPos(pos.current + v);
            momentum.current = requestAnimationFrame(step);
          };
          if (Math.abs(v) > 0.1) momentum.current = requestAnimationFrame(step);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setPos, n],
  );

  // Idle auto-rotation (stops forever after the first touch).
  useEffect(() => {
    if (!autoRotate || touched || !ready || tilt) return;
    const t = setInterval(() => setPos(pos.current + 0.25), 40);
    return () => clearInterval(t);
  }, [autoRotate, touched, ready, tilt, setPos]);

  // Tilt mode: twisting the phone around its vertical axis turns the object.
  useEffect(() => {
    if (!tilt) return;
    Gyroscope.setUpdateInterval(16);
    let last = Date.now();
    const sub = Gyroscope.addListener(({ y }) => {
      const now = Date.now();
      const dt = (now - last) / 1000;
      last = now;
      // ~90° of phone twist = one full turn of the object.
      setPos(pos.current - (y * dt * n) / (Math.PI / 2));
    });
    return () => sub.remove();
  }, [tilt, n, setPos]);

  useEffect(() => {
    if (!touched) return;
    Animated.timing(hint, { toValue: 0, duration: 400, useNativeDriver: true }).start();
  }, [touched, hint]);

  useEffect(() => stopMomentum, []);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const degrees = Math.round((index / n) * 360);

  return (
    <View style={[styles.wrap, { height, backgroundColor: dark ? '#000' : c.imageBg }]} onLayout={onLayout} {...pan.panHandlers}>
      {urls.map((u, i) => (
        <Image
          key={u}
          source={{ uri: u }}
          style={[StyleSheet.absoluteFill, { opacity: i === index ? 1 : 0 }]}
          resizeMode="contain"
          onLoadEnd={() => setLoaded((x) => x + 1)}
          fadeDuration={0}
        />
      ))}

      {!ready && (
        <View style={styles.loading}>
          <ActivityIndicator color={c.text2} />
          <Text style={{ color: c.text2, fontSize: 13 }}>
            Preparing 360° view · {Math.min(loaded, n)}/{n}
          </Text>
        </View>
      )}

      {ready && (
        <Animated.View style={[styles.hint, { opacity: hint }]} pointerEvents="none">
          <Glass radius={22}>
            <View style={styles.hintInner}>
              <Ionicons name="hand-left-outline" size={16} color={c.text} />
              <Text style={{ color: c.text, fontWeight: '600', fontSize: 14 }}>Drag to look around</Text>
            </View>
          </Glass>
        </Animated.View>
      )}

      <View style={[styles.controls, { bottom: 14 + bottomInset }]} pointerEvents="box-none">
        <Glass radius={18} shadow={false}>
          <View style={styles.dial}>
            <Ionicons name="sync" size={14} color={c.text} style={{ transform: [{ rotate: `${degrees}deg` }] }} />
            <Text style={{ color: c.text, fontWeight: '700', fontSize: 13, minWidth: 64, fontVariant: ['tabular-nums'] }}>
              {tilt ? 'Twist phone' : `360° · ${degrees}°`}
            </Text>
          </View>
        </Glass>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {allowTilt && (
            <GlassIconButton
              icon={tilt ? 'phone-portrait' : 'phone-portrait-outline'}
              label="Twist your phone to rotate"
              onPress={() => {
                setTouched(true);
                setTilt((t) => !t);
              }}
            />
          )}
          {onFullscreen && <GlassIconButton icon="expand-outline" label="Full screen" onPress={onFullscreen} />}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', overflow: 'hidden' },
  loading: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: 10 },
  hint: { position: 'absolute', alignSelf: 'center', top: '42%' },
  hintInner: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10 },
  controls: { position: 'absolute', left: 14, right: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dial: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
});
