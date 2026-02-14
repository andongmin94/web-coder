import { postprecessOutput, processErrorCode } from '@/common/utils/compile';
import { CodeCompileRequest } from '@/common/types/compile';
import { trimLineByLine } from '@/common/utils/string';
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

    return fetch(JDOODLE_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    })
        .then((response) => {
            if (!response.ok) throw new Error(response.status.toString());
            return response.json();
        })
        .then((json) => trimLineByLine(json.output))
        .then((output) => postprecessOutput(data.language, output))
        .catch((e) => processErrorCode(e.message));
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request && request.action === 'compile') {
        compile(request.data).then((res) => sendResponse(res));
    }
    return true;
});
