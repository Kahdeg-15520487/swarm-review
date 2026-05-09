/**
 * Git diff extraction using simple-git.
 */
import { simpleGit } from "simple-git";
export async function getDiff(cwd, diffSpec) {
    const git = simpleGit(cwd);
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
        throw new Error(`Not a git repository: ${cwd}`);
    }
    let rawDiff;
    const diffArg = diffSpec.trim();
    if (diffArg === "staged") {
        rawDiff = await git.diff(["--cached"]);
    }
    else if (diffArg === "unstaged") {
        rawDiff = await git.diff();
    }
    else {
        rawDiff = await git.diff([diffArg]);
    }
    const diffSummary = await git.diffSummary(diffArg === "staged" ? ["--cached"] : diffArg === "unstaged" ? [] : [diffArg]);
    const files = diffSummary.files.map((f) => {
        const filePath = f.file;
        const fileDiff = extractFileDiff(rawDiff, filePath);
        const isTextFile = 'insertions' in f;
        return {
            path: filePath,
            addedLines: isTextFile ? f.insertions : 0,
            removedLines: isTextFile ? f.deletions : 0,
            content: fileDiff,
            isRenamed: f.renameFrom !== undefined,
            isNew: fileDiff.startsWith("diff --git") && fileDiff.includes("new file"),
            isDeleted: fileDiff.startsWith("diff --git") && fileDiff.includes("deleted file"),
        };
    });
    const totalAddedLines = files.reduce((sum, f) => sum + f.addedLines, 0);
    const totalRemovedLines = files.reduce((sum, f) => sum + f.removedLines, 0);
    return { files, totalAddedLines, totalRemovedLines, rawDiff };
}
/** Extract diff content for a single file from raw diff output. */
function extractFileDiff(rawDiff, filePath) {
    const escapedPath = filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
        new RegExp(`diff --git a/${escapedPath} b/${escapedPath}[\\s\\S]*?(?=\\ndiff --git |$)`, "g"),
        new RegExp(`diff --git "a/${escapedPath}" "b/${escapedPath}"[\\s\\S]*?(?=\\ndiff --git |$)`, "g"),
    ];
    for (const pattern of patterns) {
        const match = pattern.exec(rawDiff);
        if (match)
            return match[0];
    }
    return "";
}
//# sourceMappingURL=git.js.map