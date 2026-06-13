// 공통으로 재사용하는 실행 로직과 도우미 함수를 담은 유틸 파일입니다.
export const addUrlSearchParam = (
    url: string,
    param: string,
    value: string
): string => {
    const _url = new URL(url);
    const searchParams = _url.searchParams;
    searchParams.set(param, value);
    return _url.origin + _url.pathname + _url.search;
};

export const refreshUrl = (url: string) => {
    location.href = url;
};

export const getUrlSearchParam = (
    url: string,
    param: string
): string | null => {
    return new URL(url).searchParams.get(param);
};
