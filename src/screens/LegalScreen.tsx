import React, { useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, Linking, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import { type as t } from '../constants/typography';
import { PRIVACY_URL, TERMS_URL, CONTACT_EMAIL } from '../constants/legal';

async function openUrl(url: string) {
  try {
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
    } else {
      Alert.alert('Cannot open link', `Visit:\n${url}`);
    }
  } catch {
    Alert.alert('Cannot open link', `Visit:\n${url}`);
  }
}

export function LegalScreen() {
  const nav    = useNavigation();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const styles = useMemo(() => StyleSheet.create({
    root:   { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 20, paddingVertical: 14,
      borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    scroll: { flex: 1 },
    section: {
      marginHorizontal: 20, marginTop: 28,
      backgroundColor: colors.surface,
      borderRadius: 16, borderWidth: 1, borderColor: colors.border,
      overflow: 'hidden',
    },
    sectionTitle: {
      paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10,
      borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    row: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingVertical: 14,
      borderTopWidth: 1, borderTopColor: colors.border,
    },
    rowFirst: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingVertical: 14,
    },
    arrow: { fontSize: 16, color: colors.textMuted },
    bullet: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 10,
      paddingHorizontal: 16, paddingVertical: 8,
    },
    dot: {
      width: 6, height: 6, borderRadius: 3,
      backgroundColor: colors.amber, marginTop: 7, flexShrink: 0,
    },
    infoBox: {
      marginHorizontal: 20, marginTop: 20,
      backgroundColor: colors.amberFaint,
      borderRadius: 12, borderWidth: 1, borderColor: colors.amberBorder,
      padding: 14,
    },
  }), [colors]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => nav.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={[t.body, { color: colors.textSecondary }]}>Back</Text>
        </TouchableOpacity>
        <Text style={[t.bodyMed, { color: colors.textPrimary }]}>Privacy &amp; Legal</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}>

        {/* Quick summary */}
        <View style={styles.infoBox}>
          <Text style={[t.bodyMed, { color: colors.amber, marginBottom: 8 }]}>What Prowl collects</Text>
          {[
            'Your GPS location, when logging a sighting or viewing the map',
            'Photos you choose to attach to a sighting',
            'Cat names, descriptions, and notes you type',
            'An anonymous session token — no email or password needed',
          ].map((text, i) => (
            <View key={i} style={styles.bullet}>
              <View style={styles.dot} />
              <Text style={[t.caption, { color: colors.textPrimary, flex: 1 }]}>{text}</Text>
            </View>
          ))}
          <Text style={[t.caption, { color: colors.textSecondary, marginTop: 8 }]}>
            We do not sell your data or use it for advertising.
          </Text>
        </View>

        {/* Documents */}
        <View style={styles.section}>
          <View style={styles.sectionTitle}>
            <Text style={[t.label, { color: colors.textMuted }]}>LEGAL DOCUMENTS</Text>
          </View>
          <TouchableOpacity style={styles.rowFirst} onPress={() => openUrl(PRIVACY_URL)} activeOpacity={0.7}>
            <View style={{ gap: 2 }}>
              <Text style={[t.bodyMed, { color: colors.textPrimary }]}>Privacy Policy</Text>
              <Text style={[t.caption, { color: colors.textSecondary }]}>How we collect, use, and protect your data</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.row} onPress={() => openUrl(TERMS_URL)} activeOpacity={0.7}>
            <View style={{ gap: 2 }}>
              <Text style={[t.bodyMed, { color: colors.textPrimary }]}>Terms of Service</Text>
              <Text style={[t.caption, { color: colors.textSecondary }]}>Rules for using the app</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Data & rights */}
        <View style={styles.section}>
          <View style={styles.sectionTitle}>
            <Text style={[t.label, { color: colors.textMuted }]}>YOUR DATA</Text>
          </View>
          <View style={styles.rowFirst}>
            <View style={{ gap: 2, flex: 1, paddingRight: 12 }}>
              <Text style={[t.bodyMed, { color: colors.textPrimary }]}>Delete sightings or photos</Text>
              <Text style={[t.caption, { color: colors.textSecondary }]}>Open any cat profile → swipe or tap 🗑 on a photo</Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.row}
            onPress={() => Linking.openURL(`mailto:${CONTACT_EMAIL}?subject=Data%20Deletion%20Request`)}
            activeOpacity={0.7}
          >
            <View style={{ gap: 2 }}>
              <Text style={[t.bodyMed, { color: colors.textPrimary }]}>Request full data deletion</Text>
              <Text style={[t.caption, { color: colors.textSecondary }]}>Email us and we'll delete everything within 30 days</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Contact */}
        <View style={styles.section}>
          <View style={styles.sectionTitle}>
            <Text style={[t.label, { color: colors.textMuted }]}>CONTACT</Text>
          </View>
          <TouchableOpacity
            style={styles.rowFirst}
            onPress={() => Linking.openURL(`mailto:${CONTACT_EMAIL}`)}
            activeOpacity={0.7}
          >
            <View style={{ gap: 2 }}>
              <Text style={[t.bodyMed, { color: colors.textPrimary }]}>Get in touch</Text>
              <Text style={[t.caption, { color: colors.amber }]}>{CONTACT_EMAIL}</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
        </View>

        {/* Version / legal footer */}
        <View style={{ alignItems: 'center', marginTop: 32, gap: 4 }}>
          <Text style={[t.caption, { color: colors.textMuted }]}>Prowl · com.prowl.app</Text>
          <Text style={[t.caption, { color: colors.textMuted }]}>© 2026 Prasun Acharjee</Text>
        </View>

      </ScrollView>
    </View>
  );
}
