const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const manifestPath = path.join(repoRoot, 'src', 'manifest.ts');

const DEFAULT_CWS_URL =
    'https://chromewebstore.google.com/detail/banebmcldnjjliapeiaobcfodgcbhfcl';

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');

const getArgValue = (name) => {
    const index = args.indexOf(name);
    if (index === -1) {
        return null;
    }
    return args[index + 1] ?? null;
};

const cwsUrl =
    getArgValue('--cws-url') ??
    process.env.CWS_ITEM_URL ??
    DEFAULT_CWS_URL;

const versionLineRegex = /(version\s*:\s*['"])([0-9]+(?:\.[0-9]+){1,3})(['"]\s*,)/;

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const parseVersion = (version) => {
    const parts = version.split('.');
    if (parts.length < 2 || parts.length > 4) {
        throw new Error(`Invalid version format: ${version}`);
    }

    const parsed = parts.map((part) => Number(part));
    for (const value of parsed) {
        if (!Number.isInteger(value) || value < 0 || value > 65535) {
            throw new Error(`Invalid version value: ${version}`);
        }
    }

    return parsed;
};

const compareVersions = (left, right) => {
    const leftParts = parseVersion(left);
    const rightParts = parseVersion(right);
    const maxLength = Math.max(leftParts.length, rightParts.length);

    for (let index = 0; index < maxLength; index += 1) {
        const leftValue = leftParts[index] ?? 0;
        const rightValue = rightParts[index] ?? 0;
        if (leftValue > rightValue) {
            return 1;
        }
        if (leftValue < rightValue) {
            return -1;
        }
    }

    return 0;
};

const incrementVersion = (version) => {
    const parts = parseVersion(version);

    for (let index = parts.length - 1; index >= 0; index -= 1) {
        if (parts[index] < 65535) {
            parts[index] += 1;
            return parts.join('.');
        }
        parts[index] = 0;
    }

    throw new Error(`Cannot increment version (all components maxed): ${version}`);
};

const parseExtensionIdFromUrl = (url) => {
    const match = url.match(/\/detail(?:\/[^/]+)?\/([a-z]{32})(?:[/?#]|$)/i);
    if (match) {
        return match[1].toLowerCase();
    }

    const fallback = url.match(/([a-z]{32})(?:[/?#]|$)/i);
    if (fallback) {
        return fallback[1].toLowerCase();
    }

    throw new Error(`Could not parse extension id from URL: ${url}`);
};

const extractManifestVersion = () => {
    const manifestContent = fs.readFileSync(manifestPath, 'utf8');
    const match = manifestContent.match(versionLineRegex);
    if (!match) {
        throw new Error(`Could not find version line in ${manifestPath}`);
    }

    return {
        manifestContent,
        currentVersion: match[2],
    };
};

const extractStoreVersionFromHtml = (html, extensionId) => {
    const escapedId = escapeRegExp(extensionId);
    const byIdPattern = new RegExp(
        `\\[\\\"${escapedId}\\\"[\\s\\S]*?\\\\\\\\\\\"version\\\\\\\\\\\"\\s*:\\s*\\\\\\\\\\\"([0-9]+(?:\\\\.[0-9]+){1,3})\\\\\\\\\\\"`
    );
    const byIdMatch = html.match(byIdPattern);
    if (byIdMatch?.[1]) {
        return byIdMatch[1];
    }

    const idIndex = html.lastIndexOf(extensionId);
    if (idIndex !== -1) {
        const windowChunk = html.slice(idIndex, idIndex + 25000);
        const fallbackMatch = windowChunk.match(
            /\\\"version\\\"\s*:\s*\\\"([0-9]+(?:\.[0-9]+){1,3})\\\"/
        );
        if (fallbackMatch?.[1]) {
            return fallbackMatch[1];
        }
    }

    throw new Error(
        `Could not extract store version from Chrome Web Store page for ${extensionId}`
    );
};

const fetchStoreVersion = async (url) => {
    const extensionId = parseExtensionIdFromUrl(url);
    const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 web-coder-version-sync' },
    });

    if (!response.ok) {
        throw new Error(
            `Failed to fetch Chrome Web Store page (${response.status}): ${url}`
        );
    }

    const html = await response.text();
    const version = extractStoreVersionFromHtml(html, extensionId);

    return { extensionId, storeVersion: version };
};

const writeManifestVersion = (manifestContent, nextVersion) => {
    const updatedContent = manifestContent.replace(
        versionLineRegex,
        `$1${nextVersion}$3`
    );

    if (!isDryRun) {
        fs.writeFileSync(manifestPath, updatedContent, 'utf8');
    }
};

const main = async () => {
    const { manifestContent, currentVersion } = extractManifestVersion();
    const { extensionId, storeVersion } = await fetchStoreVersion(cwsUrl);

    const shouldBump = compareVersions(currentVersion, storeVersion) <= 0;
    const nextVersion = shouldBump
        ? incrementVersion(storeVersion)
        : currentVersion;

    writeManifestVersion(manifestContent, nextVersion);

    const modeLabel = isDryRun ? '[dry-run] ' : '';
    const actionLabel = shouldBump ? 'updated' : 'kept';

    console.log(
        `${modeLabel}Store check (${extensionId}): store=${storeVersion}, local=${currentVersion}, ${actionLabel}=${nextVersion} (manifest only)`
    );
};

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
