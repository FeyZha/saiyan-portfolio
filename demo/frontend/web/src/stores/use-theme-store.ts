import { create } from "zustand";
import { readProductTheme, saveProductTheme, type ProductTheme } from '../../../shared/product-theme';

export type ThemeName = ProductTheme;

type ThemeStore = {
    theme: ThemeName;
    setTheme: (theme: ThemeName) => void;
};

export const useThemeStore = create<ThemeStore>((set) => ({
    theme: readProductTheme(),
    setTheme: (theme) => { saveProductTheme(theme); set({ theme }); },
}));
