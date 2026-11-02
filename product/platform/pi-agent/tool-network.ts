/// <reference path="./tool-proxy-types.d.ts" />
import { lookup } from "node:dns/promises";
import { promises as fs } from "node:fs";
import { BlockList, isIP } from "node:net";
import { EnvHttpProxyAgent, fetch, type Dispatcher } from "undici";
import { getProxyForUrl } from "proxy-from-env";

const localNetworks = new BlockList();
for (const [network, prefix] of [
    ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
    ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16],
    ["192.0.0.0", 24], ["192.0.2.0", 24], ["198.51.100.0", 24], ["203.0.113.0", 24],
    ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) localNetworks.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32]] as const) {
    localNetworks.addSubnet(network, prefix, "ipv6");
}

export interface ResourceResponse {
    status: number;
    ok: boolean;
    headers: { get(name: string): string | null };
    arrayBuffer(): Promise<ArrayBuffer>;
}
export interface NetworkDependencies {
    /** Optional per-operation accounting; also runs for every redirect target, before transport. */
    beforeRequest?: (url: string) => Promise<void>;
    resolveHost?: (host: string) => Promise<{ address: string; family: number }[]>;
    request?: (url: string, options: { signal?: AbortSignal; redirect: "manual"; headers: Record<string, string>; dispatcher?: Dispatcher }) => Promise<ResourceResponse>;
    managedPolicy?: unknown;
    effectiveProxy?: (url: URL) => string;
}
let proxy: EnvHttpProxyAgent | undefined;

/** Per-request environment proxy and Node CA trust; callers retain their own URL policy. */
export const proxyFetch: typeof fetch = (input, init) => fetch(input, {
    ...init, dispatcher: init?.dispatcher ?? (proxy ??= new EnvHttpProxyAgent()),
});
export const runtimeFetch = proxyFetch;

function proxyAddress(value: unknown): string | undefined {
    if (typeof value !== "string" || !value) return;
    try { const url = new URL(value); if (["http:", "https:"].includes(url.protocol)) return url.href; }
    catch { /* Invalid proxy configuration cannot authorize delegated DNS. */ }
}

function effectiveEnvironmentProxy(url: URL): string {
    // EnvHttpProxyAgent supports these variables; ALL_PROXY alone does not select its route.
    const http = process.env.http_proxy ?? process.env.HTTP_PROXY;
    const configured = url.protocol === "https:" ? (process.env.https_proxy ?? process.env.HTTPS_PROXY) || http : http;
    const selected = getProxyForUrl(url.href); // Mature parser handles NO_PROXY hosts and ports.
    return proxyAddress(configured) === proxyAddress(selected) ? selected : "";
}

export function policyAllowsProxyDns(policy: unknown, url: URL, effectiveProxy: string): boolean {
    if (!policy || typeof policy !== "object" || isIP(url.hostname.replace(/^\[|\]$/g, "")) || url.username || url.password ||
        !url.hostname.includes(".") || url.hostname.endsWith(".localhost") || url.hostname.endsWith(".local")) return false;
    const configured = policy as { version?: unknown; http_proxy?: unknown; http_network_policy?: { type?: unknown; egress_rules?: unknown } };
    const rules = configured.http_network_policy?.egress_rules;
    return configured.version === 1 && configured.http_network_policy?.type === "restricted" &&
        Boolean(proxyAddress(effectiveProxy)) && proxyAddress(effectiveProxy) === proxyAddress(configured.http_proxy) &&
        Array.isArray(rules) && rules.some(rule => rule && typeof rule === "object" && (rule as { host?: unknown }).host === url.hostname);
}

async function managedPolicy(): Promise<unknown> {
    try { return JSON.parse(await fs.readFile("/etc/codex/network-policy.json", "utf8")); }
    catch { return null; }
}

export async function publicUrl(value: string, dependencies: NetworkDependencies = {}): Promise<URL> {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("只支持不带凭据的公开 HTTP(S) 来源");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new Error("不能读取本机或内网来源");
    // In this managed cloud, the authenticated policy proxy owns DNS and exact-host egress.
    // Delegate only for its explicit v1 restricted allowlist and its current effective route.
    const policy = dependencies.managedPolicy === undefined ? await managedPolicy() : dependencies.managedPolicy;
    if (policyAllowsProxyDns(policy, url, dependencies.effectiveProxy ? dependencies.effectiveProxy(url) : effectiveEnvironmentProxy(url))) {
        url.hash = "";
        return url;
    }
    const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] :
        await (dependencies.resolveHost ? dependencies.resolveHost(host) : lookup(host, { all: true }));
    if (!addresses.length || addresses.some(({ address, family }) => localNetworks.check(address, family === 6 ? "ipv6" : "ipv4"))) {
        throw new Error("不能读取本机或内网来源");
    }
    // Preserve the managed environment's benchmark-proxy DNS range, as the existing reader does.
    // Requests still use EnvHttpProxyAgent; proxy/network denials are returned, never bypassed.
    url.hash = "";
    return url;
}

export async function requestResource(value: string, signal?: AbortSignal, dependencies: NetworkDependencies = {}) {
    const visited = new Set<string>();
    let target = value;
    for (;;) {
        signal?.throwIfAborted();
        // Accounting runs before DNS as well as HTTP, including redirects and policy failures.
        await dependencies.beforeRequest?.(new URL(target).href);
        const url = await publicUrl(target, dependencies);
        if (visited.has(url.href)) throw new Error("来源发生循环重定向");
        visited.add(url.href);
        const options = { signal, redirect: "manual" as const, headers: { "User-Agent": "Saiyan-Pi-Experiment/1.0" } };
        const response = dependencies.request ? await dependencies.request(url.href, options) :
            await proxyFetch(url.href, options);
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get("location");
            if (!location) throw new Error(`来源重定向缺少地址（HTTP ${response.status}）`);
            await response.arrayBuffer();
            target = new URL(location, url).href;
            continue;
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        return { url: url.href, status: response.status, ok: response.ok, mimeType: (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase(), contentType: response.headers.get("content-type") || "", bytes };
    }
}
