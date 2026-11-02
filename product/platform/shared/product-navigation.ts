// Only navigation pointers live here. Documents and conversations keep their own stores.
const PREFIX = 'saiyan-navigation:v1:';
const validId = (id: string | null): id is string => Boolean(id && /^[a-zA-Z0-9_-]+$/.test(id));

function read(key: string) {
    try { return localStorage.getItem(PREFIX + key) || ''; } catch { return ''; }
}
function write(key: string, value: string) {
    localStorage.setItem(PREFIX + key, value);
}
export function rememberCompetition(session: string) {
    if (!session || validId(session)) write('session', session);
}
export function rememberProject(project: string, source?: string | null) {
    if (!validId(project)) return;
    write('project', project);
    if (validId(source ?? null)) {
        write('source:' + project, source!);
        write('studio:' + source, project);
    }
}
export function competitionHref(project?: string, source?: string | null) {
    const session = validId(source ?? null) ? source! : (project && read('source:' + project)) || read('session');
    return validId(session) ? '/competitions?' + new URLSearchParams({ session }) : '/competitions';
}
export function studioHref(session?: string) {
    const project = session ? read('studio:' + session) : read('project');
    if (!validId(project)) return '/comfyart/?view=projects';
    const params = new URLSearchParams({ project });
    const source = session || read('source:' + project);
    if (validId(source)) params.set('fromSession', source);
    return '/comfyart/?' + params;
}
export function rememberChat(project: string, chat: string | null) {
    write('chat:' + project, validId(chat) ? chat : '');
}
export function rememberedChat(project: string) {
    const chat = read('chat:' + project);
    return validId(chat) ? chat : null;
}

export function readNavigationView<T>(key: string, fallback: T): T {
    try { return JSON.parse(sessionStorage.getItem(PREFIX + key) || 'null') ?? fallback; } catch { return fallback; }
}
export function saveNavigationView(key: string, value: unknown) {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
}

// Keep live canvas connections and unsent inputs in their original browsing context.
const companions = new Map<string, Window>();
export function navigateProduct(href: string, keepCurrent = false) {
    const target = new URL(href, window.location.href);
    if (target.origin !== window.location.origin || !['/', '/comfyart/', '/competitions'].includes(target.pathname)) {
        throw new Error('页面入口无效。');
    }
    const project = target.pathname === '/comfyart/' && target.searchParams.get('project');
    const competition = target.pathname === '/competitions';
    if (project || competition) {
        const seen = new Set<Window>();
        try {
            for (let owner = window.opener as Window | null; owner && !owner.closed && !seen.has(owner); owner = owner.opener) {
                seen.add(owner);
                const current = new URL(owner.location.href);
                if (current.origin !== target.origin) break;
                const sameContext = project ? current.searchParams.get('project') === project
                    : current.searchParams.get('session') === target.searchParams.get('session');
                if (current.pathname === target.pathname && sameContext) {
                    // Do not assign a URL: even reloading the same URL disconnects live tools.
                    owner.focus();
                    return 'focused' as const;
                }
            }
        } catch { /* The original tab was closed or navigated away from this app. */ }
    }
    if (keepCurrent) {
        const existing = companions.get(target.href);
        try {
            if (existing && !existing.closed && existing.location.href === target.href) {
                existing.focus();
                return 'focused' as const;
            }
        } catch { /* A companion that left this origin is not reused. */ }
        // These are validated same-origin app pages; retain the opener for a live return.
        const opened = window.open(target.href, '_blank');
        if (!opened) throw new Error('新页面未能打开，请允许此站点打开标签页后重试。');
        companions.set(target.href, opened);
        return 'opened' as const;
    }
    window.location.assign(target.href);
    return 'navigated' as const;
}
