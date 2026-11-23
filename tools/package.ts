// 웹 스토어에 올릴 zip을 만듭니다. `npm run package` (빌드 후 release/web-coder-<버전>.zip)
// 외부 도구 없이 동작하도록 zip(deflate)을 직접 씁니다. 파일은 모두 4GB보다 작아 ZIP64는 필요 없습니다.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { crc32, deflateRawSync } from 'node:zlib';

const root = 'dist';
const { version } = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8')) as {
    version: string;
};

const listFiles = async (dir: string): Promise<string[]> => {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
        entries.map((entry) => {
            const path = `${dir}/${entry.name}`;
            return entry.isDirectory() ? listFiles(path) : [path];
        })
    );
    return files.flat().sort();
};

// 이미 압축된 파일은 다시 압축하지 않고 그대로 담습니다.
const STORED = /\.(gz|png|jpe?g|woff2?)$/;
// 1980-01-01 00:00 (DOS 시간). 빌드할 때마다 같은 zip이 나오도록 고정합니다.
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

const local: Buffer[] = [];
const central: Buffer[] = [];
let offset = 0;
const files = await listFiles(root);
for (const path of files) {
    const name = Buffer.from(path.slice(root.length + 1), 'utf8');
    const data = await readFile(path);
    const store = STORED.test(path);
    const body = store ? data : deflateRawSync(data, { level: 9 });
    const crc = crc32(data);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // 필요한 버전
    header.writeUInt16LE(0x0800, 6); // 파일 이름은 UTF-8
    header.writeUInt16LE(store ? 0 : 8, 8);
    header.writeUInt16LE(DOS_TIME, 10);
    header.writeUInt16LE(DOS_DATE, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, body);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(store ? 0 : 8, 10);
    entry.writeUInt16LE(DOS_TIME, 12);
    entry.writeUInt16LE(DOS_DATE, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);

    offset += header.length + name.length + body.length;
}

const centralSize = central.reduce((sum, b) => sum + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

await mkdir('release', { recursive: true });
const out = `release/web-coder-${version}.zip`;
const zip = Buffer.concat([...local, ...central, end]);
await writeFile(out, zip);
console.log(`${out} (${files.length}개 파일, ${(zip.length / 1024 / 1024).toFixed(1)}MB)`);
