import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AdvisoryState {
  isVisible: boolean;
  message: string;
  showAdvisory: (message: string) => void;
  dismissAdvisory: () => void;
  reset: () => void;
}

export const useAdvisoryStore = create<AdvisoryState>()(
  persist(
    (set) => ({
      isVisible: false,
      message: '',
      showAdvisory: (message) => set({ isVisible: true, message }),
      dismissAdvisory: () => set({ isVisible: false, message: '' }),
      reset: () => set({ isVisible: false, message: '' }),
    }),
    { name: 'advisory-storage' }
  )
);
