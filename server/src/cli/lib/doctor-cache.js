import crypto from "crypto";
import fs from "fs";
import path from "path";
import os from "os";

function cacheRoot() {
    return path.join(os.homedir(), ".wemiy", "cache", "doctor");
}

export function doctorCacheKeyForContent(content) {
    return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

export function readDoctorCache(contentHash) {
    const filePath = path.join(cacheRoot(), `${contentHash}.json`);
    try {
        const raw = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

export function writeDoctorCache(contentHash, issues) {
    const dir = cacheRoot();
    fs.mkdirSync(dir, { recursive: true });
    const payload = JSON.stringify({ issues: issues ?? [], savedAt: Date.now() });
    fs.writeFileSync(path.join(dir, `${contentHash}.json`), payload, "utf-8");
}
