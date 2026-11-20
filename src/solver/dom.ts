// 작은 DOM 헬퍼. 텍스트는 항상 textContent로 넣습니다.
type Child = Node | string | false | null | undefined;
type Attrs = Record<string, string | boolean | number | undefined | ((e: Event) => void)>;

export function h<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs: Attrs = {},
    children: Child | Child[] = []
): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (value === undefined || value === false) continue;
        if (typeof value === 'function') {
            el.addEventListener(key.replace(/^on/, '').toLowerCase(), value as EventListener);
        } else if (value === true) {
            el.setAttribute(key, '');
        } else {
            el.setAttribute(key, String(value));
        }
    }
    for (const child of Array.isArray(children) ? children : [children]) {
        if (child === false || child == null) continue;
        el.append(child);
    }
    return el;
}

export const $ = <T extends HTMLElement = HTMLElement>(
    selector: string,
    root: ParentNode = document
) => {
    const el = root.querySelector<T>(selector);
    if (!el) throw new Error(`missing element: ${selector}`);
    return el;
};
