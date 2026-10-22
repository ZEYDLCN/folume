import { View } from 'react-native';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

import { useColors } from './theme';

const NAVY = '#141b36';

/**
 * The Folume mark: a mortarboard resting on a pen nib that opens like a book.
 * `tile` puts it on the navy rounded square used for the app icon; `plain` draws the mark alone on a transparent
 * ground, with the nib's cut-outs in `cutout` (the colour behind it).
 */
export function Logo({ size = 40, tile = false, cutout }: { size?: number; tile?: boolean; cutout?: string }) {
  const c = useColors();
  const hole = tile ? NAVY : (cutout ?? c.bg);
  const mark = (
    <G>
      <Path fill="#ee8a5b" d="M168 236C168 196 204 176 256 176s88 20 88 60v96c0 44-50 84-88 124-38-40-88-80-88-124z" />
      <Path fill={hole} d="M196 244c0-26 22-42 60-42s60 16 60 42v50H196z" />
      <G fill="#ee8a5b">
        {[236, 256, 276].map((y) => (
          <G key={y}>
            <Rect x={212} y={y} width={30} height={9} rx={4.5} />
            <Rect x={270} y={y} width={30} height={9} rx={4.5} />
          </G>
        ))}
      </G>
      <Rect x={252} y={212} width={8} height={82} rx={4} fill={hole} />
      <Circle cx={256} cy={344} r={15} fill={hole} />
      <Path fill={hole} d="M252 356h8l-4 102z" />
      <Path fill="#f2b6e3" stroke={hole} strokeWidth={10} strokeLinejoin="round" d="M104 150 256 88l152 62-152 62z" />
      <Path d="M120 160v78" stroke="#2d45ea" strokeWidth={9} strokeLinecap="round" fill="none" />
      <Path fill="#2d45ea" d="M108 234h24l8 44c1 6-3 10-8 10h-24c-5 0-9-4-8-10z" />
    </G>
  );
  if (!tile) {
    return (
      <View accessibilityRole="image" accessibilityLabel="Folume" style={{ width: size, height: size }}>
        <Svg width={size} height={size} viewBox="60 60 392 420">
          {mark}
        </Svg>
      </View>
    );
  }
  return (
    <View accessibilityRole="image" accessibilityLabel="Folume" style={{ width: size, height: size, borderRadius: size * 0.26, backgroundColor: NAVY, overflow: 'hidden' }}>
      <Svg width={size} height={size} viewBox="52 58 408 408">
        {mark}
      </Svg>
    </View>
  );
}
