// 빌드할 때 Python 인터프리터(public/wasm/python-*.wasm)에 하는 수정 (build.ts가 씀)
//
// CPython 3.13은 C 코드를 거치는 재귀(lru_cache를 붙인 함수, __eq__·__hash__ 같은 특수 메서드,
// sorted의 key 등)를 Py_C_RECURSION_LIMIT로 막는데, WASI 빌드는 이 값이 5000으로 고정이라
// lru_cache 재귀가 깊이 약 1,600에서 RecursionError가 납니다. sys.setrecursionlimit으로도 늘릴 수 없고,
// 백준(네이티브 CPython)에서는 통과하는 깊이입니다.
// 스레드 상태를 만들 때(new_threadstate) 넣는 처음 값을 크게 바꿉니다. 그 깊이에서 브라우저 스택이
// 넘치면 깊은 재귀 모드(deep-stack.ts, JSPI)가 이어받습니다.
import { replaceI32Const } from './wasm-const.ts';

export const PYTHON_C_RECURSION = { function: 'new_threadstate', from: 5000, to: 30_000 };

export const patchPython = (wasm: Uint8Array) =>
    replaceI32Const(
        wasm,
        PYTHON_C_RECURSION.function,
        PYTHON_C_RECURSION.from,
        PYTHON_C_RECURSION.to
    );
