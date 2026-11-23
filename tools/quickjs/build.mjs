// QuickJS-ng를 깊은 재귀 모드용 WASI 실행기로 빌드합니다. (README.md 참고)
// 사용: node tools/quickjs/build.mjs <quickjs-amalgam 폴더> <출력.wasm>
// 컴파일러는 확장이 쓰는 것과 같은 YoWASP clang(node_modules)을 node에서 실행합니다.
import { readFile, writeFile } from 'node:fs/promises';
import { commands } from '@yowasp/clang';

const [srcDir, out] = process.argv.slice(2);
if (!srcDir || !out) {
    console.error('usage: node tools/quickjs/build.mjs <amalgam-dir> <out.wasm>');
    process.exit(2);
}

/** C 스택(선형 메모리) 크기. 백준의 node --stack-size=65536(64MB)보다 넉넉하게 잡습니다. */
const STACK_MB = 256;
/** QuickJS가 스스로 RangeError를 내는 한계. 실제 스택이 넘쳐 메모리를 망가뜨리기 전에 멈추게 합니다. */
const JS_STACK_MB = STACK_MB - 8;

/**
 * f(...arr), f.apply(null, arr)의 인자 수 한계. QuickJS는 65535로 막지만(지역 변수 수 한계를 그대로 씀)
 * 백준 node에서는 arr.push(...line.split(' ').map(Number))처럼 수십만 개를 펼치는 코드가 통과합니다.
 * 인자 배열은 힙에 잡으므로 이 검사만 늘립니다. (바이트코드의 지역 변수 한계는 그대로)
 */
const MAX_APPLY_ARGS = 10_000_000;

const patchApplyLimit = (source) => {
    const before = `    if (len > JS_MAX_LOCAL_VARS) {
        // XXX: check for stack overflow?
        JS_ThrowRangeError(ctx, "too many arguments in function call (only %d allowed)",
                           JS_MAX_LOCAL_VARS);`;
    const after = `    if (len > ${MAX_APPLY_ARGS}) {
        JS_ThrowRangeError(ctx, "too many arguments in function call (only %d allowed)",
                           ${MAX_APPLY_ARGS});`;
    if (source.split(before).length !== 2)
        throw new Error('build_arg_list 패치 위치를 찾지 못했습니다.');
    return source.replace(before, after);
};

const files = {
    'quickjs-amalgam.c': patchApplyLimit(await readFile(`${srcDir}/quickjs-amalgam.c`, 'utf8')),
    'quickjs.h': await readFile(`${srcDir}/quickjs.h`),
    'quickjs-libc.h': await readFile(`${srcDir}/quickjs-libc.h`),
    'main.c': await readFile(new URL('./main.c', import.meta.url)),
};
const args = [
    '-O2',
    '-D_GNU_SOURCE',
    '-DQJS_BUILD_LIBC',
    `-DJS_DEFAULT_STACK_SIZE=(${JS_STACK_MB}u*1024*1024)`,
    '-D_WASI_EMULATED_SIGNAL',
    '-D_WASI_EMULATED_PROCESS_CLOCKS',
    '-Wno-everything',
    'quickjs-amalgam.c',
    'main.c',
    '-lwasi-emulated-signal',
    '-lwasi-emulated-process-clocks',
    '-lm',
    `-Wl,-z,stack-size=${STACK_MB * 1024 * 1024}`,
    '-Wl,--strip-all',
    '-o',
    'quickjs.wasm',
];
const started = Date.now();
let result;
try {
    result = await commands['clang'](args, files, {
        stdout: (b) => b && process.stdout.write(b),
        stderr: (b) => b && process.stderr.write(b),
        fetchProgress: () => {},
    });
} catch (error) {
    console.error(`clang 실패 (종료 코드 ${error.code})`);
    process.exit(1);
}
await writeFile(out, result['quickjs.wasm']);
console.log(
    `${out} (${(result['quickjs.wasm'].length / 1024).toFixed(0)}KB, ${((Date.now() - started) / 1000).toFixed(0)}s)`
);
