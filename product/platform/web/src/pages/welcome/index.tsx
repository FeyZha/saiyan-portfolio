import { ArrowRight, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useThemeStore } from '@/stores/use-theme-store';
import { competitionHref, navigateProduct, studioHref } from '../../../../shared/product-navigation';
import '../../../../shared/product-navigation.css';
import './welcome.css';

export default function WelcomePage() {
    const theme = useThemeStore(state => state.theme);
    const setTheme = useThemeStore(state => state.setTheme);
    const [error, setError] = useState('');
    const [backgroundPaused, setBackgroundPaused] = useState(document.hidden);
    useEffect(() => {
        const update = () => setBackgroundPaused(document.hidden);
        document.addEventListener('visibilitychange', update);
        return () => document.removeEventListener('visibilitychange', update);
    }, []);
    const go = (href: string) => {
        try { navigateProduct(href); setError(''); }
        catch (failure) { setError(failure instanceof Error ? failure.message : '暂时无法打开，请重试。'); }
    };
    return <div className="sy-welcome">
        <div className="sy-welcome-backdrop" aria-hidden="true" data-paused={backgroundPaused || undefined}>
            <div className="sy-welcome-field">
                <svg className="sy-welcome-field-map" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" focusable="false">
                    <defs>
                        <pattern id="welcome-field-dots" width="9" height="9" patternUnits="userSpaceOnUse">
                            <circle cx="2" cy="2" r=".8" fill="currentColor" />
                        </pattern>
                        <radialGradient id="welcome-field-density" cx="73%" cy="53%" r="70%">
                            <stop stopColor="white" stopOpacity=".9" />
                            <stop offset=".6" stopColor="white" stopOpacity=".5" />
                            <stop offset="1" stopColor="white" stopOpacity="0" />
                        </radialGradient>
                        <mask id="welcome-field-fade"><rect width="1600" height="1000" fill="url(#welcome-field-density)" /></mask>
                    </defs>
                    <rect className="sy-welcome-field-dots" width="1600" height="1000" fill="url(#welcome-field-dots)" mask="url(#welcome-field-fade)" />
                    <g className="sy-welcome-field-grid" fill="none" stroke="currentColor" strokeWidth=".85" strokeDasharray="2 6">
                        {Array.from({length: 15}, (_, index) => {
                            const y = -240 + index * 105;
                            return <path key={`across-${index}`} d={`M-160 ${y}C310 ${y - 190} 940 ${y + 300} 1760 ${y - 110}`} />;
                        })}
                        {Array.from({length: 18}, (_, index) => {
                            const x = -350 + index * 115;
                            return <path key={`along-${index}`} d={`M${x} -160C${x + 310} 250 ${x - 260} 720 ${x + 180} 1160`} />;
                        })}
                    </g>
                </svg>
            </div>
        </div>
        <nav className="sy-product-nav" aria-label="赛研主导航">
            <span className="sy-product-brand">赛研</span>
            <button className="sy-product-library" type="button" onClick={() => go('/comfyart/?view=projects')}>我的作品</button>
            <button className="sy-product-theme" type="button" aria-label={`切换到${theme === 'light' ? '深' : '浅'}色主题`} title={`切换到${theme === 'light' ? '深' : '浅'}色主题`} onClick={() => {
                try { setTheme(theme === 'light' ? 'dark' : 'light'); setError(''); }
                catch (failure) { setError(failure instanceof Error ? failure.message : '主题切换失败，请重试。'); }
            }}>{theme === 'light' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}<span>{theme === 'light' ? '浅色' : '深色'}</span></button>
        </nav>
        {error && <p className="sy-welcome-error" role="alert">{error}</p>}
        <main className="sy-welcome-main">
            <div className="sy-welcome-hero">
            <div className="sy-welcome-heading">
                <h1>从一场竞赛，<br />开始你的<span>创作。</span></h1>
                <p>发现值得投入的方向，让想法在画布中成形。</p>
            </div>
            <svg className="sy-welcome-art" viewBox="0 0 420 370" aria-hidden="true" focusable="false">
                <defs>
                    <pattern id="welcome-grid" width="24" height="24" patternUnits="userSpaceOnUse">
                        <path d="M24 0H0V24" fill="none" stroke="currentColor" strokeWidth=".6" />
                    </pattern>
                    <pattern id="welcome-lines" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
                        <path d="M0 0V7" stroke="currentColor" strokeWidth="1" />
                    </pattern>
                    <clipPath id="welcome-poster-clip"><rect x="15" y="16" width="150" height="186" /></clipPath>
                    <filter id="welcome-paper-shadow" x="-40%" y="-30%" width="180%" height="180%">
                        <feDropShadow dx="0" dy="9" stdDeviation="9" floodOpacity=".09" />
                    </filter>
                </defs>
                <g className="sy-welcome-art-guides" fill="none" stroke="currentColor">
                    <rect x="52" y="46" width="312" height="288" fill="url(#welcome-grid)" stroke="none" />
                    <path d="M32 58H48M40 50V66M365 307H381M373 299V315" />
                    <circle cx="215" cy="185" r="141" strokeDasharray="2 7" />
                </g>
                <g className="sy-welcome-art-brief" transform="translate(57 62) rotate(-10 90 119)">
                    <rect className="sy-welcome-art-paper" width="180" height="238" rx="3" filter="url(#welcome-paper-shadow)" />
                    <g fill="none" stroke="currentColor" strokeWidth="1.3">
                        <circle cx="36" cy="39" r="13" />
                        <path d="m28 50-3 17 11-6 10 6-3-17M36 30l2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z" />
                    </g>
                    <path className="sy-welcome-art-ink" d="M64 34h80v5H64zm0 13h53v3H64zM22 89h136v2H22zm0 12h122v2H22zm0 12h131v2H22zm0 12h87v2H22zm0 31h136v2H22zm0 12h120v2H22zm0 12h130v2H22z" />
                    <path className="sy-welcome-art-accent" d="M22 211h44v4H22z" />
                    <path d="M130 211h28" stroke="currentColor" strokeWidth="1" opacity=".3" />
                </g>
                <path className="sy-welcome-art-route" d="M81 298c-27 30 22 50 62 33s73-54 113-41" fill="none" strokeWidth="1.2" strokeDasharray="4 5" />
                <g transform="translate(201 99) rotate(10 90 119)">
                    <rect className="sy-welcome-art-paper" width="180" height="238" rx="3" filter="url(#welcome-paper-shadow)" />
                    <g clipPath="url(#welcome-poster-clip)">
                        <rect className="sy-welcome-art-wash" x="15" y="16" width="150" height="186" />
                        <circle className="sy-welcome-art-accent" cx="111" cy="66" r="30" />
                        <path className="sy-welcome-art-land" d="M-12 187c41-101 71-145 177-84v115H-12Z" />
                        <path className="sy-welcome-art-wash" d="M-9 229c41-88 80-128 196-99v99Z" />
                        <path d="M-9 229c41-88 80-128 196-99v99Z" fill="url(#welcome-lines)" opacity=".22" />
                        <path d="M11 188c57-40 108-39 158-16" fill="none" stroke="var(--sy-background)" strokeWidth="1.5" opacity=".85" />
                    </g>
                    <path className="sy-welcome-art-ink" d="M16 217h66v3H16zm0 8h42v2H16z" />
                    <circle className="sy-welcome-art-accent" cx="151" cy="220" r="4" />
                    <g className="sy-welcome-art-selection" fill="none" strokeWidth=".9">
                        <path d="M-7-7h194v252H-7Z" />
                        <path className="sy-welcome-art-handle" d="M-10-10h6v6h-6zm194 0h6v6h-6zM-10 242h6v6h-6zm194 0h6v6h-6z" />
                    </g>
                </g>
                <path className="sy-welcome-art-cursor" d="m351 295 4 27 7-8 10 2Z" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
            </div>
            <div className="sy-welcome-entries">
                <button className="sy-welcome-entry sy-welcome-entry--discovery" type="button" aria-label="发现竞赛" aria-describedby="welcome-discovery-detail" onClick={() => go(competitionHref())}>
                    <span className="sy-welcome-entry-title">发现竞赛<ArrowRight aria-hidden="true" /></span>
                    <span className="sy-welcome-entry-detail" id="welcome-discovery-detail">按创作方向、费用和截止时间筛选。</span>
                </button>
                <button className="sy-welcome-entry" type="button" aria-label="进入创作" aria-describedby="welcome-studio-detail" onClick={() => go(studioHref())}>
                    <span className="sy-welcome-entry-title">进入创作<ArrowRight aria-hidden="true" /></span>
                    <span className="sy-welcome-entry-detail" id="welcome-studio-detail">继续已有画布，或开始新的创作。</span>
                </button>
            </div>
        </main>
    </div>;
}
