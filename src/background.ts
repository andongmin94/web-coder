// 코드 실행 요청과 확장 내부 메시지를 처리하는 background 파일입니다.
import { postprecessOutput } from '@/common/utils/compile';
import { CodeCompileRequest } from '@/common/types/compile';
import { trimLineByLine } from '@/common/utils/string';
import {
    compileCppWithWasm,
    compilePythonWithWasm,
} from '@/common/utils/wasm-compile';

// 실행 요청을 받아 언어별 로컬 WASM 컴파일러로 전달합니다.
async function compile(data: CodeCompileRequest) {
    if (data.language !== 'cpp17' && data.language !== 'python3') {
        return `Unsupported language: ${data.language}`;
    }

    try {
        // 현재는 Python 3과 C++17만 로컬 실행 경로를 사용합니다.
        const output =
            data.language === 'python3'
                ? await compilePythonWithWasm(data)
                : await compileCppWithWasm(data);

        return postprecessOutput(data.language, trimLineByLine(output));
    } catch (error) {
        if (error instanceof Error) {
            return error.message;
        }

        return 'WASM local execution failed.';
    }
}

// content script에서 보내는 compile 메시지를 받아 비동기 응답으로 돌려줍니다.
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request && request.action === 'compile') {
        compile(request.data).then((res) => sendResponse(res));
        return true;
    }

    return false;
});
