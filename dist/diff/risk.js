/**
 * Risk tier assessment based on diff characteristics.
 */
const SECURITY_SENSITIVE_PATTERNS = [
    "auth/", "authentication/", "crypto/", "cryptographic/",
    "password", "secret", "credential", "token",
    "jwt", "oauth", "session",
    /\.env/, /\.pem/, /\.key/, /\.cert/,
    "middleware/auth", "security/", "permissions/",
];
function isSecuritySensitiveFile(filePath) {
    const normalized = filePath.replace(/\\/g, "/").toLowerCase();
    return SECURITY_SENSITIVE_PATTERNS.some((pattern) => {
        if (typeof pattern === "string")
            return normalized.includes(pattern);
        return pattern.test(normalized);
    });
}
export function assessRiskTier(files) {
    const totalLines = files.reduce((sum, f) => sum + f.addedLines + f.removedLines, 0);
    const fileCount = files.length;
    const hasSecurityFiles = files.some((f) => isSecuritySensitiveFile(f.path));
    if (fileCount > 50 || hasSecurityFiles)
        return "full";
    if (totalLines <= 10 && fileCount <= 20)
        return "trivial";
    if (totalLines <= 100 && fileCount <= 20)
        return "lite";
    return "full";
}
//# sourceMappingURL=risk.js.map