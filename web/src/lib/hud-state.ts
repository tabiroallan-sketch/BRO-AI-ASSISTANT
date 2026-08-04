import { create } from 'zustand';

export type PanelId = 'telemetry' | 'core';

type HudState = {
  panels: Record<PanelId, boolean>;
  togglePanel: (id: PanelId) => void;
};

export const useHud = create<HudState>((set) => ({
  panels: { telemetry: true, core: true },
  togglePanel: (id) => set((state) => ({ panels: { ...state.panels, [id]: !state.panels[id] } })),
}));
