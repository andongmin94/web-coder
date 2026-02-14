import axios, { AxiosResponse } from 'axios';
import { SubmitPostRequest } from '@/baekjoon/types/submit';

async function submit(
    data: SubmitPostRequest,
    success: (response: AxiosResponse) => void,
    fail: (error: any) => void
) {
    const payload = new URLSearchParams({
        'cf-turnstile-response': data['cf-turnstile-response'],
        problem_id: data.problem_id,
        language: String(data.language),
        code_open: data.code_open,
        source: data.source,
        csrf_key: data.csrf_key,
    }).toString();

    axios
        .post('/submit/' + data.problem_id, payload, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        })
        .then(success)
        .catch(fail);
}

export { submit };
