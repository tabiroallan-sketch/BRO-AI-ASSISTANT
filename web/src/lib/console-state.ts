import { create } from 'zustand';

type ConsoleState = {
  open: boolean;
  openConsole: () => void;
  closeConsole: () => void;
  toggleConsole: () => void;
};

export const useConsole = create<ConsoleState>((set) => ({
  open: false,
  openConsole: () => set({ open: true }),
  closeConsole: () => set({ open: false }),
  toggleConsole: () => set((state) => ({ open: !state.open })),
}));
