import { create } from 'zustand';

export type PanelId = 'telemetry' | 'core' | 'status';

type HudState = {
  panels: Record<PanelId, boolean>;
  togglePanel: (id: PanelId) => void;
};

export const useHud = create<HudState>((set) => ({
  panels: { telemetry: false, core: false, status: false },
  togglePanel: (id) => set((state) => ({ panels: { ...state.panels, [id]: !state.panels[id] } })),
}));
