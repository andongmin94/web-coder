// 공통으로 재사용하는 실행 로직과 도우미 함수를 담은 유틸 파일입니다.
interface StorageObject {
    [key: string]: any;
}

export const getObjectFromLocalStorage = async (key: string): Promise<any> => {
    return new Promise<any>((resolve, reject) => {
        try {
            chrome.storage.local.get(key, (value: StorageObject) => {
                resolve(value[key]);
            });
        } catch (ex) {
            reject(ex);
        }
    });
};

export const saveObjectInLocalStorage = async (
    obj: StorageObject
): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
        try {
            chrome.storage.local.set(obj, () => {
                resolve();
            });
        } catch (ex) {
            reject(ex);
        }
    });
};

export const removeObjectFromLocalStorage = async (
    key: string
): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
        try {
            chrome.storage.local.remove(key, () => {
                resolve();
            });
        } catch (ex) {
            reject(ex);
        }
    });
};
