import { postprecessOutput, processErrorCode } from '@/common/utils/compile';
import { CodeCompileRequest } from '@/common/types/compile';
import { trimLineByLine } from '@/common/utils/string';
import {
    compileCppWithWasm,
    compilePythonWithWasm,
} from '@/common/utils/wasm-compile';
import {
    JDOODLE_API_URL,
    JDOODLE_CREDENTIALS_STORAGE_KEY,
    MISSING_JDOODLE_CREDENTIALS_ERROR,
    JdoodleCredentials,
} from '@/common/config/jdoodle';
import { getObjectFromLocalStorage } from '@/common/utils/storage';

const isValidCredential = (
    credentials: unknown
): credentials is JdoodleCredentials => {
    if (!credentials || typeof credentials !== 'object') {
        return false;
    }

    const candidate = credentials as JdoodleCredentials;
    return (
        typeof candidate.clientId === 'string' &&
        typeof candidate.clientSecret === 'string' &&
        candidate.clientId.trim().length > 0 &&
        candidate.clientSecret.trim().length > 0
    );
};

const loadCredentials = async (): Promise<JdoodleCredentials | null> => {
    const savedCredentials = await getObjectFromLocalStorage(
        JDOODLE_CREDENTIALS_STORAGE_KEY
    );

    if (!isValidCredential(savedCredentials)) {
        return null;
    }

    return {
        clientId: savedCredentials.clientId.trim(),
        clientSecret: savedCredentials.clientSecret.trim(),
    };
};

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

    const credentials = await loadCredentials();

    if (!credentials) {
        return MISSING_JDOODLE_CREDENTIALS_ERROR;
    }

    const payload: CodeCompileRequest = {
        ...data,
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        key: credentials.clientSecret,
    };

    try {
        const response = await fetch(JDOODLE_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            throw new Error(response.status.toString());
        }

        const json = await response.json();
        const output = trimLineByLine(json.output);
        return postprecessOutput(data.language, output);
    } catch (e) {
        if (e instanceof Error) {
            return processErrorCode(Number(e.message));
        }
        return processErrorCode(500);
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request && request.action === 'compile') {
        compile(request.data).then((res) => sendResponse(res));
    }
    return true;
});
