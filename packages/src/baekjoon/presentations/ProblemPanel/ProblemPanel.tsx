import React from 'react';
import './ProblemPanel.css';

type LegacyMathJax = {
    Hub?: {
        Queue: (...args: unknown[]) => void;
    };
    typesetPromise?: (elements?: Element[] | null) => Promise<unknown>;
};

type MathJaxWindow = Window & {
    MathJax?: LegacyMathJax;
};

const LATEX_COMMAND_MAP: Array<[string, string]> = [
    ['Leftrightarrow', '\u21D4'],
    ['Rightarrow', '\u21D2'],
    ['Leftarrow', '\u21D0'],
    ['leftrightarrow', '\u2194'],
    ['rightarrow', '\u2192'],
    ['leftarrow', '\u2190'],
    ['subseteq', '\u2286'],
    ['supseteq', '\u2287'],
    ['varnothing', '\u2205'],
    ['emptyset', '\u2205'],
    ['varepsilon', '\u03B5'],
    ['vartheta', '\u03D1'],
    ['varsigma', '\u03C2'],
    ['varphi', '\u03C6'],
    ['varrho', '\u03F1'],
    ['approx', '\u2248'],
    ['equiv', '\u2261'],
    ['propto', '\u221D'],
    ['forall', '\u2200'],
    ['exists', '\u2203'],
    ['nexists', '\u2204'],
    ['subset', '\u2282'],
    ['supset', '\u2283'],
    ['notin', '\u2209'],
    ['infty', '\u221E'],
    ['times', '\u00D7'],
    ['cdots', '\u22EF'],
    ['ldots', '\u2026'],
    ['alpha', '\u03B1'],
    ['beta', '\u03B2'],
    ['gamma', '\u03B3'],
    ['delta', '\u03B4'],
    ['zeta', '\u03B6'],
    ['eta', '\u03B7'],
    ['theta', '\u03B8'],
    ['iota', '\u03B9'],
    ['kappa', '\u03BA'],
    ['lambda', '\u03BB'],
    ['mu', '\u03BC'],
    ['nu', '\u03BD'],
    ['xi', '\u03BE'],
    ['pi', '\u03C0'],
    ['varpi', '\u03D6'],
    ['rho', '\u03C1'],
    ['sigma', '\u03C3'],
    ['tau', '\u03C4'],
    ['upsilon', '\u03C5'],
    ['phi', '\u03D5'],
    ['chi', '\u03C7'],
    ['psi', '\u03C8'],
    ['omega', '\u03C9'],
    ['Gamma', '\u0393'],
    ['Delta', '\u0394'],
    ['Theta', '\u0398'],
    ['Lambda', '\u039B'],
    ['Xi', '\u039E'],
    ['Pi', '\u03A0'],
    ['Sigma', '\u03A3'],
    ['Upsilon', '\u03A5'],
    ['Phi', '\u03A6'],
    ['Psi', '\u03A8'],
    ['Omega', '\u03A9'],
    ['leq', '\u2264'],
    ['geq', '\u2265'],
    ['neq', '\u2260'],
    ['le', '\u2264'],
    ['ge', '\u2265'],
    ['ne', '\u2260'],
    ['in', '\u2208'],
    ['cup', '\u222A'],
    ['cap', '\u2229'],
    ['land', '\u2227'],
    ['wedge', '\u2227'],
    ['lor', '\u2228'],
    ['vee', '\u2228'],
    ['cdot', '\u00B7'],
    ['div', '\u00F7'],
    ['pm', '\u00B1'],
    ['mp', '\u2213'],
    ['to', '\u2192'],
    ['dots', '\u2026'],
];

const normalizeLatexExpression = (input: string): string => {
    let text = input;

    text = text.replace(/\\left|\\right/g, '');
    text = text.replace(/\\[,;:!]/g, ' ');
    text = text.replace(/\\quad|\\qquad/g, ' ');
    text = text.replace(/\\text\{([^{}]*)\}/g, '$1');
    text = text.replace(/\\mathrm\{([^{}]*)\}/g, '$1');
    text = text.replace(/\\operatorname\{([^{}]*)\}/g, '$1');
    text = text.replace(
        /\\frac\{([^{}]+)\}\{([^{}]+)\}/g,
        (_, numerator: string, denominator: string) =>
            `(${normalizeLatexExpression(numerator)})/(${normalizeLatexExpression(
                denominator
            )})`
    );
    text = text.replace(
        /\\sqrt(?:\[[^\]]+\])?\{([^{}]+)\}/g,
        (_, body: string) => `\u221A(${normalizeLatexExpression(body)})`
    );

    for (const [command, replacement] of LATEX_COMMAND_MAP) {
        const pattern = new RegExp(`\\\\${command}(?![A-Za-z])`, 'g');
        text = text.replace(pattern, replacement);
    }

    text = text.replace(/[{}]/g, '');
    text = text.replace(/\\([\\{}])/g, '$1');
    text = text.replace(/\s+/g, ' ');

    return text.trim();
};

const hasLatexDelimiterText = (root: HTMLElement): boolean => {
    return /\$[^$\n]+\$/.test(root.innerText);
};

const stripMathDelimiters = (root: HTMLElement): void => {
    const excludedParentTags = new Set([
        'PRE',
        'CODE',
        'SCRIPT',
        'STYLE',
        'TEXTAREA',
    ]);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const targets: Text[] = [];

    while (walker.nextNode()) {
        const textNode = walker.currentNode as Text;
        const parentTag = textNode.parentElement?.tagName;
        if (parentTag && excludedParentTags.has(parentTag)) {
            continue;
        }

        if ((textNode.nodeValue ?? '').includes('$')) {
            targets.push(textNode);
        }
    }

    for (const textNode of targets) {
        const source = textNode.nodeValue ?? '';
        let next = source;
        next = next.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr: string) =>
            normalizeLatexExpression(expr)
        );
        next = next.replace(/\$([^$\n]+?)\$/g, (_, expr: string) =>
            normalizeLatexExpression(expr)
        );
        next = next.replace(/\\\(([\s\S]+?)\\\)/g, (_, expr: string) =>
            normalizeLatexExpression(expr)
        );
        next = next.replace(/\\\[([\s\S]+?)\\\]/g, (_, expr: string) =>
            normalizeLatexExpression(expr)
        );

        if (next !== source) {
            textNode.nodeValue = next;
        }
    }
};

const ProblemPanel: React.FC<{
    content: JSX.Element | null;
    mathJaxStyle: JSX.Element | null;
}> = ({ content, mathJaxStyle }) => {
    const panelRef = React.useRef<HTMLDivElement | null>(null);

    React.useEffect(() => {
        if (!mathJaxStyle) {
            return;
        }

        const styleText = String(mathJaxStyle.props.children ?? '');
        if (!styleText.trim()) {
            return;
        }

        const styleId = 'web-coder-mathjax-style';
        let style = document.getElementById(styleId) as HTMLStyleElement | null;
        if (!style) {
            style = document.createElement('style');
            style.id = styleId;
            document.head.appendChild(style);
        }

        style.textContent = styleText;
    }, [mathJaxStyle]);

    React.useEffect(() => {
        const root = panelRef.current;
        if (!root || !content) {
            return;
        }

        let cancelled = false;

        let retries = 5;
        const typeset = () => {
            if (cancelled) {
                return;
            }

            const mathJax = (window as MathJaxWindow).MathJax;
            if (!mathJax) {
                if (retries > 0) {
                    retries -= 1;
                    window.setTimeout(typeset, 120);
                } else if (hasLatexDelimiterText(root)) {
                    stripMathDelimiters(root);
                }
                return;
            }

            if (typeof mathJax.typesetPromise === 'function') {
                void mathJax.typesetPromise([root]).finally(() => {
                    if (hasLatexDelimiterText(root)) {
                        stripMathDelimiters(root);
                    }
                });
                return;
            }

            if (mathJax.Hub && typeof mathJax.Hub.Queue === 'function') {
                mathJax.Hub.Queue(['Typeset', mathJax.Hub, root]);
                mathJax.Hub.Queue(() => {
                    if (hasLatexDelimiterText(root)) {
                        stripMathDelimiters(root);
                    }
                });
                return;
            }

            if (hasLatexDelimiterText(root)) {
                stripMathDelimiters(root);
            }
        };

        typeset();

        return () => {
            cancelled = true;
        };
    }, [content]);

    return <div ref={panelRef}>{content}</div>;
};

export default ProblemPanel;
