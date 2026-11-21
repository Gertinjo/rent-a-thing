import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { Calendar as RNCalendar } from 'react-native-calendars';

import type { Calendar } from '../api';
import { addDays, isoDay, makeStyles, useTheme } from '../theme';

export interface Selection {
  start?: string;
  end?: string;
}

interface Props {
  data: Calendar | null;
  selection: Selection;
  onChange: (s: Selection) => void;
  /** Called when the user taps a day that can't be picked. */
  onBlockedPress?: (reason: string) => void;
}

function eachDay(a: string, b: string, fn: (d: string) => void) {
  for (let d = a; d <= b; d = addDays(d, 1)) fn(d);
}

/**
 * Month calendar that greys out booked/blocked days, tints days with pending requests,
 * and lets the user pick a start → end range.
 */
export default function AvailabilityCalendar({ data, selection, onChange, onBlockedPress }: Props) {
  const { c, scheme } = useTheme();
  const s = useStyles();
  const today = isoDay();

  const kindByDay = useMemo(() => {
    const m: Record<string, 'booked' | 'blocked' | 'pending'> = {};
    data?.ranges.forEach((r) =>
      eachDay(r.start_date, r.end_date, (d) => {
        if (r.kind !== 'pending' || !m[d]) m[d] = r.kind;
      }),
    );
    return m;
  }, [data]);
  const unavailable = useMemo(() => new Set(data?.unavailable_days ?? []), [data]);

  const marked = useMemo(() => {
    const m: Record<string, any> = {};
    const paint = (d: string, color: string, textColor: string, extra: object = {}) => {
      m[d] = { color, textColor, startingDay: true, endingDay: true, ...extra, _c: color };
      const prev = addDays(d, -1);
      if (m[prev]?._c === color) {
        m[prev].endingDay = false;
        m[d].startingDay = false;
      }
    };
    Object.keys(kindByDay)
      .sort()
      .forEach((d) => {
        const k = kindByDay[d];
        if (k === 'pending') paint(d, c.calendarPendingBg, c.text);
        else
          paint(d, k === 'booked' ? c.calendarBooked : c.calendarBlocked, c.text3, {
            disabled: true,
            disableTouchEvent: true,
          });
      });
    if (selection.start) eachDay(selection.start, selection.end ?? selection.start, (d) => paint(d, c.accent, c.onAccent));
    return m;
  }, [kindByDay, selection, c]);

  const onDayPress = ({ dateString: d }: { dateString: string }) => {
    if (unavailable.has(d)) return onBlockedPress?.('That day is not available');
    const { start, end } = selection;
    if (!start || end || d < start) return onChange({ start: d });
    let clash = false;
    eachDay(start, d, (x) => {
      if (unavailable.has(x)) clash = true;
    });
    if (clash) {
      onBlockedPress?.('Your dates can’t include unavailable days');
      return onChange({ start: d });
    }
    onChange({ start, end: d });
  };

  return (
    <View style={{ gap: 12 }}>
      <View style={s.card}>
        <RNCalendar
          key={scheme + c.accent} // the calendar caches its theme; remount when it changes
          minDate={today}
          markingType="period"
          markedDates={marked}
          onDayPress={onDayPress}
          enableSwipeMonths
          firstDay={1}
          theme={{
            calendarBackground: 'transparent',
            dayTextColor: c.text,
            monthTextColor: c.text,
            textSectionTitleColor: c.text2,
            todayTextColor: c.accent,
            arrowColor: c.accent,
            textDisabledColor: c.text3,
            textDayFontWeight: '500',
            textMonthFontWeight: '700',
            textMonthFontSize: 17,
            textDayHeaderFontWeight: '600',
            textDayHeaderFontSize: 12,
          }}
        />
      </View>
      <View style={s.legend}>
        <Legend color={c.accent} label="Your dates" />
        <Legend color={c.calendarBooked} label="Booked" />
        <Legend color={c.calendarBlocked} label="Owner busy" />
        <Legend color={c.calendarPendingBg} label="Requested" />
      </View>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  const s = useStyles();
  return (
    <View style={s.legendItem}>
      <View style={[s.dot, { backgroundColor: color }]} />
      <Text style={s.legendText}>{label}</Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  card: { backgroundColor: c.surface2, borderRadius: 22, padding: 6, overflow: 'hidden' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, paddingHorizontal: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1, borderColor: c.separator },
  legendText: { fontSize: 12, color: c.text2 },
}));
