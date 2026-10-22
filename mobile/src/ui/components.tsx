import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, serif, space, useColors } from './theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

type Variant = 'title' | 'heading' | 'body' | 'caption' | 'label';

const textStyles: Record<Variant, TextStyle> = {
  title: { fontSize: 30, fontWeight: '700', letterSpacing: -0.4, fontFamily: serif },
  heading: { fontSize: 19, fontWeight: '700', fontFamily: serif },
  body: { fontSize: 15, lineHeight: 22 },
  caption: { fontSize: 13, lineHeight: 18 },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase' },
};

export function AppText({
  variant = 'body',
  muted,
  color,
  style,
  children,
  ...rest
}: {
  variant?: Variant;
  muted?: boolean;
  color?: string;
  style?: StyleProp<TextStyle>;
  children?: ReactNode;
} & Omit<ComponentProps<typeof Text>, 'style'>) {
  const c = useColors();
  return (
    <Text {...rest} style={[textStyles[variant], { color: color ?? (muted ? c.muted : c.text) }, style]}>
      {children}
    </Text>
  );
}

export function Card({ children, style, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const c = useColors();
  return (
    <View testID={testID} style={[styles.card, { backgroundColor: c.surface, borderColor: c.border }, style]}>
      {children}
    </View>
  );
}

export function Button({
  label,
  onPress,
  icon,
  variant = 'primary',
  disabled,
  loading,
  style,
  testID,
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const c = useColors();
  const bg = variant === 'primary' ? c.accent : variant === 'danger' ? c.danger : variant === 'secondary' ? c.surfaceAlt : 'transparent';
  const fg = variant === 'primary' ? c.accentText : variant === 'danger' ? c.bg : variant === 'secondary' ? c.text : c.accent;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
      <Text style={{ color: fg, fontSize: 15, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  label,
  active,
  testID,
  size = 22,
  color,
}: {
  icon: IconName;
  onPress: () => void;
  label: string;
  active?: boolean;
  testID?: string;
  size?: number;
  /** icon colour, for use on the terracotta header */
  color?: string;
}) {
  const c = useColors();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, { backgroundColor: active ? c.surfaceAlt : 'transparent', opacity: pressed ? 0.6 : 1 }]}
    >
      <Ionicons name={icon} size={size} color={color ?? (active ? c.accent : c.text)} />
    </Pressable>
  );
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'warn' | 'ok' | 'danger' }) {
  const c = useColors();
  const map = {
    neutral: { bg: c.surfaceAlt, fg: c.muted },
    warn: { bg: c.warnBg, fg: c.warn },
    ok: { bg: c.surfaceAlt, fg: c.ok },
    danger: { bg: c.warnBg, fg: c.danger },
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: map.bg }]}>
      <Text style={{ color: map.fg, fontSize: 11, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

export function ProgressBar({ value, height = 4 }: { value: number; height?: number }) {
  const c = useColors();
  return (
    <View style={{ height, borderRadius: height, backgroundColor: c.surfaceAlt, overflow: 'hidden' }}>
      <View style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, height, backgroundColor: c.accent }} />
    </View>
  );
}

export function Divider() {
  const c = useColors();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border }} />;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const c = useColors();
  return (
    <View style={[styles.segmented, { backgroundColor: c.surfaceAlt }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, on && { backgroundColor: c.surface }]}
          >
            <Text style={{ color: on ? c.text : c.muted, fontWeight: on ? '700' : '500', fontSize: 13 }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Stepper({
  value,
  onChange,
  min,
  max,
  step,
  format,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
}) {
  const c = useColors();
  const set = (v: number) => onChange(Math.round(Math.min(max, Math.max(min, v)) * 100) / 100);
  return (
    <View style={styles.stepper}>
      <IconButton icon="remove" label="-" onPress={() => set(value - step)} />
      <Text style={{ color: c.text, minWidth: 54, textAlign: 'center', fontWeight: '700' }}>
        {format ? format(value) : String(value)}
      </Text>
      <IconButton icon="add" label="+" onPress={() => set(value + step)} />
    </View>
  );
}

/** Bottom sheet; on wide screens it is capped so it does not stretch across a desktop browser. */
export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[styles.scrim, { backgroundColor: c.scrim }]} onPress={onClose} accessible={false} />
      <View
        style={[
          styles.sheet,
          { backgroundColor: c.surface, borderColor: c.border, paddingBottom: Math.max(insets.bottom, space.lg) },
        ]}
      >
        <View style={styles.sheetHeader}>
          <AppText variant="heading" style={{ flex: 1 }}>
            {title}
          </AppText>
          <IconButton icon="close" label="close" onPress={onClose} testID="sheet-close" />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space.md, paddingBottom: space.md }}>
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

/** A switch in the app's colours: terracotta when on. */
export function AppSwitch({ value, onValueChange, testID }: { value: boolean; onValueChange: (v: boolean) => void; testID?: string }) {
  const c = useColors();
  return (
    <Switch
      value={value}
      onValueChange={onValueChange}
      testID={testID}
      trackColor={{ true: c.accent, false: c.border }}
      thumbColor="#ffffff"
      // react-native-web paints the thumb and track from these
      {...({ activeThumbColor: '#ffffff' } as object)}
    />
  );
}

export function Row({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: space.sm }, style]}>{children}</View>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <View style={{ gap: space.xs }}>
      <AppText variant="label" muted>
        {label}
      </AppText>
      {children}
      {hint ? (
        <AppText variant="caption" muted>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: space.lg, shadowColor: '#7a3a1c', shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 1 },
  button: {
    minHeight: 46,
    borderRadius: radius.pill,
    paddingHorizontal: space.xl,
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  badge: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  segmented: { flexDirection: 'row', borderRadius: radius.md, padding: 3 },
  segment: { flex: 1, minHeight: 36, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '82%',
    borderTopLeftRadius: radius.lg + 6,
    borderTopRightRadius: radius.lg + 6,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 640,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', paddingBottom: space.sm },
});
