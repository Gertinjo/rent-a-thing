import React from 'react';
import { Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import SpinViewer from '../components/SpinViewer';
import { GlassIconButton } from '../components/ui';
import type { ScreenProps } from '../navigation';
import { isWeb } from '../platform';
import { type } from '../theme';

export default function Viewer360Screen({ route, navigation }: ScreenProps<'Viewer360'>) {
  const { frames, title } = route.params;
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text style={{ ...type.headline, color: '#fff', flex: 1 }} numberOfLines={1}>
          {title}
        </Text>
        <GlassIconButton icon="close" label="Close" onPress={() => navigation.goBack()} />
      </View>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <SpinViewer frames={frames} height={Math.min(height * 0.72, Math.min(width, 430) * 1.3)} dark allowTilt={!isWeb} autoRotate={false} />
      </View>
      <Text style={{ color: 'rgba(255,255,255,0.55)', textAlign: 'center', padding: 16, paddingBottom: insets.bottom + 16, fontSize: 14 }}>
        {isWeb ? 'Drag or flick to spin' : 'Drag or flick to spin. Tap the phone button, then twist your phone.'}
      </Text>
    </View>
  );
}
