export type ArchiveEntry = { name: string; data: Uint8Array };
export type Archive = { entries: ArchiveEntry[]; trailer: Uint8Array };
export function readArchive(gz: Uint8Array): Archive;
export function writeArchive(archive: Archive): Uint8Array;
