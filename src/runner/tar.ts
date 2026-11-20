// 최소 tar 파서 (ustar + GNU 긴 이름 + PAX path). 일반 파일만 돌려줍니다.
export type TarFile = { path: string; content: Uint8Array; mtime: number };

const decoder = new TextDecoder();

const readString = (buf: Uint8Array, start: number, length: number) => {
    let end = start;
    const limit = start + length;
    while (end < limit && buf[end] !== 0) end++;
    return decoder.decode(buf.subarray(start, end));
};

const readOctal = (buf: Uint8Array, start: number, length: number) => {
    const text = readString(buf, start, length).trim();
    return text ? parseInt(text, 8) : 0;
};

const parsePax = (data: Uint8Array): Record<string, string> => {
    const text = decoder.decode(data);
    const result: Record<string, string> = {};
    let i = 0;
    while (i < text.length) {
        const space = text.indexOf(' ', i);
        if (space < 0) break;
        const length = parseInt(text.slice(i, space), 10);
        if (!length) break;
        const record = text.slice(space + 1, i + length - 1);
        const eq = record.indexOf('=');
        if (eq > 0) result[record.slice(0, eq)] = record.slice(eq + 1);
        i += length;
    }
    return result;
};

export const parseTar = (buf: Uint8Array): TarFile[] => {
    const files: TarFile[] = [];
    let offset = 0;
    let longName: string | null = null;
    let paxPath: string | null = null;

    while (offset + 512 <= buf.length) {
        const header = buf.subarray(offset, offset + 512);
        if (header.every((b) => b === 0)) break;

        const size = readOctal(header, 124, 12);
        const type = String.fromCharCode(header[156] || 0x30);
        const dataStart = offset + 512;
        const data = buf.subarray(dataStart, dataStart + size);
        offset = dataStart + Math.ceil(size / 512) * 512;

        if (type === 'L') {
            longName = readString(data, 0, data.length);
            continue;
        }
        if (type === 'x') {
            paxPath = parsePax(data).path ?? null;
            continue;
        }
        if (type === 'g') continue;

        let path = longName ?? paxPath;
        if (!path) {
            const name = readString(header, 0, 100);
            // POSIX ustar("ustar\0")만 prefix 필드를 씁니다. GNU("ustar  ")는 같은 위치에 다른 값이 있습니다.
            const prefix =
                readString(header, 257, 6) === 'ustar' ? readString(header, 345, 155) : '';
            path = prefix ? `${prefix}/${name}` : name;
        }
        longName = null;
        paxPath = null;

        if (type === '0' || type === '\0' || type === '7') {
            files.push({ path, content: data, mtime: readOctal(header, 136, 12) });
        }
    }
    return files;
};
