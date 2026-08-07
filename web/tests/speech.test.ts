import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSpeechRecognizer,
  getVoices,
  isSpeechRecognitionSupported,
  isSpeechSynthesisSupported,
  speak,
  stopSpeaking,
  stripMarkdown,
} from '@/lib/speech';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('stripMarkdown', () => {
  it('strips emphasis and inline code', () => {
    expect(stripMarkdown('**bold** and *italic* and `code`')).toBe('bold and italic and code');
  });

  it('strips links and images to their text', () => {
    expect(stripMarkdown('[see here](https://x.dev) and ![pic](a.png)')).toBe('see here and pic');
  });

  it('strips headings, lists, and blockquotes', () => {
    const text = '# Title\n\n- item one\n\n1. item two\n\n> quote\n';
    expect(stripMarkdown(text)).toBe('Title item one item two quote');
  });

  it('collapses whitespace and trims', () => {
    expect(stripMarkdown('  hello\n\n  world  ')).toBe('hello world');
  });

  it('removes code blocks entirely', () => {
    expect(stripMarkdown('Before\n```js\nconst a = 1;\n```\nAfter')).toBe('Before After');
  });
});

describe('speech recognition support', () => {
  it('is unsupported when no window globals exist', () => {
    expect(isSpeechRecognitionSupported()).toBe(false);
  });

  it('detects the standard SpeechRecognition constructor', () => {
    vi.stubGlobal('window', { SpeechRecognition: class {} });
    expect(isSpeechRecognitionSupported()).toBe(true);
  });

  it('detects the webkit-prefixed constructor', () => {
    vi.stubGlobal('window', { webkitSpeechRecognition: class {} });
    expect(isSpeechRecognitionSupported()).toBe(true);
  });
});

describe('createSpeechRecognizer', () => {
  class MockRecognition {
    continuous = false;
    interimResults = false;
    lang = '';
    onresult: ((event: unknown) => void) | null = null;
    onend: (() => void) | null = null;
    onerror: ((event: { error: string }) => void) | null = null;
    startCalls = 0;
    stopCalls = 0;

    start(): void {
      this.startCalls += 1;
    }

    stop(): void {
      this.stopCalls += 1;
    }
  }

  function stubRecognition(): MockRecognition {
    const instance = new MockRecognition();
    const Ctor = vi.fn(function () {
      return instance;
    });
    vi.stubGlobal('window', { SpeechRecognition: Ctor });
    return instance;
  }

  it('returns null when unsupported', () => {
    expect(
      createSpeechRecognizer({
        onInterim: vi.fn(),
        onFinal: vi.fn(),
        onEnd: vi.fn(),
        onError: vi.fn(),
      }),
    ).toBeNull();
  });

  it('reports interim and final transcripts and tracks listening state', () => {
    const instance = stubRecognition();
    const onInterim = vi.fn();
    const onFinal = vi.fn();
    const onEnd = vi.fn();

    const recognizer = createSpeechRecognizer({ onInterim, onFinal, onEnd, onError: vi.fn() });
    expect(recognizer).not.toBeNull();
    if (!recognizer) {
      return;
    }

    expect(recognizer.isListening()).toBe(false);
    recognizer.start();
    expect(recognizer.isListening()).toBe(true);
    expect(instance.startCalls).toBe(1);

    instance.onresult?.({
      results: [
        { isFinal: false, 0: { transcript: 'hello ' } },
        { isFinal: true, 0: { transcript: 'world' } },
      ],
    });
    expect(onInterim).toHaveBeenCalledWith('hello ');
    expect(onFinal).toHaveBeenCalledWith('world');

    instance.onend?.();
    expect(recognizer.isListening()).toBe(false);
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('stops listening on stop() and ignores aborted errors', () => {
    const instance = stubRecognition();
    const onError = vi.fn();

    const recognizer = createSpeechRecognizer({
      onInterim: vi.fn(),
      onFinal: vi.fn(),
      onEnd: vi.fn(),
      onError,
    });
    if (!recognizer) {
      return;
    }

    recognizer.start();
    instance.onerror?.({ error: 'aborted' });
    expect(onError).not.toHaveBeenCalled();
    expect(recognizer.isListening()).toBe(true);

    recognizer.stop();
    expect(instance.stopCalls).toBe(1);
  });
});

describe('speech synthesis', () => {
  class MockUtterance {
    lang = '';
    text: string;
    rate = 1;
    pitch = 1;
    voice: { name: string } | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;

    constructor(text: string) {
      this.text = text;
    }
  }

  function stubSynthesis(voices: Array<{ name: string; lang: string; default?: boolean }> = []): {
    cancel: ReturnType<typeof vi.fn>;
    speak: ReturnType<typeof vi.fn>;
    getVoices: ReturnType<typeof vi.fn>;
    utterance: MockUtterance;
  } {
    const utterance = new MockUtterance('');
    const cancel = vi.fn();
    const getVoices = vi.fn(() => voices);
    const speak = vi.fn((u: MockUtterance) => {
      utterance.text = u.text;
      utterance.lang = u.lang;
      utterance.rate = u.rate;
      utterance.pitch = u.pitch;
      utterance.voice = u.voice;
      utterance.onend = u.onend;
      utterance.onerror = u.onerror;
    });
    vi.stubGlobal('SpeechSynthesisUtterance', MockUtterance);
    vi.stubGlobal('window', { speechSynthesis: { cancel, speak, getVoices } });
    return { cancel, speak, getVoices, utterance };
  }

  it('is supported when speechSynthesis exists', () => {
    expect(isSpeechSynthesisSupported()).toBe(false);
    stubSynthesis();
    expect(isSpeechSynthesisSupported()).toBe(true);
  });

  it('speaks markdown-free text and cancels any previous speech', () => {
    const { cancel, speak: speakFn, utterance } = stubSynthesis();
    const onEnd = vi.fn();

    const started = speak('**Hello** [there](https://x.dev)', onEnd);

    expect(started).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(speakFn).toHaveBeenCalledOnce();
    expect(utterance.text).toBe('Hello there');
    expect(utterance.lang).toBe('en-US');

    utterance.onend?.();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('returns false when unsupported', () => {
    expect(speak('hello')).toBe(false);
  });

  it('lists available voices', () => {
    expect(getVoices()).toEqual([]);
    const { getVoices: stubGetVoices } = stubSynthesis([
      { name: 'Aria', lang: 'en-US', default: true },
      { name: 'Jenny', lang: 'en-GB' },
    ]);
    expect(getVoices()).toEqual([
      { name: 'Aria', lang: 'en-US', default: true },
      { name: 'Jenny', lang: 'en-GB', default: false },
    ]);
    expect(stubGetVoices).toHaveBeenCalledOnce();
  });

  it('applies voice, rate and pitch from options', () => {
    const { utterance, getVoices: stubGetVoices } = stubSynthesis([
      { name: 'Aria', lang: 'en-US' },
    ]);

    const started = speak('Hello', {
      voice: 'Aria',
      rate: 1.5,
      pitch: 1.25,
    });

    expect(started).toBe(true);
    expect(utterance.rate).toBe(1.5);
    expect(utterance.pitch).toBe(1.25);
    expect(utterance.voice).toEqual({ name: 'Aria', lang: 'en-US' });
    expect(stubGetVoices).toHaveBeenCalled();
  });

  it('invokes onEnd from the options object', () => {
    const { utterance } = stubSynthesis();
    const onEnd = vi.fn();
    expect(speak('Hi', { onEnd })).toBe(true);
    utterance.onend?.();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('stops speaking by cancelling', () => {
    const { cancel } = stubSynthesis();
    stopSpeaking();
    expect(cancel).toHaveBeenCalledOnce();
  });
});
