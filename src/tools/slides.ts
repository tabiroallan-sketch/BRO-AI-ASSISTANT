import { requirePermission } from '../integrations/access.js';
import { fetchWithTimeout } from '../lib/http.js';
import type { Tool } from './types.js';

type Presentation = {
  presentationId?: string;
  title?: string;
  slides?: Slide[];
};

type Slide = {
  objectId?: string;
  slideLayoutReference?: { layoutId?: string };
  pageElements?: PageElement[];
};

type PageElement = {
  objectId?: string;
  shape?: {
    shapeType?: string;
    text?: {
      textElements?: {
        textRun?: { content?: string };
      }[];
    };
  };
};

type BatchUpdateResponse = {
  presentationId?: string;
};

const SLIDES_API = 'https://slides.googleapis.com/v1/presentations';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';

function extractSlideText(slide: Slide): string {
  const parts: string[] = [];
  for (const element of slide.pageElements ?? []) {
    const runs = element.shape?.text?.textElements ?? [];
    const text = runs.map((r) => r.textRun?.content ?? '').join('');
    if (text.trim()) parts.push(text.trim());
  }
  return parts.join('\n');
}

async function slidesRequest(
  token: string,
  url: string,
  init: { method?: string; body?: string } = {},
): Promise<Response> {
  return fetchWithTimeout(url, {
    timeoutMs: 15_000,
    method: init.method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: init.body,
  });
}

export const slidesListTool: Tool = {
  name: 'slides_list',
  providerId: 'google-slides',
  description: 'Find the user\u2019s Google Slides presentations by name and return their IDs.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Optional name filter, e.g. "pitch deck".',
      },
      maxResults: {
        type: 'string',
        description: 'Maximum number of presentations to return (default 10).',
      },
    },
  },
  async execute(args, context) {
    const token = await requirePermission(context.userId, 'google-slides', 'slides.read');
    const maxResults = typeof args.maxResults === 'string' ? args.maxResults : '10';
    const query = typeof args.query === 'string' ? args.query.trim() : '';
    const mimeFilter = "mimeType='application/vnd.google-apps.presentation'";
    const q = query
      ? `${mimeFilter} and name contains '${query.replaceAll("'", "\\'")}'`
      : mimeFilter;
    const params = new URLSearchParams({
      q,
      pageSize: maxResults,
      orderBy: 'modifiedTime desc',
      fields: 'files(id,name,modifiedTime)',
    });
    const response = await fetchWithTimeout(`${DRIVE_API}/files?${params.toString()}`, {
      timeoutMs: 10_000,
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`Google Slides request failed with status ${response.status}`);
    }
    const body = (await response.json()) as {
      files?: { id?: string; name?: string; modifiedTime?: string }[];
    };
    const files = body.files ?? [];
    if (files.length === 0) {
      return 'No presentations found.';
    }
    const lines = files.map(
      (file, index) =>
        `${index + 1}. ${file.name ?? '(unnamed)'} (id: ${file.id ?? 'unknown'}, modified ${file.modifiedTime ?? 'unknown'})`,
    );
    return lines.join('\n');
  },
};

export const slidesReadTool: Tool = {
  name: 'slides_read',
  providerId: 'google-slides',
  description:
    'Read the content of a Google Slides presentation, returning slide count and text from each slide.',
  parameters: {
    type: 'object',
    properties: {
      presentationId: {
        type: 'string',
        description: 'The presentation ID (from the URL or slides_list).',
      },
    },
    required: ['presentationId'],
  },
  async execute(args, context) {
    const presentationId =
      typeof args.presentationId === 'string' ? args.presentationId.trim() : '';
    if (!presentationId) {
      throw new Error('Missing "presentationId" argument');
    }
    const token = await requirePermission(context.userId, 'google-slides', 'slides.read');
    const response = await slidesRequest(
      token,
      `${SLIDES_API}/${encodeURIComponent(presentationId)}`,
    );
    if (!response.ok) {
      throw new Error(`Google Slides request failed with status ${response.status}`);
    }
    const pres = (await response.json()) as Presentation;
    const slides = pres.slides ?? [];
    if (slides.length === 0) {
      return `Presentation "${pres.title ?? presentationId}" has no slides.`;
    }
    const parts = [`Title: ${pres.title ?? '(untitled)'}`, `Slides: ${slides.length}`, ''];
    slides.forEach((slide, index) => {
      const text = extractSlideText(slide);
      parts.push(`--- Slide ${index + 1} ---`);
      parts.push(text || '(empty)');
      parts.push('');
    });
    return parts.join('\n');
  },
};

export const slidesCreateTool: Tool = {
  name: 'slides_create',
  providerId: 'google-slides',
  description: 'Create a new Google Slides presentation with an optional title.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Presentation title (optional).' },
      parentId: {
        type: 'string',
        description: 'Optional Drive folder ID to create the presentation in.',
      },
    },
  },
  async execute(args, context) {
    const token = await requirePermission(context.userId, 'google-slides', 'slides.write');
    const title =
      typeof args.title === 'string' && args.title.trim()
        ? args.title.trim()
        : 'Untitled Presentation';
    const parentId = typeof args.parentId === 'string' ? args.parentId.trim() : '';

    const body: Record<string, unknown> = { title };
    if (parentId) body.parentId = parentId;

    const response = await slidesRequest(token, SLIDES_API, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Google Slides request failed with status ${response.status}`);
    }
    const pres = (await response.json()) as Presentation;
    return `Presentation created: "${pres.title ?? title}" (id: ${pres.presentationId ?? 'unknown'})`;
  },
};

export const slidesAddSlideTool: Tool = {
  name: 'slides_add_slide',
  providerId: 'google-slides',
  description: 'Add a new blank slide to a Google Slides presentation at a given index position.',
  parameters: {
    type: 'object',
    properties: {
      presentationId: { type: 'string', description: 'The presentation ID.' },
      index: {
        type: 'string',
        description: 'Position to insert the slide (0 = first). Defaults to the end.',
      },
      layoutId: {
        type: 'string',
        description:
          'Optional layout ID for the new slide (e.g. "BLANK"). Use slides_read to discover layouts.',
      },
    },
    required: ['presentationId'],
  },
  async execute(args, context) {
    const presentationId =
      typeof args.presentationId === 'string' ? args.presentationId.trim() : '';
    if (!presentationId) {
      throw new Error('Missing "presentationId" argument');
    }
    const token = await requirePermission(context.userId, 'google-slides', 'slides.write');
    const index =
      typeof args.index === 'string' && args.index.trim() ? parseInt(args.index.trim(), 10) : -1;
    const layoutId = typeof args.layoutId === 'string' ? args.layoutId.trim() : '';

    const insertLocation: Record<string, unknown> = {};
    if (!Number.isNaN(index) && index >= 0) {
      insertLocation.index = index;
    }

    const request: Record<string, unknown> = { insertSlide: insertLocation };
    if (layoutId) {
      (request.insertSlide as Record<string, unknown>).slideLayoutReference = { layoutId };
    }

    const response = await slidesRequest(
      token,
      `${SLIDES_API}/${encodeURIComponent(presentationId)}:batchUpdate`,
      {
        method: 'POST',
        body: JSON.stringify({ requests: [request] }),
      },
    );
    if (!response.ok) {
      throw new Error(`Google Slides request failed with status ${response.status}`);
    }
    const result = (await response.json()) as BatchUpdateResponse;
    return `Slide added to "${result.presentationId ?? presentationId}"`;
  },
};

export const slidesUpdateTextTool: Tool = {
  name: 'slides_update_text',
  providerId: 'google-slides',
  description:
    'Replace all text on a specific shape in a slide with new text. Requires the shape object ID.',
  parameters: {
    type: 'object',
    properties: {
      presentationId: { type: 'string', description: 'The presentation ID.' },
      slideIndex: {
        type: 'string',
        description: 'The slide index (0-based) to identify the slide.',
      },
      text: { type: 'string', description: 'New text content for the shape.' },
      shapeIndex: {
        type: 'string',
        description: 'Shape index on the slide (0 = first shape). Defaults to 0.',
      },
    },
    required: ['presentationId', 'slideIndex', 'text'],
  },
  async execute(args, context) {
    const presentationId =
      typeof args.presentationId === 'string' ? args.presentationId.trim() : '';
    const slideIndexStr = typeof args.slideIndex === 'string' ? args.slideIndex.trim() : '';
    const text = typeof args.text === 'string' ? args.text : '';
    if (!presentationId || !slideIndexStr || !text) {
      throw new Error('Missing "presentationId", "slideIndex", or "text" argument');
    }
    const slideIndex = parseInt(slideIndexStr, 10);
    if (Number.isNaN(slideIndex) || slideIndex < 0) {
      throw new Error('"slideIndex" must be a non-negative integer');
    }
    const shapeIndex =
      typeof args.shapeIndex === 'string' && args.shapeIndex.trim()
        ? parseInt(args.shapeIndex.trim(), 10)
        : 0;
    const token = await requirePermission(context.userId, 'google-slides', 'slides.write');

    const presRes = await slidesRequest(
      token,
      `${SLIDES_API}/${encodeURIComponent(presentationId)}`,
    );
    if (!presRes.ok) {
      throw new Error(`Google Slides request failed with status ${presRes.status}`);
    }
    const pres = (await presRes.json()) as Presentation;
    const slides = pres.slides ?? [];
    if (slideIndex >= slides.length) {
      throw new Error(
        `slideIndex ${slideIndex} out of range (presentation has ${slides.length} slides)`,
      );
    }
    const slide = slides[slideIndex];
    if (!slide) {
      throw new Error(`Slide at index ${slideIndex} not found`);
    }
    const elements = slide.pageElements ?? [];
    if (shapeIndex >= elements.length) {
      throw new Error(
        `shapeIndex ${shapeIndex} out of range (slide has ${elements.length} elements)`,
      );
    }
    const shapeId = elements[shapeIndex]?.objectId;
    if (!shapeId) {
      throw new Error(`Shape at index ${shapeIndex} has no object ID`);
    }

    const response = await slidesRequest(
      token,
      `${SLIDES_API}/${encodeURIComponent(presentationId)}:batchUpdate`,
      {
        method: 'POST',
        body: JSON.stringify({
          requests: [
            {
              deleteAllText: { objectId: shapeId },
            },
            {
              insertText: {
                objectId: shapeId,
                insertionIndex: 0,
                text,
              },
            },
          ],
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`Google Slides request failed with status ${response.status}`);
    }
    return `Updated text on slide ${slideIndex + 1}, shape ${shapeIndex + 1} in "${pres.title ?? presentationId}"`;
  },
};
