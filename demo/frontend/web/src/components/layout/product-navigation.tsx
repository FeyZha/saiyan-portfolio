import { useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useThemeStore } from '@/stores/use-theme-store';
import { flushPiPreferences, usePiCompetitionStore } from '@/stores/use-pi-competition-store';
import { navigateProduct, rememberCompetition, studioHref } from '../../../../shared/product-navigation';
import '../../../../shared/product-navigation.css';

export function ProductNavigation() {
    const session = usePiCompetitionStore(state => state.sessionId);
    const hydrated = usePiCompetitionStore(state => state.hydrated);
    const theme = useThemeStore(state => state.theme);
    const setTheme = useThemeStore(state => state.setTheme);
    const [error, setError] = useState('');
    const [leaving, setLeaving] = useState(false);
    async function go(href: string) {
        if (leaving) return;
        setLeaving(true); setError('');
        try {
            await flushPiPreferences();
            rememberCompetition(session);
            navigateProduct(href, usePiCompetitionStore.getState().hasPendingFiles);
        } catch (failure) { setError(failure instanceof Error ? failure.message : '对话草稿尚未保存，请稍后再切换。'); }
        finally { setLeaving(false); }
    }
    return <nav className="sy-product-nav" aria-label="赛研主导航">
        <button type="button" className="sy-product-brand" aria-label="赛研首页" title="返回欢迎页" disabled={!hydrated || leaving} onClick={() => void go('/')}>赛研</button>
        <div className="sy-product-links">
            <button type="button" aria-current="page">发现竞赛</button>
            <button type="button" disabled={!hydrated || leaving} onClick={() => void go(studioHref(session))}>创作空间</button>
        </div>
        {error && <span role="alert" className="sy-product-error">{error}</span>}
        <button type="button" className="sy-product-library" disabled={!hydrated || leaving} onClick={() => void go('/comfyart/?view=projects')}>我的作品</button>
        <button type="button" className="sy-product-theme" aria-label={`切换到${theme === 'light' ? '深' : '浅'}色主题`} title={`切换到${theme === 'light' ? '深' : '浅'}色主题`} onClick={() => {
            try { setTheme(theme === 'light' ? 'dark' : 'light'); setError(''); }
            catch (failure) { setError(failure instanceof Error ? failure.message : '主题切换失败，请重试。'); }
        }}>{theme === 'light' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}<span>{theme === 'light' ? '浅色' : '深色'}</span></button>
    </nav>;
}
