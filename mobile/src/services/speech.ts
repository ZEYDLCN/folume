import { Platform } from 'react-native';

import type { SpeechEngine } from '@/core/speech';

export function speechAvailable(): boolean {
  return Platform.OS !== 'web' || (typeof window !== 'undefined' && 'speechSynthesis' in window);
}

function pickVoice(lang?: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  if (!lang) return undefined;
  return voices.find((v) => v.lang === lang) ?? voices.find((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
}

/** The browser's speech synthesis on web, the system voice (expo-speech) on devices. */
export function createSpeechEngine(): SpeechEngine {
  if (Platform.OS === 'web') {
    return {
      speak(text, { lang, rate }, { onDone, onError }) {
        const u = new SpeechSynthesisUtterance(text);
        if (lang) u.lang = lang;
        const voice = pickVoice(lang);
        if (voice) u.voice = voice;
        u.rate = rate;
        u.onend = () => onDone();
        // stopping a sentence reports an error too; the player ignores callbacks of sentences it already left
        u.onerror = () => onError();
        window.speechSynthesis.speak(u);
      },
      stop() {
        window.speechSynthesis.cancel();
      },
    };
  }
  let Speech: typeof import('expo-speech') | null = null;
  const load = import('expo-speech').then((m) => (Speech = m));
  return {
    speak(text, { lang, rate }, { onDone, onError }) {
      void load.then(() => Speech?.speak(text, { language: lang, rate, onDone, onError: () => onError() }));
    },
    stop() {
      void load.then(() => Speech?.stop());
    },
  };
}
