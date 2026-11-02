export type ProductTheme = 'light' | 'dark';

// Reuse the existing preference; both apps share one origin and one choice.
export const PRODUCT_THEME_KEY = 'infinite-canvas:theme_store';
const CHANGED = 'saiyan-theme-change';

export function readProductTheme(): ProductTheme {
    try {
        return JSON.parse(localStorage.getItem(PRODUCT_THEME_KEY) || '{}').state?.theme === 'dark' ? 'dark' : 'light';
    } catch { return 'light'; }
}

export function applyProductTheme(theme: ProductTheme) {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
}

export function saveProductTheme(theme: ProductTheme) {
    try { localStorage.setItem(PRODUCT_THEME_KEY, JSON.stringify({ state: { theme }, version: 0 })); }
    catch { throw new Error('主题未能保存，请允许此站点使用本地存储后重试。'); }
    applyProductTheme(theme);
    window.dispatchEvent(new Event(CHANGED));
}

export function subscribeProductTheme(onChange: (theme: ProductTheme) => void) {
    const update = () => onChange(readProductTheme());
    const storage = (event: StorageEvent) => {
        if (event.storageArea === localStorage && (event.key === PRODUCT_THEME_KEY || event.key === null)) update();
    };
    window.addEventListener(CHANGED, update);
    window.addEventListener('storage', storage);
    window.addEventListener('pageshow', update);
    update();
    return () => {
        window.removeEventListener(CHANGED, update);
        window.removeEventListener('storage', storage);
        window.removeEventListener('pageshow', update);
    };
}
