export type SpeechRecognizer = {
  start: () => void;
  stop: () => void;
  isListening: () => boolean;
};

export type SpeechRecognizerOptions = {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onEnd: () => void;
  onError: (message: string) => void;
};

type RecognitionEvent = {
  results: Array<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};

type RecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
};

type RecognitionConstructor = new () => RecognitionLike;

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const w = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionSupported(): boolean {
  return recognitionConstructor() !== null;
}

export function createSpeechRecognizer(options: SpeechRecognizerOptions): SpeechRecognizer | null {
  const Ctor = recognitionConstructor();
  if (!Ctor) {
    return null;
  }

  const recognition = new Ctor();
  let listening = false;
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onresult = (event) => {
    let interim = '';
    let final = '';
    for (const result of event.results) {
      if (result.isFinal) {
        final += result[0].transcript;
      } else {
        interim += result[0].transcript;
      }
    }
    if (interim) {
      options.onInterim(interim);
    }
    if (final) {
      options.onFinal(final);
    }
  };

  recognition.onend = () => {
    listening = false;
    options.onEnd();
  };

  recognition.onerror = (event) => {
    if (event.error === 'aborted') {
      return;
    }
    listening = false;
    options.onError(event.error);
  };

  return {
    start: () => {
      if (listening) {
        return;
      }
      recognition.start();
      listening = true;
    },
    stop: () => {
      if (!listening) {
        return;
      }
      recognition.stop();
    },
    isListening: () => listening,
  };
}

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export type SpeechVoice = {
  name: string;
  lang: string;
  default: boolean;
};

export type SpeakOptions = {
  voice?: string | null;
  rate?: number;
  pitch?: number;
  onEnd?: () => void;
};

/** Lists installed voices (empty when synthesis is unsupported). */
export function getVoices(): SpeechVoice[] {
  if (!isSpeechSynthesisSupported()) {
    return [];
  }
  return window.speechSynthesis
    .getVoices()
    .map((voice) => ({ name: voice.name, lang: voice.lang, default: !!voice.default }));
}

export function speak(text: string, options?: SpeakOptions | (() => void)): boolean {
  if (!isSpeechSynthesisSupported() || !text.trim()) {
    return false;
  }
  const onEnd = typeof options === 'function' ? options : options?.onEnd;
  const voiceName = typeof options === 'function' ? null : (options?.voice ?? null);
  const rate = typeof options === 'function' ? 1 : (options?.rate ?? 1);
  const pitch = typeof options === 'function' ? 1 : (options?.pitch ?? 1);
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(stripMarkdown(text));
  utterance.lang = 'en-US';
  utterance.rate = rate;
  utterance.pitch = pitch;
  if (voiceName) {
    const voice = synth.getVoices().find((candidate) => candidate.name === voiceName);
    if (voice) {
      utterance.voice = voice;
    }
  }
  if (onEnd) {
    utterance.onend = () => onEnd();
    utterance.onerror = () => onEnd();
  }
  synth.speak(utterance);
  return true;
}

export function stopSpeaking(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/>\s?/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}
