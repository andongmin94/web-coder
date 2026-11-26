// 언어별 인텔리센스 엔진. 처음 고를 때 만들어 재사용하고, 한동안 고르지 않은 언어의 엔진은 끕니다.
import type { JavaIndex } from '../intel/classfile.ts';
import { createCppIntel } from '../intel/cpp.ts';
import { createJavaIntel } from '../intel/java.ts';
import { createJavaScriptIntel } from '../intel/javascript.ts';
import { createPythonIntel } from '../intel/python.ts';
import type { LanguageIntel } from '../intel/types.ts';
import type { RunnerPool } from '../runner/pool.ts';
import type { ResolvedLanguage } from '../shared/languages.ts';

/** 고르지 않은 언어의 인텔리센스 엔진을 끄기까지의 시간 */
const IDLE_INTEL_MS = 5 * 60_000;

export const createIntelRegistry = (pool: RunnerPool) => {
    const intels = new Map<string, LanguageIntel>();
    const idleTimers = new Map<string, number>();

    /** Java 버전별 자동완성 색인 (build.ts). release ''는 버전을 고르지 않는 Java(최신) */
    const javaIndexes = new Map<string, Promise<JavaIndex>>();
    const loadJavaIndex = (release: string) => {
        let index = javaIndexes.get(release);
        if (!index) {
            index = fetch(`intel/java-index${release ? `-${release}` : ''}.json`).then((r) => {
                if (!r.ok) throw new Error(`Java 색인을 불러오지 못했습니다 (${r.status})`);
                return r.json() as Promise<JavaIndex>;
            });
            index.catch(() => javaIndexes.delete(release));
            javaIndexes.set(release, index);
        }
        return index;
    };

    const create = (lang: ResolvedLanguage): LanguageIntel => {
        switch (lang.runtime) {
            case 'cpp':
                return createCppIntel(pool.cppAnalyze, lang.cppStd ?? 'c++17');
            case 'javascript':
                return createJavaScriptIntel();
            case 'python':
                return createPythonIntel();
            case 'java':
                return createJavaIntel(
                    () => loadJavaIndex(lang.javaRelease ?? ''),
                    (code) => pool.javaCheck(code, lang.javaRelease ?? '')
                );
        }
    };

    /** 이 언어의 엔진 (C++은 표준 버전별, Java는 릴리스별로 따로) */
    const intelFor = (lang: ResolvedLanguage): LanguageIntel => {
        const key =
            lang.runtime === 'cpp'
                ? `cpp:${lang.cppStd}`
                : lang.runtime === 'java'
                  ? `java:${lang.javaRelease}`
                  : lang.runtime;
        let intel = intels.get(key);
        if (!intel) {
            intel = create(lang);
            intels.set(key, intel);
        }
        // 다른 언어의 엔진(워커)은 한동안 다시 고르지 않으면 끕니다. (Pyright·TypeScript 워커는 수십 MB)
        clearTimeout(idleTimers.get(key));
        idleTimers.delete(key);
        for (const [other, engine] of intels) {
            if (other === key || !engine.dispose || idleTimers.has(other)) continue;
            idleTimers.set(
                other,
                window.setTimeout(() => {
                    idleTimers.delete(other);
                    intels.delete(other);
                    engine.dispose?.();
                }, IDLE_INTEL_MS)
            );
        }
        return intel;
    };

    return { intelFor };
};
