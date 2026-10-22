import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { matrixProgress } from '@/core/matrix';
import type { Project } from '@/data/userdata';
import { getStores } from '@/services/container';
import { AppText, Button, Card, IconButton } from '@/ui/components';
import { radius, space, useColors } from '@/ui/theme';
import { useT } from '@/ui/useT';

export default function ProjectsScreen() {
  const t = useT();
  const c = useColors();
  const router = useRouter();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [name, setName] = useState('');

  const load = useCallback(async () => setProjects(await getStores().projects.list()), []);
  useFocusEffect(useCallback(() => void load(), [load]));

  const create = async () => {
    if (!name.trim()) return;
    const p = await getStores().projects.create(name);
    setName('');
    router.push(`/project/${p.id}`);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm }}>
        <IconButton icon="chevron-back" label={t('common.back')} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} testID="screen-back" />
        <AppText variant="heading" style={{ flex: 1 }}>
          {t('projects.title')}
        </AppText>
      </View>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md, maxWidth: 720, width: '100%', alignSelf: 'center' }} testID="projects-list">
        <AppText muted>{t('projects.intro')}</AppText>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <TextInput
            value={name}
            onChangeText={setName}
            onSubmitEditing={() => void create()}
            accessibilityLabel={t('projects.new.placeholder')}
            placeholder={t('projects.new.placeholder')}
            placeholderTextColor={c.muted}
            testID="project-new-name"
            style={{ flex: 1, minWidth: 0, height: 46, borderRadius: radius.md, paddingHorizontal: space.md, backgroundColor: c.surfaceAlt, color: c.text }}
          />
          <Button label={t('projects.create')} onPress={() => void create()} disabled={!name.trim()} testID="project-create" />
        </View>
        {projects && projects.length === 0 ? <AppText muted testID="projects-empty">{t('projects.empty')}</AppText> : null}
        {(projects ?? []).map((p) => {
          const { filled, total } = matrixProgress(p);
          return (
            <Pressable key={p.id} accessibilityRole="button" onPress={() => router.push(`/project/${p.id}`)} testID={`project-${p.id}`}>
              <Card style={{ gap: 4 }}>
                <AppText style={{ fontWeight: '700', fontSize: 17, lineHeight: 22 }} numberOfLines={2}>
                  {p.name}
                </AppText>
                <AppText variant="caption" muted>
                  {[t('projects.papers', { n: p.paperIds.length }), total ? t('project.progress', { filled, total }) : ''].filter(Boolean).join(' · ')}
                </AppText>
              </Card>
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}
