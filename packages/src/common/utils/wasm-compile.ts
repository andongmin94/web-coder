import { Tarball } from '@obsidize/tar-browserify';
import { WASI, WASIFS } from '@runno/wasi';
import { CodeCompileRequest } from '@/common/types/compile';

type WasmCommand = {
    binaryName: string;
    args?: string[];
    env?: Record<string, string>;
    binaryURL?: string;
    fsPath?: string;
    baseFSURL?: string;
};

type WasmCommandResult = {
    exitCode: number;
    fs: WASIFS;
    output: string;
};

type CppLanguageStandard = 'c++17' | 'c++20';

const CLANG_WASM_PATH = 'wasm/clang.wasm';
const WASM_LD_WASM_PATH = 'wasm/wasm-ld.wasm';
const CLANG_BASE_FS_TAR_GZ_PATH = 'wasm/clang-fs.tar.gz';
const PYTHON_WASM_PATH = 'wasm/python-3.11.3.wasm';
const PYTHON_BASE_FS_TAR_GZ_PATH = 'wasm/python-3.11.3.tar.gz';

const PROGRAM_SOURCE_PATH = '/program';
const PROGRAM_OBJ_PATH = '/program.o';
const PROGRAM_WASM_PATH = '/program.wasm';
const COMPAT_BITS_STDCXX_HEADER_PATH = '/sys/include/bits/stdc++.h';
const PYTHON_SOURCE_PATH = '/program.py';

// GCC convenience header compatibility for BOJ default templates.
const COMPAT_BITS_STDCXX_HEADER = `#pragma once

#include <algorithm>
#include <array>
#include <bitset>
#include <cassert>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <deque>
#include <functional>
#include <iomanip>
#include <iostream>
#include <limits>
#include <list>
#include <map>
#include <numeric>
#include <queue>
#include <set>
#include <sstream>
#include <stack>
#include <string>
#include <tuple>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

using namespace std;
`;

const createClangPrepareCommands = (
    cppStandard: CppLanguageStandard
): WasmCommand[] => [
    {
        binaryName: 'clang',
        binaryURL: getAssetURL(CLANG_WASM_PATH),
        args: [
            '-cc1',
            '-emit-obj',
            '-disable-free',
            '-isysroot',
            '/sys',
            '-internal-isystem',
            '/sys/include/c++/v1',
            '-internal-isystem',
            '/sys/include',
            '-internal-isystem',
            '/sys/lib/clang/8.0.1/include',
            '-ferror-limit',
            '4',
            '-fmessage-length',
            '80',
            '-fcolor-diagnostics',
            '-O2',
            `-std=${cppStandard}`,
            '-o',
            PROGRAM_OBJ_PATH,
            '-x',
            'c++',
            PROGRAM_SOURCE_PATH,
        ],
        env: {},
        baseFSURL: getAssetURL(CLANG_BASE_FS_TAR_GZ_PATH),
    },
    {
        binaryName: 'wasm-ld',
        binaryURL: getAssetURL(WASM_LD_WASM_PATH),
        args: [
            '--no-threads',
            '--export-dynamic',
            '-z',
            'stack-size=1048576',
            '-L/sys/lib/wasm32-wasi',
            '/sys/lib/wasm32-wasi/crt1.o',
            PROGRAM_OBJ_PATH,
            '-lc',
            '-lc++',
            '-lc++abi',
            '-o',
            PROGRAM_WASM_PATH,
        ],
        env: {},
    },
];

const resolveCppStandard = (
    language: CodeCompileRequest['language']
): CppLanguageStandard => {
    return language === 'cpp20' ? 'c++20' : 'c++17';
};

let clangBaseFSCache: Promise<WASIFS> | null = null;
let pythonBaseFSCache: Promise<WASIFS> | null = null;

const createTimestamps = (date: Date) => ({
    access: date,
    modification: date,
    change: date,
});

const getAssetURL = (assetPath: string): string => {
    if (!chrome?.runtime?.getURL) {
        throw new Error('확장 프로그램 런타임을 찾지 못했습니다.');
    }

    return chrome.runtime.getURL(assetPath);
};

const toPlainArrayBuffer = (value: Uint8Array): ArrayBuffer => {
    const copy = new Uint8Array(value.byteLength);
    copy.set(value);
    return copy.buffer;
};

const cloneWasiFS = (source: WASIFS): WASIFS => {
    const cloned: WASIFS = {};

    for (const [path, file] of Object.entries(source)) {
        const timestamps = {
            access: new Date(file.timestamps.access),
            modification: new Date(file.timestamps.modification),
            change: new Date(file.timestamps.change),
        };

        if (file.mode === 'binary') {
            cloned[path] = {
                path,
                mode: 'binary',
                content: new Uint8Array(file.content),
                timestamps,
            };
            continue;
        }

        cloned[path] = {
            path,
            mode: 'string',
            content: file.content,
            timestamps,
        };
    }

    return cloned;
};

const normalizePath = (input: string): string => {
    const converted = input.replace(/\\/g, '/');
    return converted.startsWith('/') ? converted : `/${converted}`;
};

const unzipGzip = async (gzipBinary: Uint8Array): Promise<Uint8Array> => {
    if (typeof DecompressionStream === 'undefined') {
        throw new Error('이 브라우저는 gzip 압축 해제를 지원하지 않습니다.');
    }

    const stream = new Blob([toPlainArrayBuffer(gzipBinary)])
        .stream()
        .pipeThrough(new DecompressionStream('gzip'));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
};

const fetchWasiFSFromTarGz = async (tarGzUrl: string): Promise<WASIFS> => {
    const response = await fetch(tarGzUrl);
    if (!response.ok) {
        throw new Error(
            `WASM 파일 시스템을 불러오지 못했습니다. (${response.status})`
        );
    }

    const tarGzBinary = new Uint8Array(await response.arrayBuffer());
    const tarBinary = await unzipGzip(tarGzBinary);
    const entries = Tarball.extract(tarBinary);
    const fs: WASIFS = {};

    for (const entry of entries) {
        if (!entry.isFile() || !entry.content) {
            continue;
        }

        const path = normalizePath(entry.fileName);
        const date = Number.isFinite(entry.lastModified)
            ? new Date(entry.lastModified)
            : new Date();

        fs[path] = {
            path,
            mode: 'binary',
            content: new Uint8Array(entry.content),
            timestamps: createTimestamps(date),
        };
    }

    return fs;
};

const loadClangBaseFS = async (): Promise<WASIFS> => {
    if (!clangBaseFSCache) {
        clangBaseFSCache = fetchWasiFSFromTarGz(
            getAssetURL(CLANG_BASE_FS_TAR_GZ_PATH)
        );
    }

    const cached = await clangBaseFSCache;
    return cloneWasiFS(cached);
};

const loadPythonBaseFS = async (): Promise<WASIFS> => {
    if (!pythonBaseFSCache) {
        pythonBaseFSCache = fetchWasiFSFromTarGz(
            getAssetURL(PYTHON_BASE_FS_TAR_GZ_PATH)
        );
    }

    const cached = await pythonBaseFSCache;
    return cloneWasiFS(cached);
};

const getBinaryResponseForCommand = async (
    command: WasmCommand,
    fs: WASIFS
): Promise<Response> => {
    if (command.binaryURL) {
        const response = await fetch(command.binaryURL);
        if (!response.ok) {
            throw new Error(
                `WASM 바이너리를 불러오지 못했습니다. (${response.status})`
            );
        }
        return response;
    }

    if (!command.fsPath) {
        throw new Error('실행할 바이너리 경로를 찾지 못했습니다.');
    }

    const file = fs[command.fsPath];
    if (!file || file.mode !== 'binary') {
        throw new Error(`실행 파일이 없습니다: ${command.fsPath}`);
    }

    return new Response(toPlainArrayBuffer(file.content), {
        headers: { 'Content-Type': 'application/wasm' },
    });
};

const runCommand = async (
    command: WasmCommand,
    fs: WASIFS,
    stdin: string | null
): Promise<WasmCommandResult> => {
    let output = '';
    let stdinConsumed = false;

    const appendOutput = (chunk: string) => {
        output += chunk;
    };

    const binaryResponse = await getBinaryResponseForCommand(command, fs);
    const result = await WASI.start(Promise.resolve(binaryResponse), {
        args: [command.binaryName, ...(command.args ?? [])],
        env: command.env ?? {},
        fs,
        isTTY: false,
        stdin: () => {
            if (stdinConsumed || stdin == null) {
                return null;
            }
            stdinConsumed = true;
            return stdin;
        },
        stdout: appendOutput,
        stderr: appendOutput,
    });

    return { ...result, output };
};

const compileCppWithWasm = async (data: CodeCompileRequest): Promise<string> => {
    const clangPrepareCommands = createClangPrepareCommands(
        resolveCppStandard(data.language)
    );
    const now = new Date();
    let fs: WASIFS = {
        [PROGRAM_SOURCE_PATH]: {
            path: PROGRAM_SOURCE_PATH,
            mode: 'string',
            content: data.script,
            timestamps: createTimestamps(now),
        },
        [COMPAT_BITS_STDCXX_HEADER_PATH]: {
            path: COMPAT_BITS_STDCXX_HEADER_PATH,
            mode: 'string',
            content: COMPAT_BITS_STDCXX_HEADER,
            timestamps: createTimestamps(now),
        },
    };

    for (const command of clangPrepareCommands) {
        if (command.baseFSURL) {
            const baseFS = await loadClangBaseFS();
            fs = { ...baseFS, ...fs };
        }

        const result = await runCommand(command, fs, null);
        fs = result.fs;

        if (result.exitCode !== 0) {
            return (
                result.output.trim() ||
                `컴파일에 실패했습니다. (exit code: ${result.exitCode})`
            );
        }
    }

    const runResult = await runCommand(
        {
            binaryName: 'program',
            fsPath: PROGRAM_WASM_PATH,
            env: {},
        },
        fs,
        data.stdin ?? null
    );

    if (runResult.output.trim().length > 0) {
        return runResult.output.trim();
    }

    if (runResult.exitCode !== 0) {
        return `프로세스가 비정상 종료되었습니다. (exit code: ${runResult.exitCode})`;
    }

    return '';
};

const compilePythonWithWasm = async (
    data: CodeCompileRequest
): Promise<string> => {
    const now = new Date();
    const baseFS = await loadPythonBaseFS();
    const fs: WASIFS = {
        ...baseFS,
        [PYTHON_SOURCE_PATH]: {
            path: PYTHON_SOURCE_PATH,
            mode: 'string',
            content: data.script,
            timestamps: createTimestamps(now),
        },
    };

    const runResult = await runCommand(
        {
            binaryName: 'python',
            binaryURL: getAssetURL(PYTHON_WASM_PATH),
            args: [PYTHON_SOURCE_PATH],
            env: {},
        },
        fs,
        data.stdin ?? null
    );

    if (runResult.output.trim().length > 0) {
        return runResult.output.trim();
    }

    if (runResult.exitCode !== 0) {
        return `프로세스가 비정상 종료되었습니다. (exit code: ${runResult.exitCode})`;
    }

    return '';
};

export { compileCppWithWasm, compilePythonWithWasm };
