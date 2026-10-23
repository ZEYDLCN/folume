import { Redirect, useLocalSearchParams } from 'expo-router';

import { paperFromShared } from '@/core/share';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** `folume://import?url=…` (a deep link, or a share into the app): opens the library with the paper ready to add. */
export default function ImportRoute() {
  const params = useLocalSearchParams<{ url?: string; text?: string; title?: string }>();
  const paper = paperFromShared({ url: one(params.url), text: one(params.text), title: one(params.title) });
  return <Redirect href={paper ? { pathname: '/', params: { import: paper } } : '/'} />;
}
