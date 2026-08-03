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

export function speak(text: string, onEnd?: () => void): boolean {
  if (!isSpeechSynthesisSupported() || !text.trim()) {
    return false;
  }
  const synth = window.speechSynthesis;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(stripMarkdown(text));
  utterance.lang = 'en-US';
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
