const JDOODLE_API_URL = 'https://api.jdoodle.com/v1/execute';
const JDOODLE_CREDENTIALS_STORAGE_KEY = 'jdoodle.credentials';
const MISSING_JDOODLE_CREDENTIALS_ERROR =
    'JDoodle API 설정이 비어 있습니다. 웹 코더 팝업에서 Client ID/Secret을 저장해주세요.';

type JdoodleCredentials = {
    clientId: string;
    clientSecret: string;
};

const EMPTY_JDOODLE_CREDENTIALS: JdoodleCredentials = {
    clientId: '',
    clientSecret: '',
};

export {
    JDOODLE_API_URL,
    JDOODLE_CREDENTIALS_STORAGE_KEY,
    EMPTY_JDOODLE_CREDENTIALS,
    MISSING_JDOODLE_CREDENTIALS_ERROR,
};
export type { JdoodleCredentials };
