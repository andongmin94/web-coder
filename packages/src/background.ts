import { postprecessOutput } from '@/common/utils/compile';
import { CodeCompileRequest } from '@/common/types/compile';
import { trimLineByLine } from '@/common/utils/string';
import {
    compileCppWithWasm,
    compilePythonWithWasm,
} from '@/common/utils/wasm-compile';
import {
    compileJavaWithPiston,
    compileRustWithPiston,
} from '@/common/utils/piston-compile';

async function compile(data: CodeCompileRequest) {
    if (data.language === 'cpp17' || data.language === 'python3') {
        try {
            const output =
                data.language === 'cpp17'
                    ? await compileCppWithWasm(data)
                    : await compilePythonWithWasm(data);

            return postprecessOutput(data.language, trimLineByLine(output));
        } catch (e) {
            if (e instanceof Error) {
                return e.message;
            }
            return 'WASM local execution failed.';
        }
    }

    if (data.language === 'rust' || data.language === 'java') {
        try {
            const output =
                data.language === 'rust'
                    ? await compileRustWithPiston(data)
                    : await compileJavaWithPiston(data);

            return postprecessOutput(data.language, trimLineByLine(output));
        } catch (e) {
            if (e instanceof Error) {
                return e.message;
            }
            return `${data.language} execution failed.`;
        }
    }

    return `Unsupported language: ${data.language}`;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request && request.action === 'compile') {
        compile(request.data).then((res) => sendResponse(res));
    }
    return true;
});
