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

const files = {
    'quickjs-amalgam.c': await readFile(`${srcDir}/quickjs-amalgam.c`),
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
